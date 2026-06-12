import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseList,
  normalizeEntry,
  findConfigPath,
  readConfig,
  resolveRepos,
  addRepoEntry,
  removeRepoEntry,
} from '../src/utils/config.js';

async function tmpWorkspace(config) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monogit-test-'));
  await fs.writeFile(path.join(dir, '.monogit.json'), JSON.stringify(config), 'utf8');
  return dir;
}

test('parseList splits and trims comma lists', () => {
  assert.deepEqual(parseList('a, b ,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseList(''), []);
  assert.deepEqual(parseList(undefined), []);
  assert.deepEqual(parseList(['a,b', 'c']), ['a', 'b', 'c']);
});

test('normalizeEntry handles string and object forms', () => {
  assert.deepEqual(normalizeEntry('api'), { path: 'api' });
  assert.deepEqual(normalizeEntry({ path: 'api', remote: 'git@x', branch: 'main' }), {
    path: 'api',
    remote: 'git@x',
    branch: 'main',
  });
});

test('findConfigPath walks up the directory tree', async () => {
  const root = await tmpWorkspace({ repos: ['api'] });
  const nested = path.join(root, 'api', 'src', 'deep');
  await fs.mkdir(nested, { recursive: true });
  const found = await findConfigPath(nested);
  assert.equal(found, path.join(root, '.monogit.json'));
});

test('resolveRepos returns absolute paths relative to config root, not cwd', async () => {
  const root = await tmpWorkspace({ repos: ['api', 'web'] });
  const repos = await resolveRepos({}, path.join(root, 'api'));
  assert.deepEqual(
    repos.map((r) => r.path),
    [path.join(root, 'api'), path.join(root, 'web')]
  );
});

test('resolveRepos applies --only, --except and --group filters', async () => {
  const root = await tmpWorkspace({
    repos: ['api', 'web', 'docs'],
    groups: { frontend: ['web'], backend: ['api'] },
  });
  assert.deepEqual((await resolveRepos({ only: 'api,web' }, root)).map((r) => r.name), ['api', 'web']);
  assert.deepEqual((await resolveRepos({ except: 'docs' }, root)).map((r) => r.name), ['api', 'web']);
  assert.deepEqual((await resolveRepos({ group: 'frontend' }, root)).map((r) => r.name), ['web']);
});

test('readConfig returns empty defaults when no workspace exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monogit-empty-'));
  const config = await readConfig(dir);
  assert.deepEqual(config.repos, []);
  assert.equal(config._root, null);
});

test('add/remove repo entries round-trip and dedupe', async () => {
  const root = await tmpWorkspace({ repos: ['api'] });
  assert.equal((await addRepoEntry('web', root)).added, true);
  assert.equal((await addRepoEntry('web', root)).added, false); // dedupe
  assert.deepEqual((await resolveRepos({}, root)).map((r) => r.name), ['api', 'web']);
  assert.equal((await removeRepoEntry('web', root)).removed, true);
  assert.deepEqual((await resolveRepos({}, root)).map((r) => r.name), ['api']);
});
