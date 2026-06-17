import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageUntrackedDefault } from '../src/core/commit.js';

test('stageUntrackedDefault defaults to true (commit everything)', () => {
  assert.equal(stageUntrackedDefault(undefined), true);
  assert.equal(stageUntrackedDefault({}), true);
});

test('commit.untracked is the canonical toggle', () => {
  assert.equal(stageUntrackedDefault({ commit: { untracked: false } }), false);
  assert.equal(stageUntrackedDefault({ commit: { untracked: true } }), true);
});

test('voice.commitUntracked is honored for back-compat', () => {
  assert.equal(stageUntrackedDefault({ voice: { commitUntracked: false } }), false);
});

test('commit.untracked takes precedence over voice.commitUntracked', () => {
  assert.equal(stageUntrackedDefault({ commit: { untracked: false }, voice: { commitUntracked: true } }), false);
});
