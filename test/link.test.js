import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChangeId, buildLinkTrailers, appendTrailers } from '../src/utils/link.js';
import { cleanupMessage } from '../src/utils/editor.js';

test('generateChangeId produces 26-char Crockford base32 ULIDs', () => {
  const id = generateChangeId();
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('change ids are time-sortable', () => {
  const early = generateChangeId(1000);
  const late = generateChangeId(2_000_000_000_000);
  assert.ok(late > early, 'a later timestamp should sort after an earlier one');
});

test('buildLinkTrailers + appendTrailers form a valid git trailer block', () => {
  const trailers = buildLinkTrailers('01ABC', ['api@main', 'web@main']);
  const message = appendTrailers('feat: thing\n', trailers);
  assert.equal(
    message,
    'feat: thing\n\nMonogit-Change-Id: 01ABC\nMonogit-Repos: api@main, web@main\n'
  );
  // blank line separates body from trailers
  assert.ok(/\n\nMonogit-Change-Id:/.test(message));
});

test('cleanupMessage strips comments and collapses blank lines', () => {
  assert.equal(cleanupMessage('feat: hi\n\n# comment\nbody\n\n\n#x\n  \n'), 'feat: hi\n\nbody');
  assert.equal(cleanupMessage('# only comments\n#more\n'), '');
});
