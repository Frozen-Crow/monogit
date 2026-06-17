import chalk from 'chalk';
import ora from 'ora';
import { resolveRepos, readConfig } from '../utils/config.js';
import { getCurrentBranch } from '../utils/git.js';
import { concurrencyFrom, noReposNotice } from '../utils/ui.js';
import { captureCommitMessage } from '../utils/editor.js';
import { performCommit } from '../core/commit.js';

export async function commitCommand(paths, options = {}, command) {
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  const config = await readConfig();
  // --link / --no-link override the workspace default (commit.link in .monogit.json).
  const linkSource = command?.getOptionValueSource?.('link');
  const doLink = linkSource === 'cli' ? Boolean(options.link) : config.commit?.link === true;

  // Branch labels are needed for the editor template and the trailer.
  await Promise.all(repos.map(async (r) => (r.branch = await getCurrentBranch(r.path))));

  const messages = Array.isArray(options.message) ? options.message : options.message ? [options.message] : [];
  let message = messages.join('\n\n');
  if (!message) {
    try {
      message = await captureCommitMessage({ repos, cwd: repos[0].path });
    } catch (err) {
      console.log(chalk.red(`\n❌ ${err.message}\n`));
      return;
    }
    if (!message) {
      console.log(chalk.yellow('\nAborting commit due to empty commit message.\n'));
      return;
    }
  }

  const spinner = ora(`Committing across ${repos.length} repos...`).start();
  const { changeId, results, skipped } = await performCommit({
    repos,
    message,
    all: Boolean(options.a),
    addAll: Boolean(options.addAll || options.allFiles),
    paths: paths || [],
    link: doLink,
    concurrency: concurrencyFrom(options),
  });
  spinner.stop();

  if (changeId) {
    console.log(chalk.cyan(`\n📦 Committed `) + chalk.gray(`(Change-Id ${changeId})\n`));
  } else {
    console.log(chalk.cyan(`\n📦 Committed across ${results.length} repositories\n`));
  }

  let ok = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === 'ok') {
      ok++;
      console.log(`${chalk.green('✔')} ${chalk.blue(r.repo)} ${chalk.gray('(Committed)')}`);
    } else if (r.status === 'noop') {
      console.log(`${chalk.gray('–')} ${chalk.blue(r.repo)} ${chalk.gray('(Nothing to do)')}`);
    } else {
      fail++;
      console.log(`${chalk.red('✖')} ${chalk.blue(r.repo)} ${chalk.red('(Failed)')}`);
      if (r.output) console.log(chalk.red(r.output.replace(/^/gm, '    ')));
    }
  }
  for (const name of skipped) {
    console.log(`${chalk.gray('–')} ${chalk.blue(name)} ${chalk.gray('(Nothing to do)')}`);
  }

  const parts = [chalk.green(`${ok} committed`)];
  if (skipped.length) parts.push(chalk.gray(`${skipped.length} skipped`));
  if (fail) parts.push(chalk.red(`${fail} failed`));
  console.log('\n' + parts.join(chalk.gray(' · ')));
  if (changeId) {
    console.log(chalk.gray(`🔗 Linked as ${changeId} — run \`monogit show ${changeId}\` to view.`));
  }
  console.log('');
}
