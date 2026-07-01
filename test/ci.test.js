import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPathDeps, toGitDependency } from '../src/core/ci.js';

test('collectPathDeps finds only file:/link: specs', () => {
  const deps = collectPathDeps({
    dependencies: { '@acme/shared': 'file:../shared', react: '^18', '@acme/ui': 'link:../ui' },
    devDependencies: { vite: '^5', '@acme/cfg': 'file:../cfg' },
  });
  assert.deepEqual(
    deps.map((d) => [d.name, d.relPath, d.field]).sort(),
    [
      ['@acme/cfg', '../cfg', 'devDependencies'],
      ['@acme/shared', '../shared', 'dependencies'],
      ['@acme/ui', '../ui', 'dependencies'],
    ]
  );
});

test('toGitDependency converts scp-style remotes', () => {
  assert.equal(
    toGitDependency('git@github.com:acme/shared.git', 'v1.2.3'),
    'git+ssh://git@github.com/acme/shared.git#v1.2.3'
  );
});

test('toGitDependency handles https remotes and missing ref', () => {
  assert.equal(toGitDependency('https://github.com/acme/shared.git', 'main'), 'git+https://github.com/acme/shared.git#main');
  assert.equal(toGitDependency('https://github.com/acme/shared.git'), 'git+https://github.com/acme/shared.git');
});
