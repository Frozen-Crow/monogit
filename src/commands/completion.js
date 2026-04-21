import { Command } from 'commander';

export async function completionCommand(shellType, program) {
  const commands = program.commands
    .filter(cmd => !cmd._hidden)
    .map(cmd => ({
      name: cmd.name(),
      description: cmd.description()
    }));

  if (shellType === 'bash') {
    generateBashCompletion(commands);
  } else if (shellType === 'zsh') {
    generateZshCompletion(commands);
  } else {
    console.error('Unsupported shell. Supported shells: bash, zsh');
    process.exit(1);
  }
}

function generateBashCompletion(commands) {
  const commandNames = commands.map(c => c.name).join(' ');
  console.log(`
_monogit_completion() {
    local cur prev opts
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    opts="${commandNames} help"

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
  `.trim());
}

function generateZshCompletion(commands) {
  const commandList = commands.map(c => `'${c.name}:${c.description.replace(/'/g, "'\\''")}'`).join('\n    ');
  console.log(`
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
      checkout|branch|merge|push|pull)
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
  `.trim());
}
