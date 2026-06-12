import chalk from 'chalk';
import ora from 'ora';
import { resolveRepos } from '../utils/config.js';
import { getRepoStatus } from '../utils/git.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice, concurrencyFrom } from '../utils/ui.js';
import { visualCommand } from './visual.js';

// Each cell carries plain text (for width math) and a colored render string,
// since chalk's ANSI codes break naive padding.
function cell(text, render) {
  return { text, render: render === undefined ? text : render };
}

function branchCell(st) {
  if (st.detached) return cell(`(${st.branch})`, chalk.red(`(${st.branch})`));
  return cell(st.branch, chalk.white(st.branch));
}

function syncCell(st) {
  if (!st.upstream) return cell('—', chalk.gray('—'));
  if (st.ahead === 0 && st.behind === 0) return cell('✓', chalk.green('✓'));
  const text = `↑${st.ahead} ↓${st.behind}`;
  const render = (st.behind > 0 ? chalk.yellow : chalk.cyan)(text);
  return cell(text, render);
}

function changesCell(st) {
  if (st.dirty === 0) return cell('clean', chalk.green('clean'));
  const parts = [];
  const plain = [];
  if (st.staged) {
    parts.push(chalk.green(`+${st.staged}`));
    plain.push(`+${st.staged}`);
  }
  if (st.unstaged) {
    parts.push(chalk.yellow(`~${st.unstaged}`));
    plain.push(`~${st.unstaged}`);
  }
  if (st.untracked) {
    parts.push(chalk.gray(`?${st.untracked}`));
    plain.push(`?${st.untracked}`);
  }
  return cell(plain.join(' '), parts.join(' '));
}

function stateCell(st) {
  if (st.state === 'clean') return cell('', '');
  return cell(`⚠ ${st.state}`, chalk.red(`⚠ ${st.state}`));
}

function pad(text, width) {
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function renderTable(rows) {
  const header = ['REPO', 'BRANCH', 'SYNC', 'CHANGES', 'STATE'].map((h) => cell(h, chalk.bold.gray(h)));
  const all = [header, ...rows];
  const widths = header.map((_, col) => Math.max(...all.map((r) => r[col].text.length)));

  for (const row of all) {
    const line = row
      .map((c, col) => c.render + ' '.repeat(Math.max(0, widths[col] - c.text.length)))
      .join('   ')
      .replace(/\s+$/, '');
    console.log('  ' + line);
  }
}

export async function statusCommand(options = {}) {
  // `--full` falls back to the original per-repo boxed `git status`.
  if (options.full) {
    await visualCommand('status', [], options);
    return;
  }

  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }

  const spinner = ora(`Inspecting ${repos.length} repositories...`).start();
  const settled = await mapLimit(repos, concurrencyFrom(options), async (repo) => {
    const st = await getRepoStatus(repo.path);
    return { repo, st };
  });
  spinner.stop();

  const data = settled.map((entry) =>
    entry.status === 'fulfilled'
      ? entry.value
      : { repo: { name: '?' }, st: { ok: false, error: String(entry.reason) } }
  );

  if (options.json) {
    console.log(JSON.stringify(data.map((d) => ({ repo: d.repo.name, ...d.st })), null, 2));
    return;
  }

  console.log(chalk.cyan.bold(`\n📊 Status of ${repos.length} repositories\n`));

  const rows = data.map(({ repo, st }) => {
    if (!st.ok) {
      return [
        cell(repo.name, chalk.blue(repo.name)),
        cell('error', chalk.red('error')),
        cell('', ''),
        cell('', ''),
        cell(st.error || '', chalk.red(st.error || '')),
      ];
    }
    return [cell(repo.name, chalk.blue(repo.name)), branchCell(st), syncCell(st), changesCell(st), stateCell(st)];
  });

  renderTable(rows);

  const dirty = data.filter((d) => d.st.ok && d.st.dirty > 0).length;
  const behind = data.filter((d) => d.st.ok && d.st.behind > 0).length;
  const ahead = data.filter((d) => d.st.ok && d.st.ahead > 0).length;
  const summary = [
    chalk.green(`${data.filter((d) => d.st.ok && d.st.dirty === 0).length} clean`),
    dirty ? chalk.yellow(`${dirty} dirty`) : null,
    ahead ? chalk.cyan(`${ahead} ahead`) : null,
    behind ? chalk.yellow(`${behind} behind`) : null,
  ].filter(Boolean);
  console.log('\n  ' + summary.join(chalk.gray(' · ')) + '\n');
}
