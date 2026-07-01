import chalk from 'chalk';
import inquirer from 'inquirer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execa } from 'execa';
import { resolveRepos } from '../utils/config.js';
import { runGitCommand } from '../utils/git.js';
import { loadPackageGraph } from '../core/packages.js';
import { planRelease } from '../core/release.js';
import { performCommit } from '../core/commit.js';
import { noReposNotice, betaNotice } from '../utils/ui.js';

async function patchPackageJson(dir, mutate) {
  const file = path.join(dir, 'package.json');
  const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
  mutate(pkg);
  await fs.writeFile(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function printPlan(plan) {
  console.log(chalk.cyan.bold('\n📦 Release plan\n'));
  for (const b of plan.bumps) {
    console.log(
      `  ${chalk.green(b.package)}  ${chalk.gray(b.oldVersion || '—')} → ${chalk.bold(b.newVersion)} ${chalk.gray(`(${b.repo})`)}`
    );
  }
  if (plan.consumerUpdates.length) {
    console.log(chalk.gray('\n  consumers updated:'));
    for (const u of plan.consumerUpdates) {
      console.log(
        `    ${chalk.blue(u.repo)} ${chalk.gray(u.field)} ${u.package}: ${chalk.gray(u.oldSpec)} → ${u.newSpec}`
      );
    }
  }
  console.log('');
}

export async function releaseCommand(options = {}) {
  betaNotice('monogit release');
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  const level = options.version || options.bump || 'patch';
  const graph = await loadPackageGraph(repos);

  if (graph.providers.size === 0) {
    console.log(chalk.yellow('\nNo publishable packages found (no package.json with a name) in the workspace.\n'));
    return;
  }

  const plan = planRelease(graph, level);
  if (plan.bumps.length === 0) {
    console.log(chalk.yellow('\nNothing to release — no packages with a plain semver version to bump.\n'));
    return;
  }

  printPlan(plan);

  if (options.dryRun) {
    console.log(chalk.gray('Dry run — no files changed. Re-run without --dry-run to apply.\n'));
    return;
  }

  if (!options.yes) {
    const { ok } = await inquirer.prompt([
      { type: 'confirm', name: 'ok', message: `Apply this release (${plan.bumps.length} package(s))?`, default: false },
    ]);
    if (!ok) {
      console.log(chalk.gray('Aborted.\n'));
      return;
    }
  }

  // 1) write version bumps + consumer spec updates
  for (const b of plan.bumps) {
    await patchPackageJson(b.dir, (pkg) => {
      pkg.version = b.newVersion;
    });
  }
  for (const u of plan.consumerUpdates) {
    await patchPackageJson(u.dir, (pkg) => {
      if (pkg[u.field] && pkg[u.field][u.package] !== undefined) pkg[u.field][u.package] = u.newSpec;
    });
  }

  // 2) commit as one linked change (only package.json in each affected repo)
  const affected = new Set([...plan.bumps.map((b) => b.repo), ...plan.consumerUpdates.map((u) => u.repo)]);
  const affectedRepos = repos.filter((r) => affected.has(r.name));
  const message = `release: ${plan.bumps.map((b) => `${b.package}@${b.newVersion}`).join(', ')}`;
  const { changeId } = await performCommit({
    repos: affectedRepos,
    message,
    paths: ['package.json'],
    link: true,
  });
  console.log(chalk.green(`\n✔ Committed release across ${affectedRepos.length} repo(s)`) + (changeId ? chalk.gray(` (${changeId})`) : ''));

  // 3) tag each bumped package (opt-in)
  if (options.tag) {
    for (const b of plan.bumps) {
      await runGitCommand(b.dir, ['tag', `${b.package}@${b.newVersion}`]);
    }
    console.log(chalk.gray(`Tagged ${plan.bumps.length} package(s).`));
  }

  // 4) publish (opt-in, extra confirm — irreversible + public)
  if (options.publish) {
    if (!options.yes) {
      const { pub } = await inquirer.prompt([
        { type: 'confirm', name: 'pub', message: `Publish ${plan.bumps.length} package(s) to their registries now?`, default: false },
      ]);
      if (!pub) {
        console.log(chalk.gray('Skipped publish.\n'));
        return;
      }
    }
    for (const b of plan.bumps) {
      const spinner = (await import('ora')).default(`Publishing ${b.package}@${b.newVersion}...`).start();
      const r = await execa(b.pm || 'npm', ['publish'], { cwd: b.dir, reject: false, all: true });
      if (r.exitCode === 0) spinner.succeed(`Published ${chalk.green(b.package)}@${b.newVersion}`);
      else {
        spinner.fail(`Failed to publish ${b.package}`);
        if (r.all) console.log(chalk.red(r.all.trim().replace(/^/gm, '    ')));
      }
    }
  }

  console.log('');
}
