import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleInitConfig } from '../src/commands/init.js';

const repos = [{ path: 'api' }, { path: 'web' }];

test('minimal answers write only repos (defaults omitted)', () => {
  const cfg = assembleInitConfig(repos, { link: false, untracked: true, protectedInput: '' });
  assert.deepEqual(cfg, { repos });
});

test('commit linking is recorded only when enabled', () => {
  assert.deepEqual(assembleInitConfig(repos, { link: true, untracked: true }).commit, { link: true });
  assert.equal(assembleInitConfig(repos, { link: false, untracked: true }).commit, undefined);
});

test('tracked-only commits recorded only when untracked disabled', () => {
  assert.deepEqual(assembleInitConfig(repos, { link: false, untracked: false }).commit, { untracked: false });
});

test('both commit options combine', () => {
  assert.deepEqual(assembleInitConfig(repos, { link: true, untracked: false }).commit, {
    link: true,
    untracked: false,
  });
});

test('protected branches parse from a comma list', () => {
  assert.deepEqual(
    assembleInitConfig(repos, { protectedInput: 'develop, release/*' }).protected,
    ['develop', 'release/*']
  );
  assert.equal(assembleInitConfig(repos, { protectedInput: '  ' }).protected, undefined);
});

test('groups and voice included only when non-empty', () => {
  const cfg = assembleInitConfig(repos, {
    groups: { frontend: ['web'] },
    voice: { model: 'small.en' },
  });
  assert.deepEqual(cfg.groups, { frontend: ['web'] });
  assert.deepEqual(cfg.voice, { model: 'small.en' });

  const bare = assembleInitConfig(repos, { groups: {}, voice: {} });
  assert.equal(bare.groups, undefined);
  assert.equal(bare.voice, undefined);
});
