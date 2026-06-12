import { randomInt } from 'node:crypto';

// Crockford base32 — yields time-sortable, unambiguous IDs (ULID-style).
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

export const CHANGE_ID_TRAILER = 'Monogit-Change-Id';
export const REPOS_TRAILER = 'Monogit-Repos';

// 26-char ULID: 48-bit timestamp + 80 bits of randomness.
export function generateChangeId(time = Date.now()) {
  let ts = '';
  let t = time;
  for (let i = 0; i < TIME_LEN; i++) {
    ts = ENCODING[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (let i = 0; i < RANDOM_LEN; i++) rand += ENCODING[randomInt(32)];
  return ts + rand;
}

export function buildLinkTrailers(changeId, repoLabels) {
  return `${CHANGE_ID_TRAILER}: ${changeId}\n${REPOS_TRAILER}: ${repoLabels.join(', ')}`;
}

// Append a git trailer block, separated from the body by a blank line.
export function appendTrailers(message, trailers) {
  const body = message.replace(/\s+$/, '');
  return `${body}\n\n${trailers}\n`;
}
