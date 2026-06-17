import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard, KEY_LEGEND } from '../src/core/watch-render.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const rows = [
  { repo: 'api', st: { ok: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: 0, state: 'clean' } },
  { repo: 'web', st: { ok: true, branch: 'feature/login', upstream: 'origin/feature/login', ahead: 2, behind: 0, staged: 1, unstaged: 3, untracked: 0, dirty: 4, state: 'clean' } },
  { repo: 'infra', st: { ok: true, branch: 'main', upstream: null, ahead: 0, behind: 4, staged: 0, unstaged: 0, untracked: 2, dirty: 2, state: 'rebasing' } },
];

test('renderDashboard lists every repo and the key legend', () => {
  const text = strip(renderDashboard({ rows, selected: 0, root: '/ws', time: '12:00:00' }).join('\n'));
  for (const name of ['api', 'web', 'infra']) assert.ok(text.includes(name), `missing ${name}`);
  assert.ok(text.includes('monogit watch'));
  assert.ok(text.includes(KEY_LEGEND.split(' · ')[0])); // legend present
});

test('selected repo is marked', () => {
  const lines = renderDashboard({ rows, selected: 1, root: '/ws', time: 't' }).map(strip);
  const webLine = lines.find((l) => l.includes('web'));
  assert.ok(webLine.includes('▸'), 'selected row should have the ▸ marker');
});

test('clean vs dirty rendering and counts', () => {
  const text = strip(renderDashboard({ rows, selected: 0, root: '/ws', time: 't' }).join('\n'));
  assert.ok(text.includes('clean'));
  assert.ok(/\+1 ~3/.test(text), 'web changes shown');
  assert.ok(text.includes('⚠ rebasing'), 'in-progress state flagged');
  assert.ok(/1 clean/.test(text) && /2 dirty/.test(text), 'summary counts');
});

test('busy state shows the message with an indicator', () => {
  const text = strip(renderDashboard({ rows, selected: 0, busy: true, message: 'fetch…', root: '/ws', time: 't' }).join('\n'));
  assert.ok(text.includes('fetch…'));
});

test('error rows render without throwing', () => {
  const text = strip(
    renderDashboard({ rows: [{ repo: 'gone', st: { ok: false, error: 'not a git repository' } }], selected: 0, root: '/ws', time: 't' }).join('\n')
  );
  assert.ok(text.includes('gone'));
  assert.ok(text.includes('not a git repository'));
});
