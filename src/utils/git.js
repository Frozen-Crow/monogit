import { execa } from 'execa';
import path from 'node:path';
import fs from 'node:fs/promises';

export async function isGitRepo(dir) {
  try {
    const gitDir = path.join(dir, '.git');
    const stats = await fs.stat(gitDir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function runGitCommand(repoPath, args) {
  try {
    const { all, stdout, stderr, exitCode } = await execa('git', args, {
      cwd: repoPath,
      reject: false,
      all: true,
    });
    return { all, stdout, stderr, exitCode };
  } catch (error) {
    return {
      all: error.all || error.message,
      stdout: error.stdout,
      stderr: error.stderr,
      exitCode: error.exitCode || 1,
    };
  }
}

export async function initGitRepo(repoPath) {
  return await runGitCommand(repoPath, ['init']);
}

export async function listSubdirectories(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
}
