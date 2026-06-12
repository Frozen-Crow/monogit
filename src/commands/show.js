import chalk from 'chalk';
import ora from 'ora';
import { resolveRepos } from '../utils/config.js';
import { runGitCommand } from '../utils/git.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';
import { CHANGE_ID_TRAILER } from '../utils/link.js';

const US = '\x1f'; // unit separator between fields

// Pull every commit that carries a Monogit-Change-Id, with its id.
// The trailer placeholder is last because git appends a newline after it.
async function commitsWithChangeId(repoPath) {
  const fmt = ['%h', '%s', '%cr', `%(trailers:key=${CHANGE_ID_TRAILER},valueonly)`].join(US);
  const r = await runGitCommand(repoPath, ['log', '--all', '--no-color', `--pretty=format:${fmt}`]);
  if (r.exitCode !== 0 || !r.stdout) return [];
  return r.stdout
    .split('\n')
    .map((line) => line.split(US))
    .filter((f) => f.length >= 4 && f[3] && f[3].trim())
    .map(([sha, subject, when, changeId]) => ({ sha, changeId: changeId.trim(), subject, when }));
}

export async function showCommand(changeId, options = {}) {
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  const spinner = ora('Searching for change...').start();
  const settled = await mapLimit(repos, concurrencyFrom(options), async (repo) => ({
    repo,
    commits: await commitsWithChangeId(repo.path),
  }));
  spinner.stop();

  const rows = [];
  for (const entry of settled) {
    if (entry.status !== 'fulfilled') continue;
    for (const c of entry.value.commits) rows.push({ repo: entry.value.repo.name, ...c });
  }

  // No id given → show the most recent change (ULIDs sort lexicographically by time).
  let target = changeId;
  if (!target) {
    if (rows.length === 0) {
      console.log(chalk.yellow('\nNo linked changes found. Commit with linking enabled first.\n'));
      return;
    }
    target = rows.reduce((max, r) => (r.changeId > max ? r.changeId : max), rows[0].changeId);
  }

  const matches = rows.filter((r) => r.changeId === target || r.changeId.startsWith(target));

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
    chalk.cyan.bold(`\n🔗 Change ${matches[0].changeId} `) +
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
