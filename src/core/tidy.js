import { makeMatcher } from '../utils/match.js';
import {
  getCurrentBranch,
  getDefaultBranch,
  listLocalBranches,
  listMergedBranches,
  deleteBranch,
} from '../utils/git.js';

// Classify a single repo's branches into orphan candidates.
// Returns { repo, base, current, candidates: [{ repo, cwd, name, rel, category }] }.
export async function scanRepoForOrphans(repo, want, staleDays, protectedPatterns) {
  const cwd = repo.path;
  const current = await getCurrentBranch(cwd);
  const base = await getDefaultBranch(cwd);

  const isProtected = makeMatcher([
    ...protectedPatterns,
    ...(base ? [base] : []),
    ...(current ? [current] : []),
  ]);

  const branches = await listLocalBranches(cwd);
  const merged = want.merged && base ? await listMergedBranches(cwd, base) : new Set();
  const nowSec = Date.now() / 1000;

  const candidates = [];
  for (const b of branches) {
    if (isProtected(b.name)) continue;

    let category = null;
    if (want.gone && b.gone) category = 'gone';
    else if (want.merged && b.name !== base && merged.has(b.name)) category = 'merged';
    else if (want.stale && b.unix && nowSec - b.unix > staleDays * 86400) category = 'stale';

    if (category) candidates.push({ repo: repo.name, cwd, name: b.name, rel: b.rel, category });
  }

  return { repo: repo.name, base, current, candidates };
}

// `gone` branches are usually squash-merged, so safe -d would refuse them → force.
export async function deleteCandidate(candidate) {
  const force = candidate.category === 'gone';
  const r = await deleteBranch(candidate.cwd, candidate.name, force);
  return { repo: candidate.repo, name: candidate.name, ok: r.exitCode === 0, output: (r.all || '').trim(), force };
}
