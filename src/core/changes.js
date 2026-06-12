import { runGitCommand } from '../utils/git.js';
import { mapLimit } from '../utils/concurrency.js';
import { CHANGE_ID_TRAILER } from '../utils/link.js';

const US = '\x1f'; // unit separator between fields

// Pull every commit that carries a Monogit-Change-Id, with its id.
// The trailer placeholder is last because git appends a newline after it.
export async function commitsWithChangeId(repoPath) {
  const fmt = ['%h', '%s', '%cr', `%(trailers:key=${CHANGE_ID_TRAILER},valueonly)`].join(US);
  const r = await runGitCommand(repoPath, ['log', '--all', '--no-color', `--pretty=format:${fmt}`]);
  if (r.exitCode !== 0 || !r.stdout) return [];
  return r.stdout
    .split('\n')
    .map((line) => line.split(US))
    .filter((f) => f.length >= 4 && f[3] && f[3].trim())
    .map(([sha, subject, when, changeId]) => ({ sha, changeId: changeId.trim(), subject, when }));
}

// Flatten linked commits across all repos into rows.
export async function collectChanges(repos, concurrency = 8) {
  const settled = await mapLimit(repos, concurrency, async (repo) => ({
    repo: repo.name,
    commits: await commitsWithChangeId(repo.path),
  }));
  const rows = [];
  for (const entry of settled) {
    if (entry.status !== 'fulfilled') continue;
    for (const c of entry.value.commits) rows.push({ repo: entry.value.repo, ...c });
  }
  return rows;
}

export function latestChangeId(rows) {
  if (rows.length === 0) return null;
  return rows.reduce((max, r) => (r.changeId > max ? r.changeId : max), rows[0].changeId);
}

// Resolve which change to show, then return its matching rows.
export function selectChange(rows, changeId) {
  const target = changeId || latestChangeId(rows);
  if (!target) return { target: null, matches: [] };
  const matches = rows.filter((r) => r.changeId === target || r.changeId.startsWith(target));
  return { target: matches[0]?.changeId || target, matches };
}
