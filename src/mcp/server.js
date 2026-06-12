#!/usr/bin/env node
//
// A dependency-free Model Context Protocol server for monogit.
// Speaks JSON-RPC 2.0 over stdio (newline-delimited), exposing monogit's
// operations as tools so an LLM can drive multi-repo git workflows.
//
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveRepos, readConfig, getProtectedPatterns, parseList } from '../utils/config.js';
import { getRepoStatus, isGitRepo, runGitCommand, fetchPrune } from '../utils/git.js';
import { mapLimit } from '../utils/concurrency.js';
import { performCommit } from '../core/commit.js';
import { scanRepoForOrphans, deleteCandidate } from '../core/tidy.js';
import { collectChanges, selectChange } from '../core/changes.js';
import { hasGh, openPrForRepo } from '../core/pr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const PROTOCOL_VERSION = '2025-06-18';

// stdout is reserved for protocol messages; everything else goes to stderr.
const log = (...args) => console.error('[monogit-mcp]', ...args);

const filterProps = {
  only: { type: 'string', description: 'Comma-separated repo names/paths to include' },
  except: { type: 'string', description: 'Comma-separated repo names/paths to exclude' },
  group: { type: 'string', description: 'Comma-separated repo groups (from .monogit.json) to target' },
};
const filterOf = (a = {}) => ({ only: a.only, except: a.except, group: a.group });

// Run `fn` across repos, returning plain values (no Promise.allSettled wrappers).
async function across(repos, fn) {
  const settled = await mapLimit(repos, 8, fn);
  return settled.map((e) => (e.status === 'fulfilled' ? e.value : { error: String(e.reason) }));
}

