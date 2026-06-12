// Intentionally does NOT edit your shell rc files automatically.
// Shell completion is opt-in — print a hint instead.

// Stay quiet during CI / programmatic installs.
if (process.env.CI || process.env.npm_config_global !== 'true') {
  process.exit(0);
}

console.log(`
monogit installed. To enable tab-completion, run one of:

  monogit completion install zsh
  monogit completion install bash
  monogit completion install fish

(or print the script with \`monogit completion <shell>\` and source it yourself)
`);
