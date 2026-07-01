import chalk from 'chalk';
import ora from 'ora';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runGitCommand, isGitRepo } from '../utils/git.js';
import { readPackageJson } from '../core/packages.js';
import { readDepsManifest, collectPathDeps, toGitDependency } from '../core/ci.js';
import { betaNotice } from '../utils/ui.js';

async function writePackageJson(dir, pkg) {
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

// Clone the sibling packages this repo links to, so `file:`/`link:` specs resolve.
async function hydrate(dir, pathDeps, manifest, options) {
  console.log(chalk.cyan.bold(`\n🚚 Hydrating ${pathDeps.length} local package(s)...\n`));
  let ok = 0;
  let fail = 0;
  for (const pd of pathDeps) {
    const src = manifest.packages?.[pd.name] || {};
    const ref = options.ref || src.ref;
    const target = path.resolve(dir, pd.relPath);

    if (await isGitRepo(target)) {
      console.log(`${chalk.gray('–')} ${chalk.green(pd.name)} already present at ${chalk.gray(pd.relPath)}`);
      ok++;
      continue;
    }
    if (!src.remote) {
      console.log(`${chalk.red('✖')} ${chalk.green(pd.name)}: no recorded remote — re-run \`monogit link\` to record it`);
      fail++;
      continue;
    }
    const spinner = ora(`cloning ${pd.name} → ${pd.relPath}`).start();
    const clone = await runGitCommand(dir, ['clone', src.remote, target]);
    if (clone.exitCode !== 0) {
      spinner.fail(`${pd.name}`);
      if (clone.all) console.log(chalk.red(clone.all.trim().replace(/^/gm, '    ')));
      fail++;
      continue;
    }
    if (ref) await runGitCommand(target, ['checkout', ref]);
    spinner.succeed(`${chalk.green(pd.name)} → ${chalk.gray(pd.relPath)}${ref ? chalk.gray(` @ ${ref}`) : ''}`);
    ok++;
  }
  console.log('\n' + chalk.green(`✔ Hydrated ${ok}`) + (fail ? chalk.red(`, ${fail} failed`) : ''));
  console.log(chalk.gray('Now run your install (e.g. `npm ci` / `pnpm i`).\n'));
}

// Rewrite file:/link: path deps to git dependencies so the repo installs on its
// own — no siblings, no workspace. Ideal for deploy builds (Docker, serverless).
async function resolve(dir, pkg, pathDeps, manifest, options) {
  const changes = [];
  for (const pd of pathDeps) {
    const src = manifest.packages?.[pd.name] || {};
    if (!src.remote) {
      console.log(`${chalk.red('✖')} ${chalk.green(pd.name)}: no recorded git source — can't make it self-contained.`);
      continue;
    }
    changes.push({ ...pd, gitSpec: toGitDependency(src.remote, options.ref || src.ref) });
  }
  if (changes.length === 0) {
    console.log(chalk.yellow('\nNothing to resolve (no path deps with a recorded git source).\n'));
    return;
  }

  console.log(chalk.cyan.bold(`\n🔧 Rewriting ${changes.length} path dep(s) to git dependencies\n`));
  for (const c of changes) console.log(`  ${chalk.green(c.name)}: ${chalk.gray(c.spec)} → ${c.gitSpec}`);

  if (options.dryRun) {
    console.log(chalk.gray('\nDry run — package.json unchanged.\n'));
    return;
  }
  for (const c of changes) pkg[c.field][c.name] = c.gitSpec;
  await writePackageJson(dir, pkg);
  console.log(chalk.green('\n✔ package.json is now self-contained. Run your install (e.g. `npm ci`).\n'));
}

export async function ciCommand(mode, options = {}) {
  betaNotice('monogit ci');
  const dir = process.cwd();

  const pkg = await readPackageJson(dir);
  if (!pkg) {
    console.log(chalk.red('\n❌ No package.json in the current directory.\n'));
    return;
  }
  const pathDeps = collectPathDeps(pkg);
  if (pathDeps.length === 0) {
    console.log(chalk.gray('\nNo file:/link: dependencies to correct — nothing to do.\n'));
    return;
  }
  const manifest = await readDepsManifest(dir);

  if (mode === 'hydrate') return hydrate(dir, pathDeps, manifest, options);
  if (mode === 'resolve') return resolve(dir, pkg, pathDeps, manifest, options);
  console.log(chalk.red(`\n❌ Unknown mode "${mode}". Use: hydrate | resolve\n`));
}