const TOOLS = [
  {
    name: 'monogit_status',
    description: 'Status dashboard for every linked repo: branch, ahead/behind upstream, dirty counts, in-progress operations (rebase/merge).',
    inputSchema: { type: 'object', properties: { ...filterProps } },
    handler: async (args) => {
      const repos = await resolveRepos(filterOf(args));
      return across(repos, async (r) => ({ repo: r.name, ...(await getRepoStatus(r.path)) }));
    },
  },
  {
    name: 'monogit_list_repos',
    description: 'List the repositories linked in this monogit workspace, with their remote, branch, and whether they exist on disk.',
    inputSchema: { type: 'object', properties: { ...filterProps } },
    handler: async (args) => {
      const repos = await resolveRepos(filterOf(args));
      return across(repos, async (r) => ({
        name: r.name,
        path: r.path,
        remote: r.remote,
        branch: r.branch,
        present: await isGitRepo(r.path),
      }));
    },
  },
  {
    name: 'monogit_exec',
    description: 'Run an arbitrary git command across all repos. Pass the git arguments as an array, e.g. ["stash","list"] or ["log","--oneline","-5"].',
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'array', items: { type: 'string' }, description: 'Git arguments (without the leading "git")' },
        ...filterProps,
      },
      required: ['args'],
    },
    handler: async (args) => {
      const repos = await resolveRepos(filterOf(args));
      const gitArgs = args.args[0] === 'git' ? args.args.slice(1) : args.args;
      return across(repos, async (r) => {
        const res = await runGitCommand(r.path, gitArgs);
        return { repo: r.name, exitCode: res.exitCode, output: (res.all || '').trim() };
      });
    },
  },
  {
    name: 'monogit_commit',
    description: 'Commit a message across all repos that have pending changes. With linking on (config commit.link, or link:true), stamps each commit with a shared Monogit-Change-Id trailer. Repos with nothing to commit are skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
        all: { type: 'boolean', description: 'Stage all modified/deleted tracked files (git commit -a)' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Limit the commit to these paths' },
        link: { type: 'boolean', description: 'Add cross-repo Change-Id trailers (defaults to the workspace config)' },
        ...filterProps,
      },
      required: ['message'],
    },
    handler: async (args) => {
      const repos = await resolveRepos(filterOf(args));
      const config = await readConfig();
      const link = args.link !== undefined ? Boolean(args.link) : config.commit?.link === true;
      return performCommit({
        repos,
        message: args.message,
        all: Boolean(args.all),
        paths: args.paths || [],
        link,
      });
    },
  },
  {
    name: 'monogit_checkout',
    description: 'Check out (or create with create:true) a branch across all repos.',
    inputSchema: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Branch name' },
        create: { type: 'boolean', description: 'Create the branch (git checkout -b)' },
        ...filterProps,
      },
      required: ['branch'],
    },
    handler: async (args) => {
      const repos = await resolveRepos(filterOf(args));
      const gitArgs = args.create ? ['checkout', '-b', args.branch] : ['checkout', args.branch];
      return across(repos, async (r) => {
        const res = await runGitCommand(r.path, gitArgs);
        return { repo: r.name, exitCode: res.exitCode, output: (res.all || '').trim() };
      });
    },
  },
  {
    name: 'monogit_push',
    description: 'Push across all repos. Optionally to a specific remote/branch.',
    inputSchema: {
      type: 'object',
      properties: {
        remote: { type: 'string' },
        branch: { type: 'string' },
        ...filterProps,
      },
    },
    handler: async (args) => {
      const repos = await resolveRepos(filterOf(args));
      const gitArgs = ['push', args.remote, args.branch].filter(Boolean);
      return across(repos, async (r) => {
        const res = await runGitCommand(r.path, gitArgs);
        return { repo: r.name, exitCode: res.exitCode, output: (res.all || '').trim() };
      });
    },
  },
  {
    name: 'monogit_pull',
    description: 'Pull across all repos. Optionally from a specific remote/branch.',
    inputSchema: {
      type: 'object',
      properties: {
        remote: { type: 'string' },
        branch: { type: 'string' },
        ...filterProps,
      },
    },
    handler: async (args) => {
      const repos = await resolveRepos(filterOf(args));
      const gitArgs = ['pull', args.remote, args.branch].filter(Boolean);
      return across(repos, async (r) => {
        const res = await runGitCommand(r.path, gitArgs);
        return { repo: r.name, exitCode: res.exitCode, output: (res.all || '').trim() };
      });
    },
  },
  {
    name: 'monogit_show',
    description: 'Show every commit across repos that shares a Monogit-Change-Id (the cross-repo "atomic change"). With no changeId, returns the most recent linked change.',
    inputSchema: {
      type: 'object',
      properties: {
        changeId: { type: 'string', description: 'Change id or prefix (defaults to most recent)' },
        ...filterProps,
      },
    },
    handler: async (args) => {
      const repos = await resolveRepos(filterOf(args));
      const rows = await collectChanges(repos);
      const { target, matches } = selectChange(rows, args.changeId);
      return { changeId: target, matches };
    },
  },
  {
    name: 'monogit_tidy',
    description: 'Scan for orphaned branches (gone upstream / merged / optionally stale) across all repos. Read-only by default; set execute:true to actually delete the candidates.',
    inputSchema: {
      type: 'object',
      properties: {
        gone: { type: 'boolean', description: 'Include branches whose upstream was deleted' },
        merged: { type: 'boolean', description: 'Include branches merged into the default branch' },
        staleDays: { type: 'number', description: 'Also include branches with no commits in N days' },
        execute: { type: 'boolean', description: 'Delete the candidates (default false = dry run)' },
        fetch: { type: 'boolean', description: 'Run git fetch --prune first (default true)' },
        protect: { type: 'string', description: 'Comma-separated branch names/globs to never delete' },
        ...filterProps,
      },
    },
    handler: async (args) => {
      const repos = await resolveRepos(filterOf(args));
      const flagsGiven = args.gone || args.merged || args.staleDays !== undefined;
      const want = {
        gone: flagsGiven ? Boolean(args.gone) : true,
        merged: flagsGiven ? Boolean(args.merged) : true,
        stale: flagsGiven ? args.staleDays !== undefined : false,
      };
      const staleDays = Number.isInteger(args.staleDays) && args.staleDays > 0 ? args.staleDays : 30;
      const protectedPatterns = [...(await getProtectedPatterns()), ...parseList(args.protect)];

      if (args.fetch !== false) await mapLimit(repos, 8, (r) => fetchPrune(r.path));

      const scans = await across(repos, (r) => scanRepoForOrphans(r, want, staleDays, protectedPatterns));
      const candidates = scans.flatMap((s) => s.candidates || []);
      const result = { dryRun: !args.execute, candidates: candidates.map(({ cwd, ...c }) => c) };

      if (args.execute) {
        result.deleted = [];
        for (const c of candidates) result.deleted.push(await deleteCandidate(c));
      }
      return result;
    },
  },
  {
    name: 'monogit_pr',
    description: 'Open a pull request for each repo that has commits ahead of its base branch (via the GitHub CLI). Pushes the branch first unless push:false. Repos on the base branch or with no new commits are skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        base: { type: 'string', description: 'Base branch (defaults to each repo default)' },
        draft: { type: 'boolean' },
        fill: { type: 'boolean', description: 'Fill title/body from commit messages' },
        push: { type: 'boolean', description: 'Push the branch before opening (default true)' },
        ...filterProps,
      },
    },
    handler: async (args) => {
      if (!(await hasGh())) {
        throw new Error('The GitHub CLI (gh) is required for monogit_pr. Install it and run `gh auth login`.');
      }
      const repos = await resolveRepos(filterOf(args));
      return across(repos, (r) =>
        openPrForRepo(r, {
          title: args.title,
          body: args.body,
          base: args.base,
          draft: args.draft,
          fill: args.fill,
          web: false,
          push: args.push !== false,
        })
      );
    },
  },
];

const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'monogit', version: pkg.version },
        instructions:
          'Drive multi-repo git workflows over a monogit workspace. Read state with monogit_status / monogit_list_repos, then act with monogit_commit, monogit_exec, monogit_tidy, monogit_pr, etc.',
      });
      return;

    case 'notifications/initialized':
    case 'initialized':
      return; // notification, no response

    case 'ping':
      if (!isNotification) reply(id, {});
      return;

    case 'tools/list':
      reply(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
      return;

    case 'tools/call': {
      const tool = toolByName.get(params?.name);
      if (!tool) {
        replyError(id, -32602, `Unknown tool: ${params?.name}`);
        return;
      }
      try {
        const data = await tool.handler(params.arguments || {});
        reply(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (err) {
        reply(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
      return;
    }

    default:
      if (!isNotification) replyError(id, -32601, `Method not found: ${method}`);
  }
}

export function startMcpServer() {
  log(`monogit ${pkg.version} MCP server ready (${TOOLS.length} tools)`);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const pending = new Set();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      replyError(null, -32700, 'Parse error');
      return;
    }
    const p = handleMessage(msg)
      .catch((err) => log('handler error:', err))
      .finally(() => pending.delete(p));
    pending.add(p);
  });

  // Drain in-flight handlers so their responses flush before we exit.
  rl.on('close', async () => {
    await Promise.allSettled([...pending]);
    process.exit(0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMcpServer();
}
