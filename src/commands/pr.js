import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import { resolveRepos } from '../utils/config.js';
import { runGitCommand, getCurrentBranch, getDefaultBranch } from '../utils/git.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';

async function hasGh() {
  try {
    await execa('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

// True when `branch` has commits that `base` doesn't (i.e. there's something to PR).
async function hasCommitsAhead(repoPath, base, branch) {
  const r = await runGitCommand(repoPath, ['rev-list', '--count', `${base}..${branch}`]);
  if (r.exitCode !== 0) return true; // can't tell — let gh decide
  return (parseInt(r.stdout.trim(), 10) || 0) > 0;
}

async function openPrForRepo(repo, options) {
  const branch = await getCurrentBranch(repo.path);
  if (!branch) return { repo: repo.name, status: 'skip', reason: 'detached HEAD' };

  const base = options.base || (await getDefaultBranch(repo.path)) || 'main';
  if (branch === base) return { repo: repo.name, status: 'skip', reason: `on base branch (${base})` };

  if (!(await hasCommitsAhead(repo.path, base, branch))) {
    return { repo: repo.name, status: 'skip', reason: `no commits ahead of ${base}` };
  }

  // Push the branch so gh has something to open a PR against.
  if (options.push !== false) {
    const push = await runGitCommand(repo.path, ['push', '-u', 'origin', branch]);
    if (push.exitCode !== 0) {
      return { repo: repo.name, status: 'fail', reason: (push.all || 'push failed').trim() };
    }
  }

  const args = ['pr', 'create', '--base', base, '--head', branch];
  if (options.draft) args.push('--draft');
  if (options.web) args.push('--web');
  if (options.fill) args.push('--fill');
  if (options.title) args.push('--title', options.title);
  if (options.body !== undefined) args.push('--body', options.body || '');
  if (!options.fill && !options.title && !options.web) args.push('--fill'); // sensible default

  const result = await execa('gh', args, { cwd: repo.path, reject: false, all: true });
  if (result.exitCode === 0) {
    const url = (result.stdout || '').trim().split('\n').pop();
    return { repo: repo.name, status: 'ok', url };
  }
  const text = (result.all || '').trim();
  if (/already exists/i.test(text)) {
    return { repo: repo.name, status: 'skip', reason: 'PR already exists' };
  }
  return { repo: repo.name, status: 'fail', reason: text };
}

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
