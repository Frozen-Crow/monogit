import { execa } from 'execa';
import { runGitCommand, getCurrentBranch, getDefaultBranch } from '../utils/git.js';

export async function hasGh() {
  try {
    await execa('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

// True when `branch` has commits that `base` doesn't (i.e. there's something to PR).
async function hasCommitsAhead(repoPath, base, branch) {
  const r = await runGitCommand(repoPath, ['rev-list', '--count', `${base}..${branch}`]);
  if (r.exitCode !== 0) return true; // can't tell — let gh decide
  return (parseInt(r.stdout.trim(), 10) || 0) > 0;
}

// Returns { repo, status: 'ok'|'skip'|'fail', url?, reason? }.
export async function openPrForRepo(repo, options) {
  const branch = await getCurrentBranch(repo.path);
  if (!branch) return { repo: repo.name, status: 'skip', reason: 'detached HEAD' };

  const base = options.base || (await getDefaultBranch(repo.path)) || 'main';
  if (branch === base) return { repo: repo.name, status: 'skip', reason: `on base branch (${base})` };

  if (!(await hasCommitsAhead(repo.path, base, branch))) {
    return { repo: repo.name, status: 'skip', reason: `no commits ahead of ${base}` };
  }

  if (options.push !== false) {
    const push = await runGitCommand(repo.path, ['push', '-u', 'origin', branch]);
    if (push.exitCode !== 0) {
      return { repo: repo.name, status: 'fail', reason: (push.all || 'push failed').trim() };
    }
  }

  const args = ['pr', 'create', '--base', base, '--head', branch];
  if (options.draft) args.push('--draft');
  if (options.web) args.push('--web');
  if (options.fill) args.push('--fill');
  if (options.title) args.push('--title', options.title);
  if (options.body !== undefined) args.push('--body', options.body || '');
  if (!options.fill && !options.title && !options.web) args.push('--fill');

  const result = await execa('gh', args, { cwd: repo.path, reject: false, all: true });
  if (result.exitCode === 0) {
    const url = (result.stdout || '').trim().split('\n').pop();
    return { repo: repo.name, status: 'ok', url };
  }
  const text = (result.all || '').trim();
  if (/already exists/i.test(text)) return { repo: repo.name, status: 'skip', reason: 'PR already exists' };
  return { repo: repo.name, status: 'fail', reason: text };
}
