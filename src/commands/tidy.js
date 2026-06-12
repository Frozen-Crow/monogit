import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { resolveRepos, getProtectedPatterns, parseList } from '../utils/config.js';
import { makeMatcher } from '../utils/match.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';
import {
  getCurrentBranch,
  getDefaultBranch,
  fetchPrune,
  listLocalBranches,
  listMergedBranches,
  deleteBranch,
} from '../utils/git.js';

const CATEGORY = {
  gone: { label: 'gone', color: chalk.yellow },
  merged: { label: 'merged', color: chalk.green },
  stale: { label: 'stale', color: chalk.gray },
};

async function scanRepo(repo, want, staleDays, protectedPatterns) {
  const cwd = repo.path;
  const current = await getCurrentBranch(cwd);
  const base = await getDefaultBranch(cwd);

  const isProtected = makeMatcher([
    ...protectedPatterns,
    ...(base ? [base] : []),
    ...(current ? [current] : []),
  ]);

  const branches = await listLocalBranches(cwd);
  const merged = want.merged && base ? await listMergedBranches(cwd, base) : new Set();
  const nowSec = Date.now() / 1000;

  const candidates = [];
  for (const b of branches) {
    if (isProtected(b.name)) continue;

    let category = null;
    if (want.gone && b.gone) category = 'gone';
    else if (want.merged && b.name !== base && merged.has(b.name)) category = 'merged';
    else if (want.stale && b.unix && nowSec - b.unix > staleDays * 86400) category = 'stale';

    if (category) candidates.push({ repo: repo.name, cwd, name: b.name, rel: b.rel, category });
  }

  return { repo: repo.name, base, current, candidates };
}

function renderReport(scans) {
  for (const scan of scans) {
    const baseInfo = scan.base
      ? chalk.gray(` (default: ${scan.base})`)
      : chalk.gray(' (no default branch)');
    console.log(chalk.bold.blue(scan.repo) + baseInfo);

    if (scan.candidates.length === 0) {
      console.log(chalk.gray('    (nothing to tidy)\n'));
      continue;
    }

    const pad = Math.max(...scan.candidates.map((c) => c.name.length));
    for (const c of scan.candidates) {
      const { label, color } = CATEGORY[c.category];
      console.log(
        '    ' + color(c.name.padEnd(pad)) + '  ' + color(label.padEnd(7)) + chalk.gray(`  ${c.rel}`)
      );
    }
    console.log('');
  }
}

export async function tidyCommand(options) {
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  // If any category flag is passed, target exactly those; otherwise default to gone + merged.
  const flagsGiven = options.gone || options.merged || options.stale !== undefined;
  const want = {
    gone: flagsGiven ? Boolean(options.gone) : true,
    merged: flagsGiven ? Boolean(options.merged) : true,
    stale: flagsGiven ? options.stale !== undefined : false,
  };

  let staleDays = 30;
  if (typeof options.stale === 'string') {
    const n = parseInt(options.stale, 10);
    if (!Number.isNaN(n) && n > 0) staleDays = n;
  }

  const protectedPatterns = [...(await getProtectedPatterns()), ...parseList(options.protect)];

  const wanted = Object.entries(want)
    .filter(([, v]) => v)
    .map(([k]) => (k === 'stale' ? `stale>${staleDays}d` : k))
    .join(', ');
  console.log(
    chalk.cyan.bold(`\n🧹 Tidying ${repos.length} repositories `) + chalk.gray(`(targeting: ${wanted})\n`)
  );

  if (options.fetch !== false) {
    const spinner = ora(`Fetching & pruning ${repos.length} repos...`).start();
    await mapLimit(repos, concurrencyFrom(options), (repo) => fetchPrune(repo.path));
    spinner.succeed('Fetched & pruned remotes.');
    console.log('');
  }

  const scanSpinner = ora('Scanning branches...').start();
  const settled = await mapLimit(repos, concurrencyFrom(options), (repo) =>
    scanRepo(repo, want, staleDays, protectedPatterns)
  );
  scanSpinner.stop();
  const scans = settled.map((e) => (e.status === 'fulfilled' ? e.value : { repo: '?', candidates: [] }));

  const allCandidates = scans.flatMap((s) => s.candidates);

  if (options.json) {
    console.log(JSON.stringify(allCandidates.map(({ cwd, ...c }) => c), null, 2));
    return;
  }

  renderReport(scans);

  if (allCandidates.length === 0) {
    console.log(chalk.green('✨ All tidy — no orphaned branches found.\n'));
    return;
  }

  const summary = `${allCandidates.length} branch${allCandidates.length === 1 ? '' : 'es'} across ${
    scans.filter((s) => s.candidates.length > 0).length
  } repo(s)`;

  if (options.dryRun) {
    console.log(
      chalk.gray(`Dry run — ${summary} would be deleted. Re-run without --dry-run to clean up.\n`)
    );
    return;
  }

  let selected;
  if (options.yes) {
    selected = allCandidates;
    console.log(chalk.yellow(`--yes: deleting all ${summary}.\n`));
  } else {
    const choices = [];
    for (const scan of scans) {
      if (scan.candidates.length === 0) continue;
      choices.push(new inquirer.Separator(chalk.bold(`── ${scan.repo} ──`)));
      for (const c of scan.candidates) {
        const { label, color } = CATEGORY[c.category];
        choices.push({
          name: `${color(c.name)}  ${chalk.gray(`${label} · ${c.rel}`)}`,
          value: c,
          checked: c.category !== 'stale',
        });
      }
    }

    const { picks } = await inquirer.prompt([
      { type: 'checkbox', name: 'picks', message: 'Select branches to delete:', choices, pageSize: 20 },
    ]);

    if (!picks || picks.length === 0) {
      console.log(chalk.gray('\nNothing selected. No branches deleted.\n'));
      return;
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Delete ${picks.length} branch${picks.length === 1 ? '' : 'es'}?`,
        default: false,
      },
    ]);
    if (!confirm) {
      console.log(chalk.gray('\nAborted. No branches deleted.\n'));
      return;
    }
    selected = picks;
  }

  console.log('');
  let deleted = 0;
  let failed = 0;
  for (const c of selected) {
    const force = c.category === 'gone';
    const r = await deleteBranch(c.cwd, c.name, force);
    if (r.exitCode === 0) {
      deleted++;
      console.log(`${chalk.green('✔')} ${chalk.blue(c.repo)} ${chalk.gray('—')} deleted ${chalk.bold(c.name)}`);
    } else {
      failed++;
      console.log(
        `${chalk.red('✖')} ${chalk.blue(c.repo)} ${chalk.gray('—')} could not delete ${chalk.bold(c.name)}`
      );
      const detail = (r.all || '').trim();
      if (detail) console.log(chalk.red(`    ${detail.replace(/\n/g, '\n    ')}`));
      if (!force) console.log(chalk.gray('    (not fully merged — use `git branch -D` to force)'));
    }
  }

  console.log(
    '\n' + chalk.green(`✨ Deleted ${deleted}`) + (failed ? chalk.red(`, ${failed} failed`) : '') + chalk.gray('.\n')
  );
}
