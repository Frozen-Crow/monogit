import chalk from 'chalk';
import boxen from 'boxen';
import { runGitCommand } from '../utils/git.js';
import { resolveRepos } from '../utils/config.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';

export async function visualCommand(cmdName, args, options = {}) {
  const repos = await resolveRepos(options);

  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  // Sensible defaults for the read-only "visual" commands.
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

  const results = await mapLimit(repos, concurrencyFrom(options), async (repo) => {
    const result = await runGitCommand(repo.path, gitArgs);
    return { repo, result };
  });

  for (const entry of results) {
    if (entry.status !== 'fulfilled') {
      console.log(chalk.red(`\n✖ Error: ${entry.reason}\n`));
      continue;
    }
    const { repo, result } = entry.value;
    const output = result.all || chalk.gray('(No output)');
    console.log(
      boxen(output, {
        title: chalk.bold.blue(` Repo: ${repo.name} `),
        titleAlignment: 'left',
        padding: 1,
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderStyle: 'round',
        borderColor: result.exitCode === 0 ? 'cyan' : 'red',
      })
    );
  }
}
