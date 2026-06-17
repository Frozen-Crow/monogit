import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, normalizeBranch, isStopWord, isAffirmative } from '../src/core/voice.js';

test('normalizeBranch turns speech into a branch name', () => {
  assert.equal(normalizeBranch('feature slash login page'), 'feature/login-page');
  assert.equal(normalizeBranch('Fix The Bug'), 'fix-the-bug');
  assert.equal(normalizeBranch('release forward slash 1 2 0'), 'release/1-2-0');
});

test('interpret recognizes read commands', () => {
  assert.equal(interpret('status').kind, 'status');
  assert.equal(interpret("what's the status").kind, 'status');
  assert.equal(interpret('show me the log').kind, 'log');
  assert.equal(interpret('list repos').kind, 'list');
  assert.equal(interpret('tidy up branches').kind, 'tidy');
  assert.equal(interpret('show changes').kind, 'diff');
  assert.equal(interpret('show change').kind, 'show');
});

test('interpret recognizes write commands and marks them write', () => {
  const commit = interpret('commit message fix the login bug');
  assert.equal(commit.kind, 'commit');
  assert.equal(commit.message, 'fix the login bug');
  assert.equal(commit.write, true);

  const create = interpret('new branch feature slash login');
  assert.equal(create.kind, 'branch-create');
  assert.equal(create.branch, 'feature/login');

  assert.equal(interpret('checkout main').kind, 'checkout');
  assert.equal(interpret('push').kind, 'push');
  assert.equal(interpret('push').write, true);
});

test('interpret recognizes merge with a branch', () => {
  const m = interpret('merge develop');
  assert.equal(m.kind, 'merge');
  assert.equal(m.branch, 'develop');
  assert.equal(m.write, true);
  assert.equal(interpret('merge in main').branch, 'main');
  assert.equal(interpret('merge branch feature slash login').branch, 'feature/login');
});

test('interpret preserves commit message casing from the original', () => {
  assert.equal(interpret('commit message Fix Login').message, 'Fix Login');
});

test('"commit" with no message asks for one', () => {
  assert.equal(interpret('commit').kind, 'need-message');
  assert.equal(interpret('commit my changes').kind, 'need-message');
});

test('strips wake words and politeness', () => {
  assert.equal(interpret('hey monogit, status').kind, 'status');
  assert.equal(interpret('please push').kind, 'push');
});

test('unrecognized phrases return unknown', () => {
  assert.equal(interpret('make me a sandwich').kind, 'unknown');
});

test('isStopWord ends the session on stop phrases', () => {
  assert.equal(isStopWord('stop'), true);
  assert.equal(isStopWord('stop listening'), true);
  assert.equal(isStopWord("that's all"), true);
  assert.equal(isStopWord('goodbye'), true);
  assert.equal(isStopWord('push'), false);
});

test('isAffirmative recognizes spoken yes', () => {
  assert.equal(isAffirmative('yes'), true);
  assert.equal(isAffirmative('yeah do it'), true);
  assert.equal(isAffirmative('go ahead'), true);
  assert.equal(isAffirmative('no'), false);
  assert.equal(isAffirmative('cancel'), false);
});
