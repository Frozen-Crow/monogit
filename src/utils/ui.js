import chalk from 'chalk';
import { getWorkspaceRoot } from './config.js';

// Print a context-aware message when a command resolves to zero repos.
export async function noReposNotice(options = {}) {
  const root = await getWorkspaceRoot();
  if (!root) {
    console.log(chalk.red('\n❌ No monogit workspace found. Run `monogit init` first.\n'));
  } else if (options.only || options.except || options.group) {
    console.log(chalk.yellow('\n⚠️  No repositories matched the given --only/--except/--group filters.\n'));
  } else {
    console.log(chalk.red('\n❌ No repositories linked. Run `monogit init` first.\n'));
  }
}

export const DEFAULT_CONCURRENCY = 8;

export function concurrencyFrom(options = {}) {
  const n = parseInt(options.concurrency, 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CONCURRENCY;
}
