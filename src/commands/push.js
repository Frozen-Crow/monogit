import chalk from 'chalk';
import { execa } from 'execa';
import { resolveRepos } from '../utils/config.js';
import { runGitCommand, resolvePushArgs } from '../utils/git.js';
import { runDependencyGraph } from '../core/schedule.js';
import { hasGh } from '../core/pr.js';
import { gitProxyCommand, classifyResult } from './git-proxy.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve each repo's dependsOn (names or basenames) to actual in-set repo names.
function resolveDeps(repos) {
  const nameFor = (token) => {
    const m = repos.find((r) => r.name === token || r.name.split('/').pop() === token);
    return m ? m.name : null;
  };
  const map = new Map();
  for (const r of repos) map.set(r.name, (r.dependsOn || []).map(nameFor).filter(Boolean));
  return map;
}

// Poll a repo's GitHub Actions runs for the pushed commit until they complete.
async function waitForCi(repoDir, sha, { timeoutMs = 15 * 60 * 1000, pollMs = 8000, graceMs = 45000 } = {}) {
  const start = Date.now();
  let sawRun = false;
  while (Date.now() - start < timeoutMs) {
    const r = await execa(
      'gh',
      ['run', 'list', '--limit', '30', '--json', 'headSha,status,conclusion,workflowName'],
      { cwd: repoDir, reject: false }
    );
    if (r.exitCode !== 0) return { ok: false, reason: `gh run list failed: ${(r.stderr || '').trim()}` };
    let runs = [];
    try {
      runs = JSON.parse(r.stdout);
    } catch {
      /* ignore */
    }
    const forSha = runs.filter((x) => x.headSha === sha);
    if (forSha.length === 0) {
      if (!sawRun && Date.now() - start > graceMs) return { ok: true, note: 'no CI runs found' };
      await sleep(pollMs);
      continue;
    }
    sawRun = true;
    if (forSha.every((x) => x.status === 'completed')) {
      const failed = forSha.filter((x) => x.conclusion && !['success', 'skipped', 'neutral'].includes(x.conclusion));
      return failed.length
        ? { ok: false, reason: `CI failed: ${[...new Set(failed.map((f) => f.workflowName))].join(', ')}` }
        : { ok: true };
    }
    await sleep(pollMs);
  }
  return { ok: false, reason: 'timed out waiting for CI' };
}

export async function pushCommand(remote, branch, options = {}) {
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }
  const args = resolvePushArgs(remote, branch);
  const hasDeps = repos.some((r) => (r.dependsOn || []).length);

  // No ordering needed and not waiting on CI → plain parallel push (unchanged behavior).
  if (!hasDeps && !options.waitCi) {
    await gitProxyCommand('push', args, options);
    return;
  }

  if (options.waitCi && !(await hasGh())) {
    console.log(
      chalk.red('\n❌ --wait-ci needs the GitHub CLI (`gh`).') + chalk.gray(' Install it and run `gh auth login`.\n')
    );
    return;
  }

  const depsByName = resolveDeps(repos);
  console.log(
    chalk.cyan.bold(`\n🔀 Pushing ${repos.length} repositories in dependency order`) +
      (options.waitCi ? chalk.gray(' (waiting for CI between waves)') : '') +
      '\n'
  );

  const task = async (repo) => {
    const push = await runGitCommand(repo.path, ['push', ...args]);
    const cls = classifyResult(push);
    if (cls === 'fail') {
      console.log(`${chalk.red('✖')} ${chalk.blue(repo.name)} ${chalk.red('(push failed)')}`);
      if (push.all) console.log(chalk.red(push.all.trim().replace(/^/gm, '    ')));
      const e = new Error('push failed');
      e.silent = true;
      throw e;
    }
    if (cls === 'noop') {
      console.log(`${chalk.gray('–')} ${chalk.blue(repo.name)} ${chalk.gray('(nothing to push)')}`);
      return { cls };
    }
    if (options.waitCi) {
      console.log(`${chalk.cyan('⏳')} ${chalk.blue(repo.name)} ${chalk.gray('pushed — waiting for CI…')}`);
      const sha = (await runGitCommand(repo.path, ['rev-parse', 'HEAD'])).stdout.trim();
      const ci = await waitForCi(repo.path, sha);
      if (!ci.ok) {
        console.log(`${chalk.red('✖')} ${chalk.blue(repo.name)} ${chalk.red(`(CI: ${ci.reason})`)}`);
        const e = new Error('ci failed');
        e.silent = true;
        throw e;
      }
      console.log(`${chalk.green('✔')} ${chalk.blue(repo.name)} ${chalk.gray(`(pushed · CI ${ci.note || 'green'})`)}`);
      return { cls, ci };
    }
    console.log(`${chalk.green('✔')} ${chalk.blue(repo.name)} ${chalk.gray('(pushed)')}`);
    return { cls };
  };

  let results;
  try {
    results = await runDependencyGraph(repos, (r) => r.name, (r) => depsByName.get(r.name), task, {
      concurrency: concurrencyFrom(options),
    });
  } catch (err) {
    console.log(chalk.red(`\n❌ ${err.message}\n`)); // e.g. cycle detected
    return;
  }

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  for (const repo of repos) {
    const r = results.get(repo.name);
    if (r.status === 'skipped') {
      skipped += 1;
      console.log(`${chalk.gray('–')} ${chalk.blue(repo.name)} ${chalk.gray(`(skipped — ${r.reason})`)}`);
    } else if (r.status === 'fail') {
      fail += 1;
    } else {
      ok += 1;
    }
  }
  const parts = [chalk.green(`${ok} ok`)];
  if (skipped) parts.push(chalk.yellow(`${skipped} skipped`));
  if (fail) parts.push(chalk.red(`${fail} failed`));
  console.log('\n' + parts.join(chalk.gray(' · ')) + '\n');
}
