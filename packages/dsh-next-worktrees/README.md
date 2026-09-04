# worktrees

English | [中文](README.zh.md)

DeepSeek Harness plugin: isolated git worktrees for parallel agent sessions.
The "Isolated" toggle on a blank-session composer creates a git worktree and
starts the session inside it; a session-header chip shows branch, ahead
count, and status, with sibling navigation, copy actions, and safe removal.
Landing stays plain git — the plugin never commits to or merges into your
branches.

Sessions in a worktree run with full file access (the sandbox knob switches
to `danger-full-access` for that session only) because linked worktrees
store git metadata in the shared `.git` outside the worktree; approval
prompts stay on. Worktrees live under `<repo>/.dsh/worktrees/<slug>` on
branches `dsh-worktrees/<slug>`, based on `origin/HEAD` (local `HEAD`
fallback), and a `.worktreeinclude` file in the repo root lists extra
untracked files (for example `.env`) copied into each new worktree.

To land work from the main checkout:

```sh
git merge dsh-worktrees/<slug>
```

## Install

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-next-worktrees
```

## Development

```sh
pnpm build
pnpm typecheck
pnpm test
```
