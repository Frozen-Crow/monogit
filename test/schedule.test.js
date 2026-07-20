import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDependencyGraph, findCycle } from '../src/core/schedule.js';

const name = (n) => n.name;
const deps = (n) => n.deps;

test('findCycle detects a cycle and returns it', () => {
  const d = new Map([
    ['a', ['b']],
    ['b', ['c']],
    ['c', ['a']],
  ]);
  const cycle = findCycle(d);
  assert.ok(cycle, 'expected a cycle');
  assert.ok(cycle.includes('a') && cycle.includes('b') && cycle.includes('c'));
  assert.equal(findCycle(new Map([['a', ['b']], ['b', []]])), null);
});

test('runs dependencies before their dependents', async () => {
  const order = [];
  const items = [
    { name: 'shared', deps: [] },
    { name: 'api', deps: ['shared'] },
    { name: 'web', deps: ['api'] },
  ];
  await runDependencyGraph(items, name, deps, async (n) => {
    order.push(n.name);
  });
  assert.ok(order.indexOf('shared') < order.indexOf('api'), 'shared before api');
  assert.ok(order.indexOf('api') < order.indexOf('web'), 'api before web');
});

test('independent items run in parallel; a dependent waits for ALL its deps', async () => {
  const started = [];
  const finished = [];
  const items = [
    { name: 'a', deps: [] },
    { name: 'b', deps: [] },
    { name: 'c', deps: ['a', 'b'] },
  ];
  await runDependencyGraph(items, name, deps, async (n) => {
    started.push(n.name);
    await new Promise((r) => setTimeout(r, n.name === 'a' ? 20 : 5));
    finished.push(n.name);
  });
  // c must start only after both a and b finished
  assert.ok(finished.includes('a') && finished.includes('b'));
  assert.ok(started.indexOf('c') > started.indexOf('a'));
  assert.ok(finished.indexOf('a') < started.indexOf('c'), 'a finished before c started');
  assert.ok(finished.indexOf('b') < started.indexOf('c'), 'b finished before c started');
});

test('a failed dependency skips its (transitive) dependents', async () => {
  const ran = [];
  const items = [
    { name: 'shared', deps: [] },
    { name: 'api', deps: ['shared'] },
    { name: 'web', deps: ['api'] },
    { name: 'docs', deps: [] },
  ];
  const results = await runDependencyGraph(items, name, deps, async (n) => {
    ran.push(n.name);
    if (n.name === 'shared') throw new Error('boom');
  });
  assert.equal(results.get('shared').status, 'fail');
  assert.equal(results.get('api').status, 'skipped');
  assert.equal(results.get('web').status, 'skipped'); // transitive
  assert.equal(results.get('docs').status, 'ok'); // independent, unaffected
  assert.ok(!ran.includes('api') && !ran.includes('web'), 'skipped nodes never ran');
});

test('dependsOn pointing outside the set is ignored', async () => {
  const results = await runDependencyGraph(
    [{ name: 'api', deps: ['shared-not-here'] }],
    name,
    deps,
    async () => 'done'
  );
  assert.equal(results.get('api').status, 'ok');
});

test('cycle throws', async () => {
  await assert.rejects(
    runDependencyGraph(
      [
        { name: 'a', deps: ['b'] },
        { name: 'b', deps: ['a'] },
      ],
      name,
      deps,
      async () => {}
    ),
    /cycle/i
  );
});
