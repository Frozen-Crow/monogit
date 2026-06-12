import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';

const BRANCH_CMDS = 'checkout branch merge push pull';

export async function completionCommand(shellType, program, options = {}) {
  const commands = program.commands
    .filter((cmd) => !cmd._hidden)
    .map((cmd) => ({ name: cmd.name(), description: cmd.description() }));

  const shell = (shellType || 'zsh').toLowerCase();
  const generators = {
    bash: generateBash,
    zsh: generateZsh,
    fish: generateFish,
    powershell: generatePowerShell,
    pwsh: generatePowerShell,
  };

  const generate = generators[shell];
  if (!generate) {
    console.error(`Unsupported shell "${shellType}". Supported: bash, zsh, fish, powershell`);
    process.exit(1);
  }

  if (options.install) {
    installCompletion(shell);
    return;
  }

  console.log(generate(commands));
}

function installCompletion(shell) {
  const home = os.homedir();
  const targets = {
    zsh: { file: path.join(home, '.zshrc'), line: 'source <(monogit completion zsh)' },
    bash: { file: path.join(home, '.bashrc'), line: 'source <(monogit completion bash)' },
    fish: {
      file: path.join(home, '.config', 'fish', 'completions', 'monogit.fish'),
      replace: true,
    },
  };

  if (shell === 'powershell' || shell === 'pwsh') {
    console.log(
      chalk.yellow('PowerShell auto-install is not supported. Add this to your $PROFILE:\n') +
        chalk.gray('  monogit completion powershell | Out-String | Invoke-Expression')
    );
    return;
  }

  const target = targets[shell];
  if (target.replace) {
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    fs.writeFileSync(target.file, generateFish() + '\n', 'utf8');
    console.log(chalk.green(`✅ Installed fish completion to ${target.file}`));
    return;
  }

  const block = `\n# monogit completion\ncommand -v monogit >/dev/null 2>&1 && ${target.line}\n`;
  try {
    const content = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : '';
    if (content.includes('monogit completion')) {
      console.log(chalk.gray(`ℹ️  Completion already present in ${target.file}`));
      return;
    }
    fs.appendFileSync(target.file, block);
    console.log(chalk.green(`✅ Added completion to ${target.file}`) + chalk.gray(` (restart your shell)`));
  } catch (err) {
    console.error(chalk.red(`Could not update ${target.file}: ${err.message}`));
  }
}

function generateBash(commands = []) {
  const names = commands.map((c) => c.name).join(' ');
  return `
_monogit_completion() {
    local cur prev opts
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    opts="${names} help"

    case "\${prev}" in
        checkout|merge|branch|push|pull)
            local branches=$(monogit __complete "\${COMP_WORDS[@]:1}")
            COMPREPLY=( $(compgen -W "\${branches}" -- \${cur}) )
            return 0
            ;;
    esac

    if [[ \${COMP_CWORD} -eq 1 ]] ; then
        COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
        return 0
    fi
}
complete -F _monogit_completion monogit
  `.trim();
}

function generateZsh(commands = []) {
  const commandList = commands
    .map((c) => `'${c.name}:${c.description.replace(/'/g, "'\\''")}'`)
    .join('\n    ');
  return `
#compdef monogit

_monogit() {
  local -a commands
  commands=(
    ${commandList}
    'help:Display help for command'
  )

  if (( CURRENT == 2 )); then
    _describe -t commands 'monogit command' commands
  elif (( CURRENT > 2 )); then
    local cmd=\${words[2]}
    case \$cmd in
      ${BRANCH_CMDS.split(' ').join('|')})
        local -a branches
        branches=(\${(f)"\$(monogit __complete \${words[@]:1})"})
        _describe -t branches 'branch' branches
        ;;
    esac
  fi
}

if [ "$funcstack[1]" = "_monogit" ]; then
    _monogit "$@"
else
    compdef _monogit monogit
fi
  `.trim();
}

function generateFish(commands = []) {
  const lines = commands.map(
    (c) => `complete -c monogit -n __fish_use_subcommand -a ${c.name} -d '${c.description.replace(/'/g, "\\'")}'`
  );
  // Dynamic branch completion for branch-taking subcommands.
  lines.push(
    `complete -c monogit -n '__fish_seen_subcommand_from ${BRANCH_CMDS}' -a '(monogit __complete (commandline -opc)[2..-1])'`
  );
  return lines.join('\n');
}

function generatePowerShell(commands = []) {
  const names = commands.map((c) => `'${c.name}'`).join(', ');
  return `
Register-ArgumentCompleter -Native -CommandName monogit -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $commands = @(${names}, 'help')
    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
  `.trim();
}
