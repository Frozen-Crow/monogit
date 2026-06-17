import chalk from 'chalk';

// Pure frame builder for the `monogit watch` TUI. Returns an array of lines.
// Kept side-effect-free so it can be snapshot-tested.

function syncText(st) {
  if (!st.ok) return 'error';
  if (!st.upstream) return '—';
  if (st.ahead === 0 && st.behind === 0) return '✓';
  return `↑${st.ahead} ↓${st.behind}`;
}

function changesText(st) {
  if (!st.ok) return '';
  if (st.dirty === 0) return 'clean';
  return [st.staged && `+${st.staged}`, st.unstaged && `~${st.unstaged}`, st.untracked && `?${st.untracked}`]
    .filter(Boolean)
    .join(' ');
}

function colorSync(st, text) {
  if (!st.ok) return chalk.red(text);
  if (!st.upstream) return chalk.gray(text);
  if (st.ahead === 0 && st.behind === 0) return chalk.green(text);
  return (st.behind > 0 ? chalk.yellow : chalk.cyan)(text);
}

function colorChanges(st, text) {
  if (!st.ok) return '';
  return st.dirty === 0 ? chalk.green(text) : chalk.yellow(text);
}

function pad(text, width) {
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function rule(width) {
  return chalk.gray('─'.repeat(Math.max(0, width)));
}

export const KEY_LEGEND =
  '↑/↓ select · enter detail · r refresh · f fetch · p pull · P push · c commit · m merge · t tidy · q quit';

export function renderDashboard(state) {
  const { rows = [], selected = 0, message = '', width = 80, root = '', time = '', busy = false, detail = null } = state;

  const lines = [];
  const counts = {
    clean: rows.filter((r) => r.st.ok && r.st.dirty === 0).length,
    dirty: rows.filter((r) => r.st.ok && r.st.dirty > 0).length,
    behind: rows.filter((r) => r.st.ok && r.st.behind > 0).length,
    ahead: rows.filter((r) => r.st.ok && r.st.ahead > 0).length,
  };

  // Header
  const title = chalk.cyan.bold(' monogit watch');
  const meta = chalk.gray(`${rows.length} repos · ${root}`);
  lines.push(`${title}  ${meta}${' '.repeat(Math.max(1, width - 15 - meta.length - 12))}${chalk.gray(time)}`);
  lines.push(rule(width));

  // Column header
  const cols = {
    repo: Math.max(4, ...rows.map((r) => r.repo.length)),
    branch: Math.max(6, ...rows.map((r) => (r.st.branch || '').length)),
    sync: 8,
    changes: 10,
  };
  lines.push(
    '  ' +
      chalk.bold.gray(pad('REPO', cols.repo)) +
      '  ' +
      chalk.bold.gray(pad('BRANCH', cols.branch)) +
      '  ' +
      chalk.bold.gray(pad('SYNC', cols.sync)) +
      '  ' +
      chalk.bold.gray(pad('CHANGES', cols.changes)) +
      '  ' +
      chalk.bold.gray('STATE')
  );

  // Repo rows
  rows.forEach((r, i) => {
    const sel = i === selected;
    const marker = sel ? chalk.cyan('▸ ') : '  ';
    const name = sel ? chalk.cyan.bold(pad(r.repo, cols.repo)) : chalk.blue(pad(r.repo, cols.repo));
    const branch = r.st.ok
      ? (r.st.detached ? chalk.red : chalk.white)(pad(r.st.branch || '', cols.branch))
      : chalk.red(pad('—', cols.branch));
    const sync = colorSync(r.st, pad(syncText(r.st), cols.sync));
    const changes = colorChanges(r.st, pad(changesText(r.st), cols.changes));
    const stateTxt = !r.st.ok ? chalk.red(r.st.error || 'error') : r.st.state !== 'clean' ? chalk.red(`⚠ ${r.st.state}`) : '';
    lines.push(`${marker}${name}  ${branch}  ${sync}  ${changes}  ${stateTxt}`.replace(/\s+$/, ''));
  });

  // Detail pane for the selected repo
  if (detail && detail.length) {
    lines.push(rule(width));
    for (const line of detail) lines.push('  ' + chalk.gray(line));
  }

  // Footer
  lines.push(rule(width));
  const summary = [
    chalk.green(`${counts.clean} clean`),
    counts.dirty ? chalk.yellow(`${counts.dirty} dirty`) : null,
    counts.behind ? chalk.yellow(`${counts.behind} behind`) : null,
    counts.ahead ? chalk.cyan(`${counts.ahead} ahead`) : null,
  ]
    .filter(Boolean)
    .join(chalk.gray(' · '));
  lines.push(' ' + summary);
  lines.push(chalk.gray(' ' + KEY_LEGEND));
  if (busy) lines.push(chalk.yellow(' ⏳ ' + message));
  else if (message) lines.push(chalk.gray(' ' + message));

  return lines;
}
