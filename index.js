#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { initCommand } from './src/commands/init.js';
import { gitProxyCommand } from './src/commands/git-proxy.js';
import { visualCommand } from './src/commands/visual.js';
import { statusCommand } from './src/commands/dashboard.js';
import { completionCommand } from './src/commands/completion.js';
import { completeAction } from './src/commands/complete.js';
import { tidyCommand } from './src/commands/tidy.js';
import { execCommand, runShellCommand } from './src/commands/exec.js';
import { cloneCommand } from './src/commands/clone.js';
import { reposListCommand, reposAddCommand, reposRemoveCommand } from './src/commands/repos.js';
import { prCommand } from './src/commands/pr.js';
import { commitCommand } from './src/commands/commit.js';
import { showCommand } from './src/commands/show.js';
import { pushCommand } from './src/commands/push.js';
import { voiceCommand } from './src/commands/voice.js';
import { watchCommand } from './src/commands/watch.js';
import { linkCommand, unlinkCommand } from './src/commands/link.js';
import { releaseCommand } from './src/commands/release.js';
import { ciCommand } from './src/commands/ci.js';

function collectMessage(value, previous) {
  previous.push(value);
  return previous;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

const program = new Command();
program.enablePositionalOptions();

program
  .name('monogit')
  .description('Manage multiple git repositories in a single folder')
  .version(packageJson.version);

// Attach the shared repo-selection options to a command.
function repoOpts(cmd) {
  return cmd
    .option('--only <repos>', 'comma-separated repos to include')
    .option('--except <repos>', 'comma-separated repos to exclude')
    .option('--group <groups>', 'comma-separated repo groups to target')
    .option('-c, --concurrency <n>', 'max repos to process in parallel');
}

// Complete (hidden)
program
  .command('__complete', { hidden: true })
  .argument('<args...>', 'command line arguments')
  .action(async (args) => {
    await completeAction(['monogit', ...args]);
  });

// Completion
program
  .command('completion')
  .description('Generate (or install) a shell completion script')
  .argument('[shell]', 'shell: bash, zsh, fish, powershell', 'zsh')
  .argument('[installShell]', 'shell when using `completion install <shell>`')
  .option('--install', 'install completion into your shell config')
  .action(async (shell, installShell, options) => {
    let target = shell;
    let install = Boolean(options.install);
    if (shell === 'install') {
      install = true;
      target = installShell || 'zsh';
    }
    await completionCommand(target, program, { install });
  });

// Init
program
  .command('init')
  .description('Initialize monogit and link subdirectories')
  .option('--depth <n>', 'how deep to scan for nested repos (default 3)')
  .action(initCommand);

// Repos management
const repos = program.command('repos').description('List and manage linked repositories');
repos.command('list', { isDefault: true }).description('List linked repositories').action(reposListCommand);
repos.command('add').description('Link a repository').argument('<path>', 'path to the repo').action(reposAddCommand);
repos
  .command('remove')
  .alias('rm')
  .description('Unlink a repository (files untouched)')
  .argument('<name>', 'repo name or path')
  .action(reposRemoveCommand);

// Checkout
repoOpts(
  program
    .command('checkout')
    .description('Run git checkout in all linked repositories')
    .argument('<branch>', 'the branch name')
    .option('-b', 'create a new branch')
).action(async (branch, options) => {
  const args = options.b ? ['-b', branch] : [branch];
  await gitProxyCommand('checkout', args, options);
});

// Add
repoOpts(
  program.command('add').description('Run git add in all linked repositories').argument('<path...>', 'files to add')
).action(async (paths, options) => {
  await gitProxyCommand('add', paths, options);
});

// Commit
repoOpts(
  program
    .command('commit')
    .description('Commit across all linked repositories (opens an editor if -m is omitted)')
    .argument('[paths...]', 'files to commit')
    .option('-m, --message <message>', 'commit message (repeatable for paragraphs)', collectMessage, [])
    .option('-a', 'stage all modified/deleted tracked files')
    .option('-A, --all-files', 'stage everything including untracked files (git add -A)')
    .option('--link', 'add cross-repo Change-Id trailers')
    .option('--no-link', 'do not add cross-repo Change-Id trailers')
).action(async (paths, options, command) => {
  await commitCommand(paths, options, command);
});

// Show (look up a linked cross-repo change)
repoOpts(
  program
    .command('show')
    .description('Show all commits across repos that share a Monogit-Change-Id')
    .argument('[change-id]', 'the change id (defaults to the most recent)')
    .option('--json', 'output machine-readable JSON')
).action(showCommand);

// Watch (live interactive dashboard with quick actions)
repoOpts(
  program
    .command('watch')
    .description('Live, interactive dashboard of all repos with quick actions')
    .option('--interval <seconds>', 'auto-refresh interval (default 5)')
).action(watchCommand);

// Voice (speak a command; local STT + grammar)
program
  .command('voice')
  .description('Speak commands hands-free (continuous, local STT). Pass/pipe text to skip the mic.')
  .argument('[phrase...]', 'transcript to interpret (skips recording)')
  .option('--once', 'capture a single command instead of listening continuously')
  .option('--dry-run', 'interpret and print the command without running it')
  .option('-y, --yes', 'skip confirmation for write commands')
  .action(async (phrase, options) => {
    await voiceCommand(phrase, options);
  });

// MCP server (lets LLMs/agents drive monogit over stdio)
program
  .command('mcp')
  .description('Start the monogit MCP server (JSON-RPC over stdio) for LLM/agent use')
  .action(async () => {
    const { startMcpServer } = await import('./src/mcp/server.js');
    startMcpServer();
  });

// Log
repoOpts(program.command('log').description('Show git log for all linked repositories')).action(async (options) => {
  await visualCommand('log', [], options);
});

// Diff
repoOpts(program.command('diff').description('Show git diff for all linked repositories')).action(async (options) => {
  await visualCommand('diff', [], options);
});

// Status (dashboard)
repoOpts(
  program
    .command('status')
    .description('Show a status dashboard for all linked repositories')
    .option('-f, --full', 'show full `git status` per repo instead of the table')
    .option('--json', 'output machine-readable JSON')
).action(statusCommand);

// Push (respects per-repo `dependsOn` ordering; --wait-ci waits for CI between waves)
repoOpts(
  program
    .command('push')
    .description('Run git push in all linked repositories (in dependency order when `dependsOn` is set)')
    .argument('[remote]', 'the remote name')
    .argument('[branch]', 'the branch name')
    .option('--wait-ci', 'wait for a repo’s CI to pass before pushing its dependents (needs gh)')
).action((remote, branch, options) => pushCommand(remote, branch, options));

// Pull
repoOpts(
  program
    .command('pull')
    .description('Run git pull in all linked repositories')
    .argument('[remote]', 'the remote name')
    .argument('[branch]', 'the branch name')
).action(async (remote, branch, options) => {
  const args = [remote, branch].filter(Boolean);
  await gitProxyCommand('pull', args, options);
});

// Fetch
repoOpts(
  program
    .command('fetch')
    .description('Run git fetch in all linked repositories')
    .argument('[remote]', 'the remote name')
    .argument('[branch]', 'the branch name')
).action(async (remote, branch, options) => {
  const args = [remote, branch].filter(Boolean);
  await gitProxyCommand('fetch', args, options);
});

// Branch
repoOpts(
  program
    .command('branch')
    .description('Run git branch in all linked repositories')
    .argument('[branch]', 'the branch name')
    .option('-d, --delete', 'delete a branch')
    .option('-D', 'force delete a branch')
).action(async (branch, options) => {
  if (!branch && !options.delete && !options.D) {
    await visualCommand('branch', [], options);
    return;
  }
  const args = [];
  if (options.delete) args.push('-d');
  if (options.D) args.push('-D');
  if (branch) args.push(branch);
  await gitProxyCommand('branch', args, options);
});

// Merge
repoOpts(
  program.command('merge').description('Run git merge in all linked repositories').argument('<branch>', 'the branch name')
).action(async (branch, options) => {
  await gitProxyCommand('merge', [branch], options);
});

// Tidy
repoOpts(
  program
    .command('tidy')
    .description('Scan for and clean up orphaned branches across all repositories')
    .option('--gone', 'include branches whose upstream was deleted on the remote')
    .option('--merged', 'include branches already merged into the default branch')
    .option('--stale [days]', 'include branches with no commits in N days (default 30)')
    .option('--no-fetch', 'skip `git fetch --prune` before scanning')
    .option('--dry-run', 'report what would be deleted without deleting')
    .option('-y, --yes', 'delete without interactive confirmation')
    .option('--protect <branches>', 'comma-separated branch names/globs to never delete')
    .option('--json', 'output machine-readable JSON')
).action(tidyCommand);

// Exec (arbitrary git passthrough)
repoOpts(
  program
    .command('exec')
    .description('Run an arbitrary git command across all repos (e.g. `monogit exec -- stash list`)')
    .argument('[args...]', 'git arguments')
    .option('--json', 'output machine-readable JSON')
)
  .passThroughOptions()
  .allowUnknownOption()
  .action(async (args, options) => {
    await execCommand(args, options);
  });

// Run (arbitrary shell command)
repoOpts(
  program
    .command('run')
    .description('Run an arbitrary shell command across all repos (e.g. `monogit run "npm test"`)')
    .argument('<command>', 'the shell command (quote it)')
).action(async (command, options) => {
  await runShellCommand(command, options);
});

// Clone (reconstitute a workspace from the manifest)
repoOpts(
  program.command('clone').description('Clone any linked repos that have a remote but are missing locally')
).action(cloneCommand);

// Link (wire shared packages to their local checkouts across repos)
repoOpts(
  program
    .command('link')
    .description('[beta] Link a shared package into repos (guided), or link all declared deps if no package given')
    .argument('[package]', 'path to a package folder, or a package name in the workspace')
    .option('--into <repos>', 'comma-separated repos to link into (skips the prompt)')
    .option('--dev', 'add as a devDependency instead of a dependency')
    .option('--file', 'declare a file:/link: path dependency (auto for unpublished/private packages)')
    .option('--status', 'show the cross-repo package graph without linking')
).action((packageArg, options) => linkCommand(packageArg, options));

// Unlink (restore registry versions)
repoOpts(
  program.command('unlink').description('[beta] Undo `monogit link` and restore registry versions')
).action(unlinkCommand);

// Release (coordinated version bump + optional publish of shared packages)
repoOpts(
  program
    .command('release')
    .description('[beta] Bump shared package versions, update dependents, and commit as one linked change')
    .option('--bump <level>', 'major | minor | patch (default patch)')
    .option('--version <version>', 'set an explicit version instead of bumping')
    .option('--tag', 'create a git tag per package (name@version)')
    .option('--publish', 'publish each package to its registry after committing')
    .option('--dry-run', 'show the release plan without changing anything')
    .option('-y, --yes', 'skip confirmation prompts')
).action(releaseCommand);

// CI (make a single-repo checkout buildable in CI / deploys)
program
  .command('ci')
  .description('[beta] Correct local package links for CI/deploys — `hydrate` (clone siblings) or `resolve` (self-contained git deps)')
  .argument('<mode>', 'hydrate | resolve')
  .option('--ref <ref>', 'git ref to use for the shared packages')
  .option('--dry-run', 'show what resolve would change without writing')
  .action((mode, options) => ciCommand(mode, options));

// PR (open pull requests via the GitHub CLI)
repoOpts(
  program
    .command('pr')
    .description('Open pull requests across all repositories (requires the `gh` CLI)')
    .option('--title <title>', 'PR title (otherwise filled from commits)')
    .option('--body <body>', 'PR body')
    .option('--base <branch>', 'base branch (defaults to each repo’s default branch)')
    .option('--draft', 'create draft PRs')
    .option('--web', 'open each PR in the browser to finish')
    .option('--fill', 'fill title/body from commit messages')
    .option('--no-push', 'do not push the branch before creating the PR')
    .option('--json', 'output machine-readable JSON')
).action(prCommand);

program.parse(process.argv);
