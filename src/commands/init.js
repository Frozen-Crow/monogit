import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs/promises';
import path from 'node:path';
import { findGitRepos, isGitRepo, initGitRepo, getRemoteUrl, getCurrentBranch } from '../utils/git.js';
import { writeConfig } from '../utils/config.js';

async function listTopLevelDirs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
}

async function toEntry(root, rel) {
  const abs = path.join(root, rel);
  const remote = await getRemoteUrl(abs);
  const branch = await getCurrentBranch(abs);
  return { path: rel, ...(remote ? { remote } : {}), ...(branch ? { branch } : {}) };
}

export async function initCommand(options = {}) {
  console.log(chalk.cyan.bold('\n🚀 Initializing Monogit Configuration\n'));

  const root = process.cwd();
  const depth = parseInt(options.depth, 10) || 3;

  const spinner = ora('Scanning for git repositories...').start();
  const gitRepos = await findGitRepos(root, depth);
  const topLevel = await listTopLevelDirs(root);
  const nonGitDirs = [];
  for (const dir of topLevel) {
    if (!(await isGitRepo(path.join(root, dir))) && !gitRepos.includes(dir)) nonGitDirs.push(dir);
  }
  spinner.stop();

  if (gitRepos.length === 0 && nonGitDirs.length === 0) {
    console.log(chalk.yellow('No subdirectories found in the current folder.'));
    return;
  }

  const questions = [];
  if (gitRepos.length > 0) {
    questions.push({
      type: 'checkbox',
      name: 'linkedRepos',
      message: 'Select existing Git repositories to link:',
      choices: gitRepos,
      default: gitRepos,
    });
  }
  if (nonGitDirs.length > 0) {
    questions.push({
      type: 'checkbox',
      name: 'initRepos',
      message: 'Select non-Git folders to initialize and link:',
      choices: nonGitDirs,
    });
  }

  const answers = await inquirer.prompt(questions);

  const selected = [...(answers.linkedRepos || [])];

  if (answers.initRepos && answers.initRepos.length > 0) {
    console.log('');
    for (const dir of answers.initRepos) {
      const initSpinner = ora(`Initializing Git in ${chalk.blue(dir)}...`).start();
      await initGitRepo(path.join(root, dir));
      initSpinner.succeed(`Initialized ${chalk.blue(dir)}`);
      selected.push(dir);
    }
  }

  // Record remote URL + default branch so the workspace can be re-cloned later.
  const repos = [];
  for (const rel of selected) repos.push(await toEntry(root, rel));

  await writeConfig({ repos }, path.join(root, '.monogit.json'));

  console.log(chalk.green.bold('\n✅ Configuration saved to .monogit.json'));
  console.log(chalk.gray(`Linked ${repos.length} repositories.\n`));
}
