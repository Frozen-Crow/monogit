import chalk from 'chalk';
import ora from 'ora';
import { runGitCommand } from '../utils/git.js';
import { getRepos } from '../utils/config.js';

export async function gitProxyCommand(cmdName, args) {
  const repos = await getRepos();

  if (repos.length === 0) {
    console.log(chalk.red('\n❌ No repositories linked. Run `monogit init` first.\n'));
    return;
  }

  console.log(chalk.cyan(`\n📦 Running 'git ${cmdName}${args.length ? ' ' + args.join(' ') : ''}' in ${repos.length} repositories...\n`));

  const spinner = ora(`Running across ${repos.length} repos...`).start();

  // Run all repos in parallel
  const results = await Promise.allSettled(
    repos.map(async (repo) => {
      const result = await runGitCommand(repo, [cmdName, ...args]);
      return { repo, result };
    })
  );

  spinner.stop();

  // Print results in order
  for (const entry of results) {
    if (entry.status === 'fulfilled') {
      const { repo, result } = entry.value;
      if (result.exitCode === 0) {
        console.log(`${chalk.green('✔')} Repo: ${chalk.blue(repo)} ${chalk.gray('(Success)')}`);
      } else {
        console.log(`${chalk.red('✖')} Repo: ${chalk.blue(repo)} ${chalk.red('(Failed)')}`);
        if (result.all) {
          console.log(chalk.red(result.all));
        }
      }
    } else {
      console.log(`${chalk.red('✖')} ${chalk.red('(Error)')} ${entry.reason}`);
    }
  }
  console.log('');
}
