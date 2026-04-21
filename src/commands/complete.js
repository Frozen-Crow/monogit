import { getRepos } from '../utils/config.js';
import { runGitCommand } from '../utils/git.js';
import path from 'node:path';

export async function completeAction(args) {
  // args will be the words from the command line
  // Index 0 is 'monogit', index 1 is the command, index 2+ are arguments
  const cmd = args[1];
  const lastArg = args[args.length - 1];
  
  // If we are at the command level (e.g. "monogit <TAB>")
  // This is handled by the static part of the completion script usually,
  // but we can support dynamic command flags if we wanted.
  
  const needsBranches = ['checkout', 'merge', 'branch', 'pull', 'push'].includes(cmd);
  
  if (needsBranches) {
    const repos = await getRepos();
    if (repos.length > 0) {
      const firstRepo = path.join(process.cwd(), repos[0]);
      const { stdout } = await runGitCommand(firstRepo, ['branch', '--format=%(refname:short)']);
      if (stdout) {
        const branches = stdout.split('\n').map(b => b.trim()).filter(Boolean);
        branches.forEach(b => {
          // Some shells handle filtering themselves, but we can help
          console.log(b);
        });
      }
    }
  }
}
