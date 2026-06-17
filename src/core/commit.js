import { runGitCommand, getCurrentBranch, repoHasPendingCommit } from '../utils/git.js';
import { mapLimit } from '../utils/concurrency.js';
import { generateChangeId, buildLinkTrailers, appendTrailers } from '../utils/link.js';
import { classifyResult } from '../commands/git-proxy.js';

// Should an interactive commit (voice/watch) stage untracked files too?
// Canonical key is commit.untracked; voice.commitUntracked is honored for back-compat.
// Defaults to true ("commit everything").
export function stageUntrackedDefault(config) {
  if (config?.commit?.untracked !== undefined) return config.commit.untracked !== false;
  if (config?.voice?.commitUntracked !== undefined) return config.voice.commitUntracked !== false;
  return true;
}

// Commit `message` across repos that actually have pending changes.
// When `link` is set, stamps every commit with a shared Monogit-Change-Id trailer
// listing the participating repos. Returns structured results (no console output).
// `addAll` stages everything first (`git add -A`, including untracked files);
// `all` is git's `-a` (tracked modifications only).
export async function performCommit({
  repos,
  message,
  all = false,
  addAll = false,
  paths = [],
  link = false,
  concurrency = 8,
}) {
  await Promise.all(
    repos.map(async (r) => {
      if (r.branch === undefined) r.branch = await getCurrentBranch(r.path);
      if (addAll && paths.length === 0) await runGitCommand(r.path, ['add', '-A']);
      // After `add -A` the changes are staged, so detect with staged semantics.
      r.pending = await repoHasPendingCommit(r.path, { all: addAll ? false : all, paths });
    })
  );

  const participants = repos.filter((r) => r.pending);
  const skipped = repos.filter((r) => !r.pending).map((r) => r.name);

  let changeId = null;
  let finalMessage = message;
  if (link && participants.length > 0) {
    changeId = generateChangeId();
    const labels = participants.map((r) => `${r.name}${r.branch ? `@${r.branch}` : ''}`);
    finalMessage = appendTrailers(message, buildLinkTrailers(changeId, labels));
  }

  const args = ['commit', '-m', finalMessage];
  if (all && !addAll) args.push('-a');
  if (paths.length) args.push('--', ...paths);

  const settled = await mapLimit(participants, concurrency, async (repo) => {
    const result = await runGitCommand(repo.path, args);
    return {
      repo: repo.name,
      status: classifyResult(result),
      exitCode: result.exitCode,
      output: (result.all || '').trim(),
    };
  });

  const results = settled.map((e) =>
    e.status === 'fulfilled' ? e.value : { repo: '?', status: 'fail', output: String(e.reason) }
  );

  return { changeId, results, skipped };
}
