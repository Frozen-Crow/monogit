import { resolveRepos } from '../utils/config.js';
import { runGitCommand } from '../utils/git.js';

export async function completeAction(args) {
  // args are the command-line words: [0]=monogit, [1]=command, [2+]=arguments
  const cmd = args[1];

  const needsBranches = ['checkout', 'merge', 'branch', 'pull', 'push'].includes(cmd);
  if (!needsBranches) return;

  const repos = await resolveRepos();
  if (repos.length === 0) return;

  const { stdout } = await runGitCommand(repos[0].path, ['branch', '--format=%(refname:short)']);
  if (!stdout) return;

  for (const branch of stdout.split('\n').map((b) => b.trim()).filter(Boolean)) {
    console.log(branch);
  }
}
