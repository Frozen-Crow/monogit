import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { listSubdirectories, isGitRepo, initGitRepo } from '../utils/git.js';
import { writeConfig } from '../utils/config.js';

export async function initCommand() {
  console.log(chalk.cyan.bold('\n🚀 Initializing Monogit Configuration\n'));

  const spinner = ora('Scanning subdirectories...').start();
  const dirs = await listSubdirectories(process.cwd());
  spinner.stop();

  if (dirs.length === 0) {
    console.log(chalk.yellow('No subdirectories found in the current folder.'));
    return;
  }

  const gitRepos = [];
  const nonGitDirs = [];

  for (const dir of dirs) {
    if (await isGitRepo(dir)) {
      gitRepos.push(dir);
    } else {
      nonGitDirs.push(dir);
    }
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

  const finalRepos = [...(answers.linkedRepos || [])];

  if (answers.initRepos && answers.initRepos.length > 0) {
    console.log('');
    for (const dir of answers.initRepos) {
      const initSpinner = ora(`Initializing Git in ${chalk.blue(dir)}...`).start();
      await initGitRepo(dir);
      initSpinner.succeed(`Initialized ${chalk.blue(dir)}`);
      finalRepos.push(dir);
    }
  }

  await writeConfig({ repos: finalRepos });

  console.log(chalk.green.bold('\n✅ Configuration saved to .monogit.json'));
  console.log(chalk.gray(`Linked ${finalRepos.length} repositories.\n`));
}
