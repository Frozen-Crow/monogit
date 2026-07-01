import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execa } from 'execa';
import { resolveRepos, getWorkspaceRoot, parseList } from '../utils/config.js';
import { loadPackageGraph, readPackageJson, detectPackageManager } from '../core/packages.js';
import { getRemoteUrl, getCurrentBranch } from '../utils/git.js';
import { recordDep } from '../core/ci.js';
import { noReposNotice, betaNotice } from '../utils/ui.js';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const STATE = ['.monogit', 'links.json'];

async function readState(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, ...STATE), 'utf8'));
  } catch {
    return { links: [] };
  }
}

async function writeState(root, links) {
  await fs.mkdir(path.join(root, STATE[0]), { recursive: true });
  await fs.writeFile(path.join(root, ...STATE), JSON.stringify({ links }, null, 2) + '\n', 'utf8');
}

async function writePackageJson(dir, pkg) {
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function declaresDep(pkg, name) {
  return DEP_FIELDS.some((f) => pkg?.[f]?.[name] !== undefined);
}

// Consumer-side link command per package manager (npm/pnpm/yarn accept a path).
function linkArgv(pm, providerDir) {
  if (pm === 'pnpm') return ['pnpm', 'link', providerDir];
  if (pm === 'yarn') return ['yarn', 'link', providerDir];
  return ['npm', 'link', providerDir];
}

function unlinkArgv(pm, pkg) {
  if (pm === 'pnpm') return ['pnpm', 'unlink', pkg];
  if (pm === 'yarn') return ['yarn', 'unlink', pkg];
  return ['npm', 'unlink', pkg];
}

async function run(cwd, argv) {
  const r = await execa(argv[0], argv.slice(1), { cwd, reject: false, all: true });
  return { ok: r.exitCode === 0, output: (r.all || '').trim() };
}

function printGraph(graph, state) {
  const linked = new Set(state.links.map((l) => `${l.consumer}->${l.package}`));
  if (graph.providers.size === 0) {
    console.log(chalk.yellow('\nNo packages found in the workspace (no package.json with a name).\n'));
    return;
  }
  console.log(chalk.cyan.bold(`\n📦 ${graph.providers.size} package(s) in the workspace\n`));
  for (const [name, p] of graph.providers) {
    const consumers = graph.edges.filter((e) => e.package === name);
    console.log(`  ${chalk.green(name)}${p.version ? chalk.gray(`@${p.version}`) : ''} ${chalk.gray(`(${p.repo})`)}`);
    if (consumers.length === 0) console.log(chalk.gray('     used by: (none in workspace)'));
    for (const e of consumers) {
      const badge = linked.has(`${e.consumer}->${e.package}`) ? chalk.green('● linked') : chalk.gray('○ not linked');
      console.log(`     → ${chalk.blue(e.consumer)} ${chalk.gray(`(${e.consumerPm}, ${e.depType})`)}  ${badge}`);
    }
  }
  console.log('');
}

// Find the package to link, from a path OR a package name in the workspace.
async function resolveTarget(packageArg, repos) {
  const abs = path.resolve(process.cwd(), packageArg);
  const atPath = await readPackageJson(abs);
  if (atPath?.name) {
    const repo = repos.find((r) => path.resolve(r.path) === abs);
    return { name: atPath.name, version: atPath.version, dir: abs, repo: repo?.name, private: Boolean(atPath.private) };
  }
  for (const r of repos) {
    const pkg = await readPackageJson(r.path);
    if (pkg?.name === packageArg) {
      return { name: pkg.name, version: pkg.version, dir: r.path, repo: r.name, private: Boolean(pkg.private) };
    }
  }
  return null;
}

// The workspace-relative path from a consumer to the target package.
function relPathTo(consumerDir, targetDir) {
  return path.relative(consumerDir, targetDir).split(path.sep).join('/');
}

// Guided flow: `monogit link <package>` — choose repos, declare the dep, link it.
async function linkPackageInto(packageArg, repos, root, options) {
  const target = await resolveTarget(packageArg, repos);
  if (!target) {
    console.log(chalk.red(`\n❌ Couldn't find a package at or named "${packageArg}".`));
    console.log(chalk.gray('   Pass a path to a package folder, or a package name from the workspace.\n'));
    return;
  }

  // Candidate consumers: every workspace repo with a package.json, except the package itself.
  const candidates = [];
  for (const r of repos) {
    if (path.resolve(r.path) === target.dir) continue;
    const pkg = await readPackageJson(r.path);
    if (!pkg) continue;
    candidates.push({ name: r.name, dir: r.path, pkg, pm: await detectPackageManager(r.path), declared: declaresDep(pkg, target.name) });
  }
  if (candidates.length === 0) {
    console.log(chalk.yellow(`\nNo repos in the workspace can consume ${target.name} (no package.json found).\n`));
    return;
  }

  // Pick the consumers: --into a,b (scriptable) or an interactive checkbox.
  let chosenNames;
  if (options.into) {
    const want = parseList(options.into);
    chosenNames = candidates.filter((c) => want.includes(c.name)).map((c) => c.name);
  } else if (process.stdin.isTTY) {
    const { chosen } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'chosen',
        message: `Link ${chalk.green(target.name)} into which repos?`,
        choices: candidates.map((c) => ({
          name: `${c.name}${c.declared ? chalk.gray('  (already declares it)') : ''}`,
          value: c.name,
          checked: c.declared,
        })),
      },
    ]);
    chosenNames = chosen;
  } else {
    chosenNames = candidates.filter((c) => c.declared).map((c) => c.name); // non-interactive default
  }

  if (!chosenNames || chosenNames.length === 0) {
    console.log(chalk.gray('\nNothing selected.\n'));
    return;
  }

  const depType = options.dev ? 'devDependencies' : 'dependencies';
  const state = await readState(root);
  const links = state.links.filter((l) => l.package !== target.name);
  console.log('');
  let ok = 0;
  let fail = 0;

  for (const name of chosenNames) {
    const c = candidates.find((x) => x.name === name);
    const spinner = ora(`${c.name} → ${target.name} (${c.pm})`).start();

    // 1) declare the dependency if it isn't already — a version range for
    //    published packages, or a portable file:/link: path for unpublished ones.
    const usePath = Boolean(options.file || target.private);
    const rel = relPathTo(c.dir, target.dir);
    if (!declaresDep(c.pkg, target.name)) {
      const spec = usePath
        ? c.pm === 'pnpm'
          ? `link:${rel}`
          : `file:${rel}`
        : target.version
          ? `^${target.version}`
          : '*';
      c.pkg[depType] = c.pkg[depType] || {};
      c.pkg[depType][target.name] = spec;
      await writePackageJson(c.dir, c.pkg);
    }

    // Record the git source so `monogit ci` can resolve/hydrate this in CI & deploys.
    if (usePath) {
      const remote = await getRemoteUrl(target.dir);
      const ref = await getCurrentBranch(target.dir);
      await recordDep(c.dir, target.name, { path: rel, ...(remote ? { remote } : {}), ...(ref ? { ref } : {}) });
    }
    const style = usePath ? 'path' : 'version';

    // 2) link node_modules to the local checkout for development
    const res = await run(c.dir, linkArgv(c.pm, target.dir));
    if (res.ok) {
      ok++;
      links.push({ consumer: c.name, package: target.name, pm: c.pm });
      spinner.succeed(`${chalk.blue(c.name)} → ${chalk.green(target.name)} ${chalk.gray(`declared (${style}) + linked`)}`);
    } else {
      fail++;
      spinner.fail(`${chalk.blue(c.name)} → ${chalk.green(target.name)} ${chalk.gray('(declared; link step failed)')}`);
      if (res.output) console.log(chalk.red(res.output.replace(/^/gm, '    ')));
    }
  }

  await writeState(root, links);
  console.log('\n' + chalk.green(`✔ Linked ${ok}`) + (fail ? chalk.red(`, ${fail} failed`) : '') + chalk.gray('.\n'));
}

