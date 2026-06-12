# 🚀 monogit

**Manage multiple git repositories under a single parent folder with one command.**

[![GitHub](https://img.shields.io/badge/GitHub-monogit-blue?logo=github)](https://github.com/Frozen-Crow/monogit)

monogit gives you a monorepo workflow without a monorepo. Run git operations across all your linked repositories simultaneously — branching, committing, pushing, opening PRs, and more — with a single command.

---

## ✨ Features

- **Interactive Setup** — Recursively scan a directory, detect existing repos, and optionally initialize new ones
- **Unified Git Commands** — Run `checkout`, `add`, `commit`, `push`, `pull` across all repos at once
- **Cross-Repo Commits** — One shared editor message, and `Monogit-Change-Id` trailers that link a logical change across every repo
- **Status Dashboard** — One compact table: branch, ahead/behind, dirty count, and in-progress operations per repo
- **Branch Tidy** — Scan for and safely clean up orphaned branches (merged, or with a deleted upstream)
- **Pull Requests** — Open PRs across every repo with one command (via the GitHub CLI)
- **Arbitrary Commands** — `exec` any git command or `run` any shell command everywhere
- **Workspace Manifest** — Record remotes so a teammate can `clone` the whole workspace in one step
- **Targeting** — Scope any command to a subset of repos with `--only`, `--except`, or named `--group`s
- **Parallel & Resilient** — Commands run concurrently (bounded); one repo failing won't block the others
- **Works Anywhere in the Tree** — Like git, monogit finds your workspace from any subdirectory
- **MCP Server** — Drive the whole workspace from an LLM/agent via a built-in Model Context Protocol server
- **Shell Autocompletion** — Bash, Zsh, Fish, and PowerShell

---

## 📦 Installation

```bash
npm i -g @frozencrow/monogit
```

Once installed, `monogit` is available as a global command.

### Enable Tab Completion

Completion is **opt-in**. Install it for your shell:

```bash
monogit completion install zsh     # or: bash, fish
```

For PowerShell, add this to your `$PROFILE`:

```powershell
monogit completion powershell | Out-String | Invoke-Expression
```

You can also print the script and source it yourself, e.g. `source <(monogit completion zsh)`.

---

## 🛠 Getting Started

### 1. Initialize your workspace

Navigate to a parent directory that contains (or will contain) your git repositories, then run:

```bash
monogit init
```

This will scan for git repositories (recursively, up to `--depth`, default 3), let you select which to link, offer to `git init` any non-git folders, record each repo's remote/branch, and save the configuration to `.monogit.json`.

### 2. Work across repos

```bash
monogit checkout -b feature/my-feature   # branch everywhere
monogit status                           # dashboard of all repos
monogit add .                            # stage everything
monogit commit -m "implement feature"    # commit everywhere
monogit push origin feature/my-feature   # push everywhere
monogit pr --fill                        # open PRs everywhere
```

---

## 🎯 Targeting a subset of repos

Every multi-repo command accepts these filters:

| Option | Description |
|--------|-------------|
| `--only <repos>` | Comma-separated repos to include (by name or path) |
| `--except <repos>` | Comma-separated repos to exclude |
| `--group <groups>` | Comma-separated named groups (defined in `.monogit.json`) |
| `-c, --concurrency <n>` | Max repos to process in parallel (default 8) |

```bash
monogit status --only api,web
monogit push --group backend
monogit pull --except docs
```

---

## 📖 Commands

### `monogit init [--depth <n>]`

Interactively scan for and link repositories. Records remotes so the workspace can be re-cloned later.

### `monogit status [--full] [--json]`

Show a compact **status dashboard** across all repos:

```
  REPO    BRANCH        SYNC      CHANGES   STATE
  api     main          ✓         clean
  web     feature/wip   ↑2 ↓0     +1 ~3
  infra   main          ↑0 ↓4     ?2        ⚠ rebasing
```

- **SYNC** — `↑ahead ↓behind` vs upstream (`✓` up to date, `—` no upstream)
- **CHANGES** — `+staged ~unstaged ?untracked` (only non-zero parts shown; `clean` when none)
- **STATE** — flags an in-progress rebase / merge / cherry-pick

Use `--full` for the original per-repo boxed `git status`, or `--json` for machine-readable output.

### `monogit checkout <branch> [-b]`

Switch (or, with `-b`, create) branches across all repos.

### `monogit add <paths...>`

Stage files across all repos.

### `monogit commit [-m <message>] [-a] [paths...]`

Commit staged changes everywhere. Repos with nothing to commit are reported as **skipped**, not failed.

If you omit `-m`, monogit opens your editor **once** (respecting `core.editor`/`$EDITOR`), captures a single message, and applies it to every repo. An empty message aborts the whole batch. Pass `-m` multiple times for multi-paragraph messages.

**Cross-repo linking.** A logical change usually spans several repos, but each repo gets its own commit with nothing tying them together. With linking enabled, every commit in the batch is stamped with a shared `Monogit-Change-Id` trailer plus the list of participating repos:

```
feat: add login

Monogit-Change-Id: 01JA2B3C4D5E6F7G8H9J0K1M2N
Monogit-Repos: api@feature/login, web@feature/login
```

Only repos that actually commit are listed. Enable it per-workspace with `"commit": { "link": true }` in `.monogit.json`, or per-commit with `--link` / `--no-link`. Look a change back up with [`monogit show`](#monogit-show-change-id).

| Option | Description |
|--------|-------------|
| `-m, --message <msg>` | Commit message (repeatable; opens an editor if omitted) |
| `-a` | Stage all modified/deleted tracked files |
| `--link` / `--no-link` | Force linking on/off for this commit (overrides config) |

### `monogit show [change-id]`

Show every commit across all repos that shares a `Monogit-Change-Id` — reconstructing the atomic change a monorepo would give you for free. With no id, shows the most recent linked change.

```
$ monogit show 01JA2B3C4D5E6F7G8H9J0K1M2N
🔗 Change 01JA2B3C4D5E6F7G8H9J0K1M2N  (2 repos)

  api  a1b2c3d  feat: add login endpoint (2 minutes ago)
  web  d4e5f6a  feat: add login form (2 minutes ago)
```

Accepts an id prefix, and `--json` for machine-readable output.

### `monogit push / pull / fetch [remote] [branch]`

Sync with remotes.

### `monogit branch [branch] [-d|-D]`

List branches (no args), or create / delete a branch across all repos.

### `monogit merge <branch>`

Merge a branch into the current branch across all repos.

### `monogit tidy [options]`

Scan every repo for **orphaned branches** and clean them up. By default targets two high-confidence categories:

- **`gone`** — the upstream was deleted on the remote (PR merged, branch reaped). Force-deleted, since squash-merges leave these "unmerged" locally.
- **`merged`** — already merged into the default branch. Safely deleted with `git branch -d`.

The current, default, and any `protected` branches are never touched. Runs `git fetch --prune` first (so `gone` is accurate) and confirms before deleting.

```bash
monogit tidy                  # scan + interactive cleanup
monogit tidy --dry-run        # report only
monogit tidy --stale 60       # also branches idle 60+ days
monogit tidy --yes            # non-interactive (CI)
```

| Option | Description |
|--------|-------------|
| `--gone` / `--merged` / `--stale [days]` | Choose categories (default: gone + merged) |
| `--no-fetch` | Skip `git fetch --prune` |
| `--dry-run` | Report without deleting |
| `-y, --yes` | Delete without the prompt |
| `--protect <branches>` | Names/globs to never delete (e.g. `develop,release/*`) |
| `--json` | Machine-readable output |

### `monogit pr [options]`

Open pull requests across all repos using the [GitHub CLI](https://cli.github.com) (`gh`). Pushes the current branch, then opens a PR for each repo that has commits ahead of its base. Repos on the base branch or with no new commits are skipped.

```bash
monogit pr --fill                          # title/body from commits
monogit pr --title "Bump deps" --body "…"  # explicit
monogit pr --draft --base develop
monogit pr --web                           # finish each in the browser
```

| Option | Description |
|--------|-------------|
| `--title` / `--body` | PR title / body |
| `--base <branch>` | Base branch (defaults to each repo's default) |
| `--fill` | Fill from commit messages |
| `--draft` | Create draft PRs |
| `--web` | Open each PR in the browser |
| `--no-push` | Don't push before creating |

### `monogit exec -- <git args>`

Run an **arbitrary git command** across all repos — anything monogit doesn't wrap directly.

```bash
monogit exec -- stash list
monogit exec -- tag v1.2.0
monogit exec --only api -- reset --hard origin/main
```

### `monogit run "<command>"`

Run an **arbitrary shell command** in each repo.

```bash
monogit run "npm test"
monogit run "rm -rf node_modules"
```

### `monogit clone`

Clone any linked repo that has a recorded remote but is missing locally — reconstitutes a whole workspace from a committed `.monogit.json`.

### `monogit repos <list|add|remove>`

Manage linked repositories without re-running `init`.

```bash
monogit repos list           # show repos, remotes, presence, and groups
monogit repos add ./api      # link a repo (records its remote)
monogit repos remove api     # unlink (files untouched)
```

### `monogit log` / `monogit diff`

View recent history / unstaged changes for every repo in bordered boxes.

### `monogit completion [shell] [--install]`

Generate or install completion for `bash`, `zsh`, `fish`, or `powershell`.

### `monogit mcp`

Start the [MCP](https://modelcontextprotocol.io) server (JSON-RPC over stdio) so an LLM/agent can drive the workspace. See below.

---

## 🤖 Using monogit from an AI agent (MCP)

monogit ships a built-in **Model Context Protocol** server, so assistants like Claude can manage your repos directly. It exposes the workspace as structured tools.

Add it to your MCP client config (the server finds the workspace by walking up from `cwd`, just like the CLI — point `cwd` at your workspace or any subdirectory):

```json
{
  "mcpServers": {
    "monogit": {
      "command": "monogit",
      "args": ["mcp"],
      "cwd": "/path/to/your/workspace"
    }
  }
}
```

> No global install? Use `"command": "npx"`, `"args": ["-y", "@frozencrow/monogit", "mcp"]`. A standalone `monogit-mcp` binary is also provided.

**Tools exposed:**

| Tool | What it does |
|------|--------------|
| `monogit_status` | Per-repo branch, ahead/behind, dirty counts, in-progress ops |
| `monogit_list_repos` | Linked repos with remote/branch/presence |
| `monogit_exec` | Run arbitrary git args across all repos |
| `monogit_commit` | Commit across repos (with optional Change-Id linking) |
| `monogit_checkout` / `monogit_push` / `monogit_pull` | Branch & sync operations |
| `monogit_show` | Look up a cross-repo change by id |
| `monogit_tidy` | Scan for orphaned branches (read-only unless `execute: true`) |
| `monogit_pr` | Open pull requests via the GitHub CLI |

Every tool accepts `only` / `except` / `group` to scope which repos it touches. Destructive operations are gated: `monogit_tidy` is a dry run unless you pass `execute: true`.

---

## ⚙️ Configuration

monogit stores its configuration in a `.monogit.json` file, discovered by walking **up** from your current directory (like git's `.git`):

```json
{
  "repos": [
    "shared-lib",
    { "path": "api", "remote": "git@github.com:acme/api.git", "branch": "main" },
    { "path": "web", "remote": "git@github.com:acme/web.git", "branch": "main" }
  ],
  "groups": {
    "backend": ["api", "shared-lib"],
    "frontend": ["web"]
  },
  "protected": ["develop", "release/*"],
  "commit": { "link": true }
}
```

- **`repos`** — a relative path string, or an object with `path` plus an optional `remote`/`branch` (used by `monogit clone`).
- **`groups`** — named sets of repos for `--group`.
- **`protected`** — branches `monogit tidy` will never delete (the current and default branches are always protected too).
- **`commit.link`** — when `true`, `monogit commit` adds cross-repo `Monogit-Change-Id` trailers by default (override per-commit with `--no-link`).

> **Tip:** Commit `.monogit.json` to share the workspace with your team — they can `monogit clone` to get every repo.

---

## 🏗 Project Structure

```
monogit/
├── index.js                    # CLI entry point & command wiring
├── src/
│   ├── commands/
│   │   ├── init.js             # Interactive (recursive) repo linking
│   │   ├── git-proxy.js        # Parallel proxy for standard git commands
│   │   ├── commit.js           # Commit with editor fallback & cross-repo linking
│   │   ├── show.js             # Look up a linked change across repos
│   │   ├── visual.js           # Boxed output for log / diff / branch
│   │   ├── dashboard.js        # Status dashboard table
│   │   ├── tidy.js             # Orphaned-branch scan & cleanup
│   │   ├── exec.js             # Arbitrary git / shell passthrough
│   │   ├── clone.js            # Clone missing repos from the manifest
│   │   ├── repos.js            # repos list / add / remove
│   │   ├── pr.js               # Open pull requests via gh
│   │   ├── completion.js       # Completion scripts (bash/zsh/fish/pwsh)
│   │   └── complete.js         # Dynamic branch completion logic
│   ├── core/                   # Data-returning logic shared by CLI + MCP
│   │   ├── commit.js           # Linked commit across repos
│   │   ├── tidy.js             # Orphan scan & delete
│   │   ├── changes.js          # Change-Id lookup
│   │   └── pr.js               # Pull-request creation
│   ├── mcp/
│   │   └── server.js           # Dependency-free MCP server (stdio)
│   └── utils/
│       ├── config.js           # Config discovery, resolution & filtering
│       ├── git.js              # Git command execution & introspection
│       ├── editor.js           # Capture a commit message via $EDITOR
│       ├── link.js             # Change-Id generation & trailers
│       ├── concurrency.js      # Bounded parallel map
│       ├── match.js            # Glob matcher for protected branches
│       └── ui.js               # Shared CLI helpers
├── test/                       # node:test suites
└── scripts/postinstall.js
```

---

## 🧪 Development

```bash
npm test        # node --test
```

CI runs the suite on Node 18, 20, and 22.

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
