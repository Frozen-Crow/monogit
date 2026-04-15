# 🚀 monogit

**Manage multiple git repositories under a single parent folder with one command.**

monogit gives you a monorepo workflow without a monorepo. Run git operations across all your linked repositories simultaneously — branching, committing, pushing, and more — with a single command.

---

## ✨ Features

- **Interactive Setup** — Scan a directory, detect existing repos, and optionally initialize new ones
- **Unified Git Commands** — Run `checkout`, `add`, `commit`, `push`, `pull` across all repos at once
- **Visual Split-Screen** — View `status`, `log`, and `diff` for every repo in partitioned terminal boxes
- **Parallel Execution** — All commands run concurrently across repos for maximum speed
- **Error Resilience** — One repo failing won't block the others

---

## 📦 Installation

```bash
npm i -g @frozencrow/monogit
```

Once installed, `monogit` is available as a global command.

---

## 🛠 Getting Started

### 1. Initialize your workspace

Navigate to a parent directory that contains (or will contain) your git repositories, then run:

```bash
monogit init
```

This will:
- Scan all subdirectories
- Detect which ones are already git repositories
- Let you select which repos to link
- Offer to `git init` any non-git directories you want to include
- Save the configuration to `.monogit.json`

### 2. Start working across repos

```bash
# Create a new branch in all repos
monogit checkout -b feature/my-feature

# Check status across all repos
monogit status

# Stage all changes
monogit add .

# Commit everywhere
monogit commit -m "implement shared feature"

# Push to all remotes
monogit push origin feature/my-feature
```

---

## 📖 Commands

### `monogit init`

Interactively configure which repositories to manage.

```bash
monogit init
```

- Scans the current directory for subdirectories
- Presents existing git repos for selection
- Offers to initialize git in non-repo directories
- Saves configuration to `.monogit.json`

---

### `monogit checkout <branch>`

Switch branches across all linked repositories.

```bash
# Switch to an existing branch
monogit checkout main

# Create and switch to a new branch
monogit checkout -b feature/new-work
```

| Option | Description |
|--------|-------------|
| `-b` | Create a new branch |

---

### `monogit add <paths...>`

Stage files across all linked repositories.

```bash
# Stage everything
monogit add .

# Stage specific files
monogit add src/ README.md
```

---

### `monogit commit`

Commit staged changes across all linked repositories.

```bash
# Commit staged changes
monogit commit -m "your commit message"

# Stage and commit all tracked changes
monogit commit -am "your commit message"

# Commit specific paths
monogit commit -m "update docs" docs/
```

| Option | Description |
|--------|-------------|
| `-m <message>` | **Required.** Commit message |
| `-a` | Automatically stage modified/deleted files |

---

### `monogit push [remote] [branch]`

Push commits to remote repositories.

```bash
# Push (default remote/branch)
monogit push

# Push to a specific remote and branch
monogit push origin main
```

---

### `monogit pull [remote] [branch]`

Pull updates from remote repositories.

```bash
# Pull (default remote/branch)
monogit pull

# Pull from a specific remote and branch
monogit pull origin main
```

---

### `monogit status`

View the git status of all linked repositories in a split-screen layout.

```bash
monogit status
```

Each repository's status is displayed in its own bordered box for easy scanning.

---

### `monogit log`

View recent commit history across all repositories.

```bash
monogit log
```

Shows the last 5 commits per repo in a compact graph format, each in a separate box.

---

### `monogit diff`

View unstaged changes across all repositories.

```bash
monogit diff
```

Displays diffs for each repository in separate bordered boxes with color-coded output.

---

## ⚙️ Configuration

monogit stores its configuration in a `.monogit.json` file in the working directory:

```json
{
  "repos": [
    "api",
    "client",
    "shared-lib"
  ]
}
```

Each entry is a relative path to a subdirectory containing a git repository.

> **Tip:** You can commit `.monogit.json` to share configuration with your team, or add it to `.gitignore` if it's personal.

---

## 🏗 Project Structure

```
monogit/
├── index.js                    # CLI entry point
├── package.json
├── .monogit.json               # Generated config (per workspace)
└── src/
    ├── commands/
    │   ├── init.js             # Interactive repo linking
    │   ├── git-proxy.js        # Parallel proxy for standard git commands
    │   └── visual.js           # Split-screen output for log/diff/status
    └── utils/
        ├── config.js           # Read/write .monogit.json
        └── git.js              # Git command execution via execa
```

---

## 🧰 Built With

- [Commander.js](https://github.com/tj/commander.js) — CLI framework
- [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) — Interactive prompts
- [execa](https://github.com/sindresorhus/execa) — Process execution
- [chalk](https://github.com/chalk/chalk) — Terminal styling
- [ora](https://github.com/sindresorhus/ora) — Spinners
- [boxen](https://github.com/sindresorhus/boxen) — Boxed terminal output

---

## 📄 License

ISC