// Auto mode: `monogit link` — link every already-declared cross-repo dependency.
async function linkAllDeclared(repos, root) {
  const graph = await loadPackageGraph(repos);
  const state = await readState(root);
  if (graph.edges.length === 0) {
    console.log(chalk.yellow('\nNo already-declared cross-repo dependencies to link.'));
    console.log(chalk.gray('Tip: `monogit link <package>` introduces a shared package into repos that don’t use it yet.'));
    printGraph(graph, state);
    return;
  }
  console.log(chalk.cyan.bold(`\n🔗 Linking ${graph.edges.length} declared cross-repo dependenc(ies)...\n`));
  const links = [];
  let ok = 0;
  let fail = 0;
  for (const e of graph.edges) {
    const spinner = ora(`${e.consumer} → ${e.package} (${e.consumerPm})`).start();
    const res = await run(e.consumerDir, linkArgv(e.consumerPm, e.providerDir));
    if (res.ok) {
      ok++;
      links.push({ consumer: e.consumer, package: e.package, pm: e.consumerPm });
      spinner.succeed(`${chalk.blue(e.consumer)} → ${chalk.green(e.package)} ${chalk.gray('linked')}`);
    } else {
      fail++;
      spinner.fail(`${chalk.blue(e.consumer)} → ${chalk.green(e.package)}`);
      if (res.output) console.log(chalk.red(res.output.replace(/^/gm, '    ')));
    }
  }
  await writeState(root, links);
  console.log('\n' + chalk.green(`✔ Linked ${ok}`) + (fail ? chalk.red(`, ${fail} failed`) : '') + chalk.gray('.\n'));
}

export async function linkCommand(packageArg, options = {}) {
  betaNotice('monogit link');
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }
  const root = await getWorkspaceRoot();

  if (options.status) {
    printGraph(await loadPackageGraph(repos), await readState(root));
    return;
  }
  if (packageArg) {
    await linkPackageInto(packageArg, repos, root, options);
    return;
  }
  await linkAllDeclared(repos, root);
}

export async function unlinkCommand(options = {}) {
  betaNotice('monogit unlink');
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }
  const root = await getWorkspaceRoot();
  const state = await readState(root);
  const graph = await loadPackageGraph(repos);

  const targets = state.links.length
    ? state.links.map((l) => {
        const e = graph.edges.find((x) => x.consumer === l.consumer && x.package === l.package);
        return { ...l, consumerDir: e?.consumerDir || graph.entries.find((n) => n.name === l.consumer)?.dir };
      })
    : graph.edges.map((e) => ({ consumer: e.consumer, package: e.package, pm: e.consumerPm, consumerDir: e.consumerDir }));

  if (targets.length === 0) {
    console.log(chalk.gray('\nNothing linked.\n'));
    return;
  }

  console.log(chalk.cyan.bold(`\n🔗 Unlinking ${targets.length} dependenc(ies) and restoring...\n`));
  for (const t of targets) {
    if (!t.consumerDir) continue;
    const spinner = ora(`${t.consumer} → ${t.package}`).start();
    await run(t.consumerDir, unlinkArgv(t.pm, t.package));
    await run(t.consumerDir, [t.pm, 'install']);
    spinner.succeed(`${chalk.blue(t.consumer)} → ${chalk.green(t.package)} ${chalk.gray('restored')}`);
  }

  await writeState(root, []);
  console.log(chalk.green('\n✔ Unlinked.\n'));
}
