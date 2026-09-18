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
3. Type a commit message — or press the sparkle in the message box to have one
   derived from the change list — then press **Commit** (or `Cmd`/`Ctrl` +
   `Enter` from the box). The chevron beside **Commit** offers the other
   commands: **Commit (Amend)** and **Commit All Changes**, which stages
   everything first.
4. Under **Changes**, click any row to read its diff. Hover a row for
   **Stage**, **Unstage** and **Discard**, or use the section header to stage,
   unstage or discard everything. The sections start folded: click a section
   title to unfold it, and click again to fold it away.
5. Under **Worktrees**, use the start-point button to choose what the new
   checkout gets: a fresh `dsh-git/<name>` branch from the base, or an existing
   branch, a remote branch or a tag. Press **Create** and it lands at
   `.worktrees/<name>` without leaving this repository. The button under it
   picks the **comparison base** every row is measured against, and the folder
   icon on a row opens a session in that checkout.
6. Under **History**, pick any commit's `⋯` menu to copy its hash, check it
   out, revert it, or cherry-pick it.

## Features

**Changes with real diffs.** Staged, unstaged and untracked files are listed
separately, with conflicts called out. Diffs render with the platform's own
diff primitive; a file past the size cap falls back to line counts plus a
copyable patch instead of a wall of text.

![The Changes section with staged and unstaged files](media/changes.webp)

![The commit commands behind the split button](media/commit-menu.webp)

**Guardrails by blast radius.** Staging, unstaging and committing act
immediately. Anything that can lose work — discard, delete a worktree, switch
or delete a branch, merge, check out a commit, revert, cherry-pick — asks
first, names the affected files, and refuses when git cannot do it safely
(dirty tree, operation in progress, detached HEAD).

**A recoverable state for the stuck cases.** A merge, rebase, cherry-pick or
revert in progress gets its own banner with **Continue** and **Abort**, so a
conflict is never a dead end.

![Merge conflict banner with Continue and Abort](media/conflict.webp)

**Worktrees you can reason about.** A row is named by the branch git reports —
an existing branch, a remote branch, a tag (detached), or a fresh
`dsh-git/<name>` branch started from the point you pick. Every row is measured
against **one visible comparison base** (the repository's default branch unless
you switch it), so "3 ahead" always says of what; rows carry the folder path,
clean or dirty, ahead, behind, merged, locked and prunable states. Each row can
open a session in that folder, update from the base, merge into the current
checkout, unlock, or be deleted, and a missing folder can be pruned. Worktrees
live at `.worktrees/<name>` inside the repository, hidden through
`.git/info/exclude` — never your committed `.gitignore`. `.worktrees.json`
runs create-time setup commands (for example `pnpm install`), and
`.worktreeinclude` copies the untracked files a checkout needs (`.env`, local
config).

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
The pane never goes blank either: a read in flight, a tab with no session, and
a render that failed each say what they are, and a failed render stays
contained and retryable instead of retiring the tab.

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
