import chalk from 'chalk';
import ora from 'ora';
import { resolveRepos } from '../utils/config.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';
import { hasGh, openPrForRepo } from '../core/pr.js';

export async function prCommand(options = {}) {
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  if (!(await hasGh())) {
    console.log(
      chalk.red('\n❌ The GitHub CLI (`gh`) is required for `monogit pr`.\n') +
        chalk.gray('   Install it from https://cli.github.com and run `gh auth login`.\n')
    );
    return;
  }

  console.log(chalk.cyan.bold(`\n🔀 Opening pull requests across ${repos.length} repositories...\n`));
  const spinner = ora('Creating PRs...').start();
  const settled = await mapLimit(repos, concurrencyFrom(options), (repo) => openPrForRepo(repo, options));
  spinner.stop();

  const rows = settled.map((e) =>
    e.status === 'fulfilled' ? e.value : { repo: '?', status: 'fail', reason: String(e.reason) }
  );

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  let opened = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.status === 'ok') {
      opened++;
      console.log(`${chalk.green('✔')} ${chalk.blue(r.repo)} ${chalk.gray('—')} ${r.url || 'created'}`);
    } else if (r.status === 'skip') {
      skipped++;
      console.log(`${chalk.gray('–')} ${chalk.blue(r.repo)} ${chalk.gray(`(${r.reason})`)}`);
    } else {
      failed++;
      console.log(`${chalk.red('✖')} ${chalk.blue(r.repo)} ${chalk.red('(failed)')}`);
      if (r.reason) console.log(chalk.red(r.reason.replace(/^/gm, '    ')));
    }
  }

  const parts = [chalk.green(`${opened} opened`)];
  if (skipped) parts.push(chalk.gray(`${skipped} skipped`));
  if (failed) parts.push(chalk.red(`${failed} failed`));
  console.log('\n' + parts.join(chalk.gray(' · ')) + '\n');
}
