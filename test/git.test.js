import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import {
  isGitRepo,
  getCurrentBranch,
  getDefaultBranch,
  getRepoStatus,
  listLocalBranches,
  findGitRepos,
} from '../src/utils/git.js';

let root;
let repo;
const env = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

async function git(cwd, args) {
  return execa('git', args, { cwd, env });
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'monogit-git-'));
  repo = path.join(root, 'repoA');
  await fs.mkdir(repo, { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await fs.writeFile(path.join(repo, 'f.txt'), 'hello');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'init']);
  await git(repo, ['branch', 'feature/x']);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('isGitRepo detects a normal repo and rejects a plain dir', async () => {
  assert.equal(await isGitRepo(repo), true);
  assert.equal(await isGitRepo(root), false);
});

test('isGitRepo accepts a linked worktree (.git is a file)', async () => {
  const wt = path.join(root, 'wt');
  await git(repo, ['worktree', 'add', wt, 'feature/x']);
  const stat = await fs.stat(path.join(wt, '.git'));
  assert.equal(stat.isFile(), true, '.git should be a file in a worktree');
  assert.equal(await isGitRepo(wt), true);
});

test('current and default branch resolution', async () => {
  assert.equal(await getCurrentBranch(repo), 'main');
  assert.equal(await getDefaultBranch(repo), 'main');
});

test('getRepoStatus reports clean, then dirty', async () => {
  let st = await getRepoStatus(repo);
  assert.equal(st.ok, true);
  assert.equal(st.branch, 'main');
  assert.equal(st.dirty, 0);
  assert.equal(st.state, 'clean');

  await fs.writeFile(path.join(repo, 'new.txt'), 'x');
  st = await getRepoStatus(repo);
  assert.equal(st.untracked, 1);
  assert.equal(st.dirty, 1);
});

test('listLocalBranches returns all heads', async () => {
  const names = (await listLocalBranches(repo)).map((b) => b.name).sort();
  assert.deepEqual(names, ['feature/x', 'main']);
});

test('findGitRepos discovers nested repos and skips node_modules', async () => {
  const nmPkg = path.join(root, 'node_modules', 'pkg');
  await fs.mkdir(nmPkg, { recursive: true });
  await git(nmPkg, ['init']);
  const found = await findGitRepos(root, 3);
  assert.ok(found.includes('repoA'));
  assert.ok(!found.some((r) => r.startsWith('node_modules')), 'should not descend into node_modules');
});
