import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs/promises';
import path from 'node:path';
import { findGitRepos, isGitRepo, initGitRepo, getRemoteUrl, getCurrentBranch } from '../utils/git.js';
import { writeConfig, parseList } from '../utils/config.js';
import { MODELS, DEFAULT_MODEL } from '../core/voice-setup.js';

async function listTopLevelDirs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
}

async function toEntry(root, rel) {
  const abs = path.join(root, rel);
  const remote = await getRemoteUrl(abs);
  const branch = await getCurrentBranch(abs);
  return { path: rel, ...(remote ? { remote } : {}), ...(branch ? { branch } : {}) };
}

// Pure: assemble .monogit.json from init answers, writing only non-default values.
export function assembleInitConfig(repos, { link, untracked, protectedInput, groups, voice } = {}) {
  const config = { repos };

  const commit = {};
  if (link) commit.link = true; // default is off, so only record when enabled
  if (untracked === false) commit.untracked = false; // default is on
  if (Object.keys(commit).length) config.commit = commit;

  const prot = parseList(protectedInput);
  if (prot.length) config.protected = prot;

  if (groups && Object.keys(groups).length) config.groups = groups;
  if (voice && Object.keys(voice).length) config.voice = voice;

  return config;
}

async function promptGroups(repoNames) {
  const groups = {};
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { name } = await inquirer.prompt([
      { type: 'input', name: 'name', message: 'Group name (blank to finish):', default: '' },
    ]);
    if (!name.trim()) break;
    const { members } = await inquirer.prompt([
      { type: 'checkbox', name: 'members', message: `Repos in "${name.trim()}":`, choices: repoNames },
    ]);
    if (members.length) groups[name.trim()] = members;
  }
  return groups;
}

async function promptVoice() {
  const a = await inquirer.prompt([
    {
      type: 'list',
      name: 'model',
      message: 'Whisper model for voice control:',
      choices: Object.keys(MODELS),
      default: DEFAULT_MODEL,
    },
    { type: 'confirm', name: 'confirm', message: 'Ask for a spoken "yes" before write commands?', default: true },
    { type: 'input', name: 'device', message: 'Mic device index for ffmpeg (blank = default):', default: '' },
  ]);

  const voice = {};
  if (a.model && a.model !== DEFAULT_MODEL) voice.model = a.model;
  if (!a.confirm) voice.confirm = false;
  const dev = a.device.trim();
  if (dev) voice.device = dev.startsWith(':') ? dev : `:${dev}`;
  return voice;
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

  const repoQuestions = [];
  if (gitRepos.length > 0) {
    repoQuestions.push({
      type: 'checkbox',
      name: 'linkedRepos',
      message: 'Select existing Git repositories to link:',
      choices: gitRepos,
      default: gitRepos,
    });
  }
  if (nonGitDirs.length > 0) {
    repoQuestions.push({
      type: 'checkbox',
      name: 'initRepos',
      message: 'Select non-Git folders to initialize and link:',
      choices: nonGitDirs,
    });
  }

  const answers = await inquirer.prompt(repoQuestions);
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

  // ---- workspace options ----
  console.log(chalk.cyan('\n⚙️  Workspace options\n'));
  const core = await inquirer.prompt([
    { type: 'confirm', name: 'link', message: 'Link commits across repos with a shared Change-Id?', default: true },
    {
      type: 'confirm',
      name: 'untracked',
      message: 'Include untracked (new) files when committing via voice/watch?',
      default: true,
    },
    {
      type: 'input',
      name: 'protectedInput',
      message: 'Branches tidy should never delete (comma-separated, blank = none):',
      default: '',
    },
    { type: 'confirm', name: 'advanced', message: 'Configure repo groups & voice now?', default: false },
  ]);

  let groups = {};
  let voice = {};
  if (core.advanced) {
    if (repos.length > 0) {
      console.log(chalk.cyan('\n🏷  Groups (blank name to skip/finish)\n'));
      groups = await promptGroups(repos.map((r) => r.path));
    }
    console.log(chalk.cyan('\n🎙  Voice\n'));
    voice = await promptVoice();
  }

  const config = assembleInitConfig(repos, {
    link: core.link,
    untracked: core.untracked,
    protectedInput: core.protectedInput,
    groups,
    voice,
  });

  await writeConfig(config, path.join(root, '.monogit.json'));

  console.log(chalk.green.bold('\n✅ Configuration saved to .monogit.json'));
  console.log(chalk.gray(`Linked ${repos.length} repositories.`));
  const extras = [
    config.commit?.link && 'commit linking',
    config.commit?.untracked === false && 'tracked-only commits',
    config.protected && `${config.protected.length} protected branch(es)`,
    Object.keys(groups).length && `${Object.keys(groups).length} group(s)`,
    Object.keys(voice).length && 'voice settings',
  ].filter(Boolean);
  if (extras.length) console.log(chalk.gray(`Configured: ${extras.join(', ')}.`));
  console.log('');
}
