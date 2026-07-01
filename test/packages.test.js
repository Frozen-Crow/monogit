import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePackageGraph } from '../src/core/packages.js';
import { bumpVersion, updateDependentSpec, planRelease } from '../src/core/release.js';

const entries = [
  { name: 'shared', dir: '/ws/shared', pm: 'pnpm', pkg: { name: '@acme/shared', version: '1.2.3' } },
  {
    name: 'api',
    dir: '/ws/api',
    pm: 'npm',
    pkg: { name: 'api', version: '0.5.0', dependencies: { '@acme/shared': '^1.2.0', express: '^4' } },
  },
  {
    name: 'web',
    dir: '/ws/web',
    pm: 'yarn',
    pkg: { name: 'web', version: '2.0.0', devDependencies: { '@acme/shared': '~1.2.0' } },
  },
  { name: 'docs', dir: '/ws/docs', pm: null, pkg: null },
];

test('computePackageGraph finds providers and cross-repo edges', () => {
  const { providers, edges } = computePackageGraph(entries);
  assert.equal(providers.get('@acme/shared').repo, 'shared');
  assert.equal(edges.length, 2); // api + web depend on @acme/shared; express is not in-workspace
  const api = edges.find((e) => e.consumer === 'api');
  assert.equal(api.package, '@acme/shared');
  assert.equal(api.depType, 'dependencies');
  assert.equal(api.consumerPm, 'npm');
  assert.ok(edges.every((e) => e.package === '@acme/shared'));
});

test('a package is not treated as its own consumer', () => {
  const { edges } = computePackageGraph([
    { name: 'x', dir: '/x', pm: 'npm', pkg: { name: 'x', dependencies: { x: '1.0.0' } } },
  ]);
  assert.equal(edges.length, 0);
});

test('bumpVersion handles levels and explicit versions', () => {
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.2.3', '4.0.0-beta.1'), '4.0.0-beta.1'); // explicit
  assert.equal(bumpVersion('not-semver', 'patch'), null);
});

test('updateDependentSpec preserves range operator, leaves protocols alone', () => {
  assert.equal(updateDependentSpec('^1.2.0', '1.3.0'), '^1.3.0');
  assert.equal(updateDependentSpec('~1.2.0', '1.3.0'), '~1.3.0');
  assert.equal(updateDependentSpec('1.2.0', '1.3.0'), '^1.3.0');
  assert.equal(updateDependentSpec('workspace:*', '1.3.0'), 'workspace:*');
  assert.equal(updateDependentSpec('file:../shared', '1.3.0'), 'file:../shared');
});

test('planRelease bumps providers and rewrites consumer specs', () => {
  const graph = computePackageGraph(entries);
  const { bumps, consumerUpdates } = planRelease(graph, 'minor');
  assert.equal(bumps.length, 1);
  assert.equal(bumps[0].newVersion, '1.3.0');
  assert.equal(consumerUpdates.length, 2);
  const api = consumerUpdates.find((u) => u.repo === 'api');
  assert.equal(api.newSpec, '^1.3.0');
  const web = consumerUpdates.find((u) => u.repo === 'web');
  assert.equal(web.newSpec, '~1.3.0');
});
