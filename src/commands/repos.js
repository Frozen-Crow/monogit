import chalk from 'chalk';
import path from 'node:path';
import {
  readConfig,
  resolveRepos,
  addRepoEntry,
  removeRepoEntry,
  getWorkspaceRoot,
} from '../utils/config.js';
import { isGitRepo, getRemoteUrl, getCurrentBranch } from '../utils/git.js';

export async function reposListCommand() {
  const root = await getWorkspaceRoot();
  if (!root) {
    console.log(chalk.red('\n❌ No monogit workspace found. Run `monogit init` first.\n'));
    return;
  }

  const repos = await resolveRepos();
  if (repos.length === 0) {
    console.log(chalk.yellow('\nNo repositories linked yet. Use `monogit repos add <path>`.\n'));
    return;
  }

  console.log(chalk.cyan.bold(`\n📚 ${repos.length} linked repositories ${chalk.gray(`(root: ${root})`)}\n`));
  for (const r of repos) {
    const present = await isGitRepo(r.path);
    const marker = present ? chalk.green('●') : chalk.red('○');
    const meta = [r.remote ? chalk.gray(r.remote) : null, r.branch ? chalk.gray(`@${r.branch}`) : null]
      .filter(Boolean)
      .join(' ');
    const missing = present ? '' : chalk.red('  (missing — `monogit clone`)');
    console.log(`  ${marker} ${chalk.blue(r.name)}${meta ? '  ' + meta : ''}${missing}`);
  }

  const config = await readConfig();
  const groups = config.groups || {};
  if (Object.keys(groups).length) {
    console.log(chalk.cyan.bold('\n  Groups:'));
    for (const [name, members] of Object.entries(groups)) {
      console.log(`    ${chalk.magenta(name)}: ${chalk.gray(members.join(', '))}`);
    }
  }
  console.log('');
}

export async function reposAddCommand(target) {
  const root = (await getWorkspaceRoot()) || process.cwd();
  const abs = path.resolve(process.cwd(), target);
  const rel = path.relative(root, abs) || '.';

  if (rel.startsWith('..')) {
    console.log(chalk.red(`\n❌ ${target} is outside the workspace root (${root}).\n`));
    return;
  }

  if (!(await isGitRepo(abs))) {
    console.log(chalk.red(`\n❌ ${rel} is not a git repository.\n`));
    return;
  }

  const remote = await getRemoteUrl(abs);
  const branch = await getCurrentBranch(abs);
  const entry = { path: rel, ...(remote ? { remote } : {}), ...(branch ? { branch } : {}) };

  const { added } = await addRepoEntry(entry, root);
  if (added) {
    console.log(chalk.green(`\n✅ Linked ${chalk.blue(rel)}${remote ? chalk.gray(`  (${remote})`) : ''}\n`));
  } else {
    console.log(chalk.yellow(`\nℹ️  ${rel} is already linked.\n`));
  }
}

export async function reposRemoveCommand(target) {
  const root = await getWorkspaceRoot();
  if (!root) {
    console.log(chalk.red('\n❌ No monogit workspace found.\n'));
    return;
  }
  const { removed } = await removeRepoEntry(target, root);
  if (removed) {
    console.log(chalk.green(`\n✅ Unlinked ${chalk.blue(target)} (files left untouched).\n`));
  } else {
    console.log(chalk.yellow(`\nℹ️  No linked repo matched "${target}".\n`));
  }
}
