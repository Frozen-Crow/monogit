import chalk from 'chalk';
import boxen from 'boxen';
import { execa } from 'execa';
import { runGitCommand } from '../utils/git.js';
import { resolveRepos } from '../utils/config.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';

function renderBox(repo, result) {
  const output = (result.all || '').trim() || chalk.gray('(no output)');
  console.log(
    boxen(output, {
      title: chalk.bold.blue(` ${repo.name} `) + (result.exitCode === 0 ? '' : chalk.red(` exit ${result.exitCode} `)),
      titleAlignment: 'left',
      padding: 1,
      margin: { top: 1, bottom: 0, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: result.exitCode === 0 ? 'cyan' : 'red',
    })
  );
}

async function fanOut(repos, options, runner) {
  return mapLimit(repos, concurrencyFrom(options), async (repo) => {
    const result = await runner(repo);
    return { repo, result };
  });
}

function summarize(results) {
  let ok = 0;
  let fail = 0;
  for (const entry of results) {
    if (entry.status === 'fulfilled' && entry.value.result.exitCode === 0) ok++;
    else fail++;
  }
  const parts = [chalk.green(`${ok} ok`)];
  if (fail) parts.push(chalk.red(`${fail} failed`));
  console.log('\n' + parts.join(chalk.gray(' · ')) + '\n');
}

// `monogit exec -- <git args>` — run an arbitrary git command across all repos.
export async function execCommand(gitArgs, options = {}) {
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  // Be forgiving if the user wrote `exec git status`.
  const args = gitArgs[0] === 'git' ? gitArgs.slice(1) : gitArgs;
  if (args.length === 0) {
    console.log(chalk.yellow('\nNothing to run. Usage: monogit exec -- <git args>\n'));
    return;
  }

  console.log(chalk.cyan(`\n📦 Running 'git ${args.join(' ')}' in ${repos.length} repositories...`));
  const results = await fanOut(repos, options, (repo) => runGitCommand(repo.path, args));

  if (options.json) {
    console.log(
      JSON.stringify(
        results.map((e) =>
          e.status === 'fulfilled'
            ? { repo: e.value.repo.name, exitCode: e.value.result.exitCode, output: (e.value.result.all || '').trim() }
            : { repo: null, error: String(e.reason) }
        ),
        null,
        2
      )
    );
    return;
  }

  for (const entry of results) {
    if (entry.status === 'fulfilled') renderBox(entry.value.repo, entry.value.result);
    else console.log(chalk.red(`\n✖ Error: ${entry.reason}\n`));
  }
  summarize(results);
}

// `monogit run "<shell command>"` — run an arbitrary shell command across all repos.
export async function runShellCommand(command, options = {}) {
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  console.log(chalk.cyan(`\n📦 Running '${command}' in ${repos.length} repositories...`));
  const results = await fanOut(repos, options, async (repo) => {
    const r = await execa(command, { cwd: repo.path, shell: true, reject: false, all: true });
    return { all: r.all, exitCode: r.exitCode };
  });

  for (const entry of results) {
    if (entry.status === 'fulfilled') renderBox(entry.value.repo, entry.value.result);
    else console.log(chalk.red(`\n✖ Error: ${entry.reason}\n`));
  }
  summarize(results);
}
