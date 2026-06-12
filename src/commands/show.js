import chalk from 'chalk';
import ora from 'ora';
import { resolveRepos } from '../utils/config.js';
import { concurrencyFrom, noReposNotice } from '../utils/ui.js';
import { collectChanges, selectChange } from '../core/changes.js';

export async function showCommand(changeId, options = {}) {
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  const spinner = ora('Searching for change...').start();
  const rows = await collectChanges(repos, concurrencyFrom(options));
  spinner.stop();

  if (rows.length === 0 && !changeId) {
    console.log(chalk.yellow('\nNo linked changes found. Commit with linking enabled first.\n'));
    return;
  }

  const { target, matches } = selectChange(rows, changeId);

  if (options.json) {
    console.log(JSON.stringify(matches, null, 2));
    return;
  }

  if (matches.length === 0) {
    console.log(chalk.yellow(`\nNo commits found for change "${target}".\n`));
    return;
  }

  const repoSet = new Set(matches.map((m) => m.repo));
  console.log(
    chalk.cyan.bold(`\n🔗 Change ${target} `) +
      chalk.gray(`(${repoSet.size} repo${repoSet.size === 1 ? '' : 's'})\n`)
  );

  const pad = Math.max(...matches.map((m) => m.repo.length));
  for (const m of matches) {
    console.log(
      `  ${chalk.blue(m.repo.padEnd(pad))}  ${chalk.yellow(m.sha)}  ${m.subject} ${chalk.gray(`(${m.when})`)}`
    );
  }
  console.log('');
}
