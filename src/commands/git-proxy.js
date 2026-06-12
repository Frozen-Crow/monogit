import chalk from 'chalk';
import ora from 'ora';
import { runGitCommand } from '../utils/git.js';
import { resolveRepos } from '../utils/config.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';

// Output that git emits when there was simply nothing to do — not a real failure.
const NOOP_PATTERNS = [
  /nothing to commit/i,
  /nothing added to commit/i,
  /no changes added to commit/i,
  /your branch is up to date/i,
  /already up to date/i,
  /already on '/i,
  /everything up-to-date/i,
];

export function classifyResult(result) {
  const text = String(result.all || '');
  const isNoop = NOOP_PATTERNS.some((re) => re.test(text));
  if (result.exitCode === 0) return isNoop ? 'noop' : 'ok';
  return isNoop ? 'noop' : 'fail';
}

export async function gitProxyCommand(cmdName, args, options = {}) {
  const repos = await resolveRepos(options);

  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  const printable = `git ${cmdName}${args.length ? ' ' + args.join(' ') : ''}`;
  console.log(chalk.cyan(`\n📦 Running '${printable}' in ${repos.length} repositories...\n`));

  const spinner = ora(`Running across ${repos.length} repos...`).start();
  const results = await mapLimit(repos, concurrencyFrom(options), async (repo) => {
    const result = await runGitCommand(repo.path, [cmdName, ...args]);
    return { repo, result };
  });
  spinner.stop();

  if (options.json) {
    const payload = results.map((entry) =>
      entry.status === 'fulfilled'
        ? {
            repo: entry.value.repo.name,
            status: classifyResult(entry.value.result),
            exitCode: entry.value.result.exitCode,
            output: (entry.value.result.all || '').trim(),
          }
        : { repo: null, status: 'error', error: String(entry.reason) }
    );
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  let ok = 0;
  let noop = 0;
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
      console.log(`${chalk.green('✔')} ${chalk.blue(repo.name)} ${chalk.gray('(Success)')}`);
    } else if (cls === 'noop') {
      noop++;
      console.log(`${chalk.gray('–')} ${chalk.blue(repo.name)} ${chalk.gray('(Nothing to do)')}`);
    } else {
      fail++;
      console.log(`${chalk.red('✖')} ${chalk.blue(repo.name)} ${chalk.red('(Failed)')}`);
      if (result.all) console.log(chalk.red(result.all.replace(/^/gm, '    ')));
    }
  }

  const parts = [chalk.green(`${ok} ok`)];
  if (noop) parts.push(chalk.gray(`${noop} skipped`));
  if (fail) parts.push(chalk.red(`${fail} failed`));
  console.log('\n' + parts.join(chalk.gray(' · ')) + '\n');
}
