import chalk from 'chalk';
import boxen from 'boxen';
import { runGitCommand } from '../utils/git.js';
import { getRepos } from '../utils/config.js';

export async function visualCommand(cmdName, args) {
  const repos = await getRepos();

  if (repos.length === 0) {
    console.log(chalk.red('\n❌ No repositories linked. Run `monogit init` first.\n'));
    return;
  }

  // Determine git args based on command type
  let gitArgs = [cmdName, ...args];
  if (cmdName === 'log' && args.length === 0) {
    gitArgs = ['log', '--oneline', '-n', '5', '--graph', '--color'];
  } else if (cmdName === 'diff' && args.length === 0) {
    gitArgs = ['diff', '--color'];
  } else if (cmdName === 'status' && args.length === 0) {
    gitArgs = ['-c', 'color.status=always', 'status'];
  } else if (cmdName === 'branch' && args.length === 0) {
    gitArgs = ['branch', '--color'];
  }

  console.log(chalk.cyan(`\n🔍 Fetching ${cmdName.toUpperCase()} for ${repos.length} repositories...\n`));

  // Run all repos in parallel
  const results = await Promise.allSettled(
    repos.map(async (repo) => {
      const result = await runGitCommand(repo, gitArgs);
      return { repo, result };
    })
  );

  // Render boxes in order
  for (const entry of results) {
    if (entry.status === 'fulfilled') {
      const { repo, result } = entry.value;
      const output = result.all || chalk.gray('(No output)');

      const boxBuffer = boxen(output, {
        title: chalk.bold.blue(` Repo: ${repo} `),
        titleAlignment: 'left',
        padding: 1,
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderStyle: 'round',
        borderColor: result.exitCode === 0 ? 'cyan' : 'red',
      });

      console.log(boxBuffer);
    } else {
      console.log(chalk.red(`\n✖ Error: ${entry.reason}\n`));
    }
  }
}
