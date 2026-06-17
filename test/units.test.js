import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatcher } from '../src/utils/match.js';
import { mapLimit } from '../src/utils/concurrency.js';
import { classifyResult } from '../src/commands/git-proxy.js';
import { resolvePushArgs } from '../src/utils/git.js';

test('makeMatcher supports exact names and * globs', () => {
  const m = makeMatcher(['main', 'release/*']);
  assert.equal(m('main'), true);
  assert.equal(m('release/1.2'), true);
  assert.equal(m('release'), false);
  assert.equal(m('feature/x'), false);
});

test('mapLimit preserves order and bounds concurrency', async () => {
  let active = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return n * 10;
  });
  assert.deepEqual(results.map((r) => r.value), [10, 20, 30, 40, 50]);
  assert.ok(peak <= 2, `peak concurrency ${peak} should be <= 2`);
});

test('mapLimit captures rejections without aborting', async () => {
  const results = await mapLimit([1, 2, 3], 3, async (n) => {
    if (n === 2) throw new Error('boom');
    return n;
  });
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[2].status, 'fulfilled');
});

test('resolvePushArgs defaults to origin HEAD with tracking when no remote', () => {
  assert.deepEqual(resolvePushArgs(), ['-u', 'origin', 'HEAD']);
  assert.deepEqual(resolvePushArgs(undefined, undefined), ['-u', 'origin', 'HEAD']);
  assert.deepEqual(resolvePushArgs('origin'), ['origin']);
  assert.deepEqual(resolvePushArgs('upstream', 'main'), ['upstream', 'main']);
});

test('classifyResult distinguishes ok, noop and fail', () => {
  assert.equal(classifyResult({ exitCode: 0, all: 'done' }), 'ok');
  assert.equal(classifyResult({ exitCode: 1, all: 'nothing to commit, working tree clean' }), 'noop');
  assert.equal(classifyResult({ exitCode: 0, all: 'Everything up-to-date' }), 'noop');
  assert.equal(classifyResult({ exitCode: 1, all: 'error: pathspec broken' }), 'fail');
});
