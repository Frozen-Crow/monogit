#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './src/commands/init.js';
import { gitProxyCommand } from './src/commands/git-proxy.js';
import { visualCommand } from './src/commands/visual.js';

const program = new Command();

program
  .name('monogit')
  .description('Manage multiple git repositories in a single folder')
  .version('1.0.0');

// Init
program
  .command('init')
  .description('Initialize monogit and link subdirectories')
  .action(initCommand);

// Checkout
program
  .command('checkout')
  .description('Run git checkout in all linked repositories')
  .argument('<branch>', 'the branch name')
  .option('-b', 'create a new branch')
  .action(async (branch, options) => {
    const args = options.b ? ['-b', branch] : [branch];
    await gitProxyCommand('checkout', args);
  });

// Add
program
  .command('add')
  .description('Run git add in all linked repositories')
  .argument('<path...>', 'files to add')
  .action(async (paths) => {
    await gitProxyCommand('add', paths);
  });

// Commit
program
  .command('commit')
  .description('Run git commit in all linked repositories')
  .argument('[paths...]', 'files to commit')
  .requiredOption('-m <message>', 'commit message')
  .option('-a', 'stage all modified/deleted files')
  .action(async (paths, options) => {
    const args = ['-m', options.m];
    if (options.a) args.push('-a');
    if (paths && paths.length > 0) {
      args.push('--', ...paths);
    }
    await gitProxyCommand('commit', args);
  });

// Log
program
  .command('log')
  .description('Show git log for all linked repositories')
  .action(async () => {
    await visualCommand('log', []);
  });

// Diff
program
  .command('diff')
  .description('Show git diff for all linked repositories')
  .action(async () => {
    await visualCommand('diff', []);
  });

// Status
program
  .command('status')
  .description('Show git status for all linked repositories')
  .action(async () => {
    await visualCommand('status', []);
  });

// Push
program
  .command('push')
  .description('Run git push in all linked repositories')
  .argument('[remote]', 'the remote name')
  .argument('[branch]', 'the branch name')
  .action(async (remote, branch) => {
    const args = [];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    await gitProxyCommand('push', args);
  });

// Pull
program
  .command('pull')
  .description('Run git pull in all linked repositories')
  .argument('[remote]', 'the remote name')
  .argument('[branch]', 'the branch name')
  .action(async (remote, branch) => {
    const args = [];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    await gitProxyCommand('pull', args);
  });

// Fetch
program
  .command('fetch')
  .description('Run git fetch in all linked repositories')
  .argument('[remote]', 'the remote name')
  .argument('[branch]', 'the branch name')
  .action(async (remote, branch) => {
    const args = [];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    await gitProxyCommand('fetch', args);
  });

// Merge
program
  .command('merge')
  .description('Run git merge in all linked repositories')
  .argument('<branch>', 'the branch name')
  .action(async (branch) => {
    await gitProxyCommand('merge', [branch]);
  });

program.parse(process.argv);
