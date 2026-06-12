import { execa } from 'execa';
import path from 'node:path';
import fs from 'node:fs/promises';

export async function isGitRepo(dir) {
  try {
    // `.git` is a directory for normal repos and a file for linked worktrees / submodules.
    const stats = await fs.stat(path.join(dir, '.git'));
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

export async function runGitCommand(repoPath, args) {
  try {
    const { all, stdout, stderr, exitCode } = await execa('git', args, {
      cwd: repoPath,
      reject: false,
      all: true,
    });
    return { all, stdout, stderr, exitCode };
  } catch (error) {
    return {
      all: error.all || error.message,
      stdout: error.stdout,
      stderr: error.stderr,
      exitCode: error.exitCode || 1,
    };
  }
}

export async function initGitRepo(repoPath) {
  return await runGitCommand(repoPath, ['init']);
}

export async function listSubdirectories(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
}

export async function getCurrentBranch(repoPath) {
  const r = await runGitCommand(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (r.exitCode !== 0) return null;
  const branch = r.stdout.trim();
  // Detached HEAD reports the literal "HEAD"
  return branch && branch !== 'HEAD' ? branch : null;
}

export async function getDefaultBranch(repoPath) {
  // Prefer the remote's idea of HEAD (e.g. origin/main)
  const head = await runGitCommand(repoPath, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (head.exitCode === 0 && head.stdout) {
    return head.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
  }
  // Fall back to a local main/master if present
  for (const candidate of ['main', 'master']) {
    const r = await runGitCommand(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`]);
    if (r.exitCode === 0) return candidate;
  }
  return null;
}

export async function fetchPrune(repoPath) {
  return runGitCommand(repoPath, ['fetch', '--prune']);
}

export async function listLocalBranches(repoPath) {
  const format = '%(refname:short)\t%(upstream:track)\t%(committerdate:unix)\t%(committerdate:relative)';
  const r = await runGitCommand(repoPath, ['for-each-ref', `--format=${format}`, 'refs/heads']);
  if (r.exitCode !== 0 || !r.stdout) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, track, unix, rel] = line.split('\t');
      return {
        name,
        gone: track === '[gone]',
        unix: Number(unix) || 0,
        rel: rel || '',
      };
    });
}

export async function listMergedBranches(repoPath, base) {
  const r = await runGitCommand(repoPath, ['branch', '--merged', base, '--format=%(refname:short)']);
  if (r.exitCode !== 0 || !r.stdout) return new Set();
  return new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
}

export async function deleteBranch(repoPath, branch, force) {
  return runGitCommand(repoPath, ['branch', force ? '-D' : '-d', branch]);
}

// Will a `git commit` in this repo actually produce a commit (vs. a no-op)?
// Mirrors git's semantics for staged-only, `-a`, and explicit-path commits.
export async function repoHasPendingCommit(repoPath, { all = false, paths = [] } = {}) {
  const args = ['status', '--porcelain'];
  if (paths.length) args.push('--', ...paths);
  const r = await runGitCommand(repoPath, args);
  if (r.exitCode !== 0) return true; // can't tell — let git decide
  const lines = r.stdout.split('\n').filter(Boolean);
  if (lines.length === 0) return false;
  if (paths.length) return true; // changes exist within the given paths
  if (all) return lines.some((l) => l.slice(0, 2) !== '??'); // -a commits tracked changes only
  return lines.some((l) => l[0] !== ' ' && l[0] !== '?'); // staged-only
}

export async function getRemoteUrl(repoPath, remote = 'origin') {
  const r = await runGitCommand(repoPath, ['remote', 'get-url', remote]);
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

async function gitPathExists(repoPath, name) {
  const r = await runGitCommand(repoPath, ['rev-parse', '--git-path', name]);
  if (r.exitCode !== 0) return false;
  try {
    await fs.stat(path.resolve(repoPath, r.stdout.trim()));
    return true;
  } catch {
    return false;
  }
}

// Detect an in-progress operation (rebase, merge, etc.) for the status dashboard.
export async function getRepoState(repoPath) {
  if ((await gitPathExists(repoPath, 'rebase-merge')) || (await gitPathExists(repoPath, 'rebase-apply'))) {
    return 'rebasing';
  }
  if (await gitPathExists(repoPath, 'MERGE_HEAD')) return 'merging';
  if (await gitPathExists(repoPath, 'CHERRY_PICK_HEAD')) return 'cherry-picking';
  if (await gitPathExists(repoPath, 'REVERT_HEAD')) return 'reverting';
  if (await gitPathExists(repoPath, 'BISECT_LOG')) return 'bisecting';
  return 'clean';
}

// One-shot snapshot of a repo's state for the dashboard.
export async function getRepoStatus(repoPath) {
  const headRef = await runGitCommand(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (headRef.exitCode !== 0) {
    return { ok: false, error: (headRef.all || 'not a git repository').trim() };
  }

  let branch = headRef.stdout.trim();
  let detached = false;
  if (branch === 'HEAD') {
    detached = true;
    const sha = await runGitCommand(repoPath, ['rev-parse', '--short', 'HEAD']);
    branch = sha.exitCode === 0 ? sha.stdout.trim() : 'HEAD';
  }

  let upstream = null;
  let ahead = 0;
  let behind = 0;
  const up = await runGitCommand(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (up.exitCode === 0 && up.stdout.trim()) {
    upstream = up.stdout.trim();
    const counts = await runGitCommand(repoPath, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    if (counts.exitCode === 0) {
      const [b, a] = counts.stdout.trim().split(/\s+/).map(Number);
      behind = b || 0;
      ahead = a || 0;
    }
  }

  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  const porcelain = await runGitCommand(repoPath, ['status', '--porcelain']);
  if (porcelain.exitCode === 0 && porcelain.stdout) {
    for (const line of porcelain.stdout.split('\n')) {
      if (!line) continue;
      const x = line[0];
      const y = line[1];
      if (x === '?' && y === '?') {
        untracked++;
        continue;
      }
      if (x !== ' ' && x !== '?') staged++;
      if (y !== ' ' && y !== '?') unstaged++;
    }
  }

  const state = await getRepoState(repoPath);
  return {
    ok: true,
    branch,
    detached,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    dirty: staged + unstaged + untracked,
    state,
  };
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  'vendor',
  'target',
  'coverage',
]);

// Recursively find git repositories under `root` (returns paths relative to root).
// Does not descend into a directory once it's identified as a repo.
export async function findGitRepos(root, maxDepth = 3) {
  const found = [];

  async function walk(dir, depth, relPrefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (await isGitRepo(abs)) {
        found.push(rel);
        continue;
      }
      if (depth < maxDepth) await walk(abs, depth + 1, rel);
    }
  }

  await walk(root, 1, '');
  return found.sort();
}
