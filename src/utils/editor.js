import { execa } from 'execa';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Resolve the editor git itself would use (respects $GIT_EDITOR, core.editor, $VISUAL, $EDITOR).
export async function resolveGitEditor(cwd) {
  const r = await execa('git', ['var', 'GIT_EDITOR'], { cwd, reject: false });
  if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim();
  return process.env.VISUAL || process.env.EDITOR || 'vi';
}

// Strip git-style comment lines and collapse blank lines (git's default "strip" cleanup).
export function cleanupMessage(raw) {
  const text = raw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

function buildTemplate(repos) {
  const lines = [
    '',
    '',
    '# Please enter the commit message for your changes. This message will be',
    `# applied to all ${repos.length} linked repositories.`,
    '#',
    "# Lines starting with '#' are ignored, and an empty message aborts the commit.",
    '#',
    '# Repositories:',
    ...repos.map((r) => `#   ${r.name}${r.branch ? ` @ ${r.branch}` : ''}`),
    '',
  ];
  return lines.join('\n');
}

// Open the user's editor once and return a single shared commit message.
// Throws if there's no TTY (e.g. CI) or the editor exits non-zero.
export async function captureCommitMessage({ repos, cwd }) {
  if (!process.stdin.isTTY) {
    throw new Error('no commit message provided and no terminal is available for the editor (use -m)');
  }

  const file = path.join(os.tmpdir(), `MONOGIT_COMMIT_${process.pid}_${Date.now()}.txt`);
  await fs.writeFile(file, buildTemplate(repos), 'utf8');

  try {
    const editor = await resolveGitEditor(cwd);
    await execa(`${editor} "${file}"`, { shell: true, stdio: 'inherit' });
    const raw = await fs.readFile(file, 'utf8');
    return cleanupMessage(raw);
  } finally {
    await fs.rm(file, { force: true });
  }
}
