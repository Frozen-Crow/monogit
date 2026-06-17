import chalk from 'chalk';
import readline from 'node:readline';
import { resolveRepos, readConfig } from '../utils/config.js';
import { runGitCommand, getRepoStatus, resolvePushArgs } from '../utils/git.js';
import { mapLimit } from '../utils/concurrency.js';
import { noReposNotice } from '../utils/ui.js';
import { renderDashboard } from '../core/watch-render.js';
import { stageUntrackedDefault } from '../core/commit.js';
import { gitProxyCommand } from './git-proxy.js';
import { commitCommand } from './commit.js';
import { tidyCommand } from './tidy.js';

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const HOME = '\x1b[H';
const CLEAR_BELOW = '\x1b[J';

export async function watchCommand(options = {}) {
  const repos = await resolveRepos(options);
  if (repos.length === 0) {
    await noReposNotice(options);
    return;
  }
  if (!process.stdin.isTTY) {
    console.log(chalk.red('\n❌ `monogit watch` needs an interactive terminal.\n'));
    return;
  }

  const stageUntracked = stageUntrackedDefault(await readConfig());
  const intervalMs = Math.max(1000, (parseFloat(options.interval) || 5) * 1000);

  const state = {
    rows: repos.map((r) => ({ repo: r.name, st: { ok: true, branch: '…', dirty: 0, ahead: 0, behind: 0, state: 'clean' } })),
    selected: 0,
    message: '',
    busy: false,
    detail: null,
  };

  let refreshing = false;
  let suspended = false;
  let timer = null;
  let resolveDone;
  const done = new Promise((res) => (resolveDone = res));

  // ---- terminal lifecycle ----
  function paint() {
    const lines = renderDashboard({
      rows: state.rows,
      selected: state.selected,
      message: state.message,
      busy: state.busy,
      detail: state.detail,
      width: process.stdout.columns || 80,
      root: repos[0]?.root || process.cwd(),
      time: new Date().toLocaleTimeString(),
    });
    const max = (process.stdout.rows || 24) - 1;
    const frame = lines.slice(0, max).map((l) => l + '\x1b[K').join('\n');
    process.stdout.write(HOME + frame + '\n' + CLEAR_BELOW);
  }

  function restore() {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write(SHOW_CURSOR + ALT_OFF);
  }

  function attachInput() {
    process.stdout.write(ALT_ON + HIDE_CURSOR);
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on('keypress', onKey);
    process.stdout.on('resize', paint);
    process.stdin.resume();
  }

  function detachInput() {
    process.stdin.off('keypress', onKey);
    process.stdout.off('resize', paint);
    restore();
  }

  async function refresh() {
    if (refreshing || suspended) return;
    refreshing = true;
    try {
      const settled = await mapLimit(repos, 8, async (r) => ({ repo: r.name, st: await getRepoStatus(r.path) }));
      state.rows = settled.map((e, i) =>
        e.status === 'fulfilled' ? e.value : { repo: repos[i].name, st: { ok: false, error: String(e.reason) } }
      );
      if (state.detail) await loadDetail();
      if (!suspended) paint();
    } finally {
      refreshing = false;
    }
  }

  async function loadDetail() {
    const repo = repos[state.selected];
    if (!repo) {
      state.detail = null;
      return;
    }
    const sb = await runGitCommand(repo.path, ['-c', 'color.ui=always', 'status', '-sb']);
    const log = await runGitCommand(repo.path, ['-c', 'color.ui=always', 'log', '--oneline', '-n', '3']);
    state.detail = [
      ...(sb.all || '').split('\n').slice(0, 8),
      chalk.gray('— recent —'),
      ...(log.all || '').split('\n').slice(0, 3),
    ].filter((l) => l !== undefined);
  }

  // Run an action inline (in-TUI), showing a one-line summary.
  async function runInline(label, gitArgs) {
    if (state.busy) return;
    state.busy = true;
    state.message = `${label}…`;
    paint();
    const settled = await mapLimit(repos, 8, async (r) => (await runGitCommand(r.path, gitArgs)).exitCode === 0);
    const ok = settled.filter((e) => e.status === 'fulfilled' && e.value).length;
    const fail = repos.length - ok;
    state.message = `${label}: ${ok} ok${fail ? `, ${fail} failed` : ''} · ${new Date().toLocaleTimeString()}`;
    state.busy = false;
    await refresh();
  }

  // Tear down the TUI, run a normal (possibly interactive) command, then resume.
  async function suspend(fn) {
    suspended = true;
    detachInput();
    console.clear();
    try {
      await fn();
    } finally {
      await waitForEnter(chalk.gray('\n(press Enter to return to watch)'));
      attachInput();
      suspended = false;
      await refresh();
    }
  }

  function quit() {
    if (timer) clearInterval(timer);
    detachInput();
    process.off('SIGINT', quit);
    process.off('exit', restore);
    console.log(chalk.cyan('\n👋 monogit watch closed.\n'));
    resolveDone();
  }

  // ---- input handling ----
  function onKey(str, key) {
    if (state.busy) return; // ignore input mid-action
    const name = key?.name;
    if ((key?.ctrl && name === 'c') || str === 'q' || name === 'escape') return void quit();

    if (name === 'up' || str === 'k') {
      state.selected = (state.selected - 1 + state.rows.length) % state.rows.length;
      if (state.detail) loadDetail().then(paint);
      else paint();
    } else if (name === 'down' || str === 'j') {
      state.selected = (state.selected + 1) % state.rows.length;
      if (state.detail) loadDetail().then(paint);
      else paint();
    } else if (name === 'return') {
      if (state.detail) {
        state.detail = null;
        paint();
      } else {
        loadDetail().then(paint);
      }
    } else if (str === 'r') {
      refresh();
    } else if (str === 'f') {
      runInline('fetch', ['fetch', '--prune']);
    } else if (str === 'p') {
      runInline('pull', ['pull']);
    } else if (str === 'P') {
      suspend(() => gitProxyCommand('push', resolvePushArgs(), {}));
    } else if (str === 't') {
      suspend(() => tidyCommand({}));
    } else if (str === 'm') {
      suspend(async () => {
        const branch = await ask(chalk.cyan('Merge which branch? (blank to cancel): '));
        if (branch.trim()) await gitProxyCommand('merge', [branch.trim()], {});
        else console.log(chalk.gray('Cancelled.'));
      });
    } else if (str === 'c') {
      suspend(async () => {
        const msg = await ask(chalk.cyan('Commit message (blank to cancel): '));
        if (msg.trim()) {
          await commitCommand([], stageUntracked ? { message: [msg.trim()], addAll: true } : { message: [msg.trim()], a: true });
        } else {
          console.log(chalk.gray('Cancelled.'));
        }
      });
    }
  }

  // ---- start ----
  attachInput();
  process.on('SIGINT', quit);
  process.on('exit', restore);
  await refresh();
  timer = setInterval(() => {
    if (!state.busy && !suspended) refresh();
  }, intervalMs);

  await done;
}

// Minimal readline prompts used during `suspend` (TUI input is detached).
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function waitForEnter(prompt) {
  return ask(prompt + ' ').then(() => undefined);
}
