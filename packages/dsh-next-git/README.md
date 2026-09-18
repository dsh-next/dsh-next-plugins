# Source control for DeepSeek Harness

English | [中文](README.zh.md)

This DeepSeek Harness plugin adds a native **Source control** tab to the right
sidebar: your working-tree changes, diffs, history, branches and git worktrees
in one place, with the agent as a first-class git collaborator. You never have
to leave the GUI for the everyday git loop.

## How to use it

1. Open the Start guide in the right sidebar (the compass tab) and pick
   **Source control**. The tab opens in its place.
2. The header shows the branch you are on and how far ahead or behind its
   upstream you are. Click the branch name to switch branches.
3. Under **Changes**, click any row to read its diff. Hover a row for
   **Stage**, **Unstage** and **Discard**.
4. Type a commit message — or press **Draft message** to have one derived from
   the change list — then press **Commit**.
5. Under **Worktrees**, name a worktree and press **Create** to get a fresh
   checkout at `.worktrees/<name>` on branch `dsh-git/<name>`, without leaving
   this repository.
6. Under **History**, pick any commit's `⋯` menu to copy its hash, check it
   out, revert it, or cherry-pick it.

## Features

**Changes with real diffs.** Staged, unstaged and untracked files are listed
separately, with conflicts called out. Diffs render with the platform's own
diff primitive; a file past the size cap falls back to line counts plus a
copyable patch instead of a wall of text.

![The Changes section with staged and unstaged files](media/changes.webp)

**Guardrails by blast radius.** Staging, unstaging and committing act
immediately. Anything that can lose work — discard, delete a worktree, switch
or delete a branch, merge, check out a commit, revert, cherry-pick — asks
first, names the affected files, and refuses when git cannot do it safely
(dirty tree, operation in progress, detached HEAD).

**A recoverable state for the stuck cases.** A merge, rebase, cherry-pick or
revert in progress gets its own banner with **Continue** and **Abort**, so a
conflict is never a dead end.

![Merge conflict banner with Continue and Abort](media/conflict.webp)

**Worktrees where the agent expects them.** Worktrees live at
`.worktrees/<name>` inside the repository on branch `dsh-git/<name>`, and the
directory is hidden through `.git/info/exclude` — never your committed
`.gitignore`. `.worktrees.json` runs create-time setup commands (for example
`pnpm install`), and `.worktreeinclude` copies the untracked files a checkout
needs (`.env`, local config). Each row shows whether the worktree is clean,
how far ahead it is, and whether it is already merged.

![The Worktrees section with clean, dirty and merged worktrees](media/worktrees.webp)

**History you can act on.** A bounded-depth graph column, per-commit actions
(copy hash, check out, revert, cherry-pick), and a Refresh that re-reads on
open, on window focus, and when the agent finishes a turn.

![History section with the commit action menu](media/history.webp)

**The agent as a collaborator.** Review changes, Explain diff, Draft commit
message, and Resolve in this session send the change set to the current
session — file list, counts, and the diff itself, truncated to fit the prompt
budget and always naming how much was left out.

**Honest failure states.** No git on PATH, git too old, not a repository, a
bare repository, permission denied, a missing commit identity, or another git
process holding `index.lock` each get a named state and the fix, instead of a
stderr dump. The session's own agent runs git in the same repository, so
mutations serialize per repository and lock collisions retry automatically.

## Install

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-git
```

`<name>` is your DSH profile (for example `web`).

## Good to know

- Requires git 2.31 or newer. Without git, or outside a repository, the tab
  explains what to do rather than failing to open.
- Whole files are the staging unit; there is no per-hunk staging.
- Rebase, cherry-pick series, and anything that rewrites history are never
  one-click — the panel offers the non-rewriting set only.
- Worktree sessions: scope inheritance for skills and Claude plugins is not
  part of this plugin.
- Contributors: see [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md).
