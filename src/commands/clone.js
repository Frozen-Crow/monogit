import chalk from 'chalk';
import ora from 'ora';
import { resolveRepos, getWorkspaceRoot } from '../utils/config.js';
import { isGitRepo, runGitCommand } from '../utils/git.js';

// Reconstitute a workspace: clone every linked repo that has a remote but isn't on disk yet.
export async function cloneCommand(options = {}) {
  const root = await getWorkspaceRoot();
  if (!root) {
    console.log(chalk.red('\n❌ No monogit workspace found. Run `monogit init` first.\n'));
    return;
  }

  const repos = await resolveRepos(options);
  const withRemote = repos.filter((r) => r.remote);
  const missingRemote = repos.filter((r) => !r.remote);

  const toClone = [];
  for (const r of withRemote) {
    if (await isGitRepo(r.path)) continue; // already present
    toClone.push(r);
  }

  if (missingRemote.length) {
    console.log(
      chalk.gray(
        `\nℹ️  ${missingRemote.length} repo(s) have no recorded remote and will be skipped: ${missingRemote
          .map((r) => r.name)
          .join(', ')}`
      )
    );
  }

  if (toClone.length === 0) {
    console.log(chalk.green('\n✨ Nothing to clone — all linked repos are already present.\n'));
    return;
  }

  console.log(chalk.cyan.bold(`\n📥 Cloning ${toClone.length} repositories...\n`));

  let cloned = 0;
  let failed = 0;
  for (const r of toClone) {
    const spinner = ora(`Cloning ${chalk.blue(r.name)} from ${r.remote}...`).start();
    const args = ['clone'];
    if (r.branch) args.push('--branch', r.branch);
    args.push(r.remote, r.path);
    const result = await runGitCommand(root, args);
    if (result.exitCode === 0) {
      cloned++;
      spinner.succeed(`Cloned ${chalk.blue(r.name)}`);
    } else {
      failed++;
      spinner.fail(`Failed to clone ${chalk.blue(r.name)}`);
      if (result.all) console.log(chalk.red(result.all.replace(/^/gm, '    ')));
    }
  }

  console.log(
    '\n' +
      chalk.green(`✨ Cloned ${cloned}`) +
      (failed ? chalk.red(`, ${failed} failed`) : '') +
      chalk.gray('.\n')
  );
}
