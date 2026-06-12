import chalk from 'chalk';
import ora from 'ora';
import { resolveRepos, readConfig } from '../utils/config.js';
import { runGitCommand, getCurrentBranch, repoHasPendingCommit } from '../utils/git.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';
import { captureCommitMessage } from '../utils/editor.js';
import { generateChangeId, buildLinkTrailers, appendTrailers } from '../utils/link.js';
import { gitProxyCommand, classifyResult } from './git-proxy.js';

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

  // Attach a current-branch label to each repo (for the editor template + trailer).
  await Promise.all(repos.map(async (r) => (r.branch = await getCurrentBranch(r.path))));

  // Resolve the commit message: -m (repeatable) or the editor.
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

  const baseArgs = [];
  if (options.a) baseArgs.push('-a');
  if (paths && paths.length > 0) baseArgs.push('--', ...paths);

  if (!doLink) {
    await gitProxyCommand('commit', ['-m', message, ...baseArgs], options);
    return;
  }

  await linkedCommit({ repos, message, options, paths: paths || [] });
}

async function linkedCommit({ repos, message, options, paths }) {
  // Only stamp repos that will actually produce a commit.
  await Promise.all(
    repos.map(async (r) => (r.pending = await repoHasPendingCommit(r.path, { all: Boolean(options.a), paths })))
  );
  const participants = repos.filter((r) => r.pending);
  const skipped = repos.filter((r) => !r.pending);

  if (participants.length === 0) {
    console.log(chalk.gray('\n– Nothing to commit in any repository.\n'));
    return;
  }

  const changeId = generateChangeId();
  const labels = participants.map((r) => `${r.name}${r.branch ? `@${r.branch}` : ''}`);
  const fullMessage = appendTrailers(message, buildLinkTrailers(changeId, labels));

  console.log(
    chalk.cyan(`\n📦 Committing across ${participants.length} repositories `) +
      chalk.gray(`(Change-Id ${changeId})\n`)
  );

  const spinner = ora('Committing...').start();
  const args = ['-m', fullMessage];
  if (options.a) args.push('-a');
  if (paths.length) args.push('--', ...paths);
  const results = await mapLimit(participants, concurrencyFrom(options), async (repo) => {
    const result = await runGitCommand(repo.path, ['commit', ...args]);
    return { repo, result };
  });
  spinner.stop();

  let ok = 0;
  let fail = 0;
  for (const entry of results) {
    if (entry.status !== 'fulfilled') {
      fail++;
      console.log(`${chalk.red('✖')} ${chalk.red('(Error)')} ${entry.reason}`);
      continue;
    }
    const { repo, result } = entry.value;
    const cls = classifyResult(result);
    if (cls === 'ok') {
      ok++;
      console.log(`${chalk.green('✔')} ${chalk.blue(repo.name)} ${chalk.gray('(Committed)')}`);
    } else if (cls === 'noop') {
      console.log(`${chalk.gray('–')} ${chalk.blue(repo.name)} ${chalk.gray('(Nothing to do)')}`);
    } else {
      fail++;
      console.log(`${chalk.red('✖')} ${chalk.blue(repo.name)} ${chalk.red('(Failed)')}`);
      if (result.all) console.log(chalk.red(result.all.replace(/^/gm, '    ')));
    }
  }
  for (const repo of skipped) {
    console.log(`${chalk.gray('–')} ${chalk.blue(repo.name)} ${chalk.gray('(Nothing to do)')}`);
  }

  const parts = [chalk.green(`${ok} committed`)];
  if (skipped.length) parts.push(chalk.gray(`${skipped.length} skipped`));
  if (fail) parts.push(chalk.red(`${fail} failed`));
  console.log('\n' + parts.join(chalk.gray(' · ')));
  console.log(chalk.gray(`🔗 Linked as ${changeId} — run \`monogit show ${changeId}\` to view.\n`));
}
