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
   everything first. Every AI action first asks where the work should happen:
   **this session** or a **new session**, and the payload is shown before it is
   sent.
4. Under **Changes**, click any row to read its diff. Hover a row for
   **Stage**, **Unstage** and **Discard**, or use the section header to stage,
   unstage or discard everything. The sections start folded: click a section
   title to unfold it, and click again to fold it away.
5. Under **Worktrees**, use the start-point button to choose what the new
   checkout gets: a fresh `dsh-git/<name>` branch from the base, or an existing
   branch, a remote branch or a tag. Press **Create** and it lands at
   `.worktrees/<name>` without leaving this repository. If the project
   declares create-time work, a confirmation lists the exact commands and
   paths and asks for each of them separately; nothing runs and nothing is
   copied unless you tick it. The button under it picks the **comparison base**
   every row is measured against, and the folder icon on a row opens a session
   in that checkout.
6. Under **History**, tick commits to plan an operation: **squash**,
   **fixup**, **reorder**, **reword**, **cherry-pick** or **revert**. The plan
   is previewed, published history is called out, and every rewrite keeps a
   backup ref and a journal you can return to. The `⋯` menu on one commit
   still offers copy hash, check out, revert and cherry-pick.
7. Conflicted files open the conflict editor: base, current and incoming side
   by side with the result, per-hunk choices, **Save**, then an explicit
   **Mark resolved**. A stopped merge, rebase, cherry-pick or revert is a
   banner with **Continue**, **Skip this step** and **Abort**.

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
revert in progress gets its own banner with **Continue**, **Skip this step**
(for anything with a skippable step, after a confirmation) and **Abort**, so a
conflict is never a dead end. Conflicted paths open a real conflict editor:
the base, current and incoming versions next to the result, per-hunk choices,
a draft that survives a repository change, and a separate **Mark resolved**
that stages only what you saved. Git's own `conflict-marker-size` attribute is
honored, and workflows the raw editor cannot represent (custom
`working-tree-encoding`, Git filters, submodules, oversized blobs) are refused
with the reason instead of being silently rewritten.

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

**History you can act on.** A bounded-depth graph column with search, author
and date filters, multi-select (click, `Shift`+click, keyboard), and
**squash**, **fixup**, **reorder**, **reword**, **cherry-pick** and **revert**
planned from the selection. A plan is previewed before it runs; rewrites refuse
topologies they cannot replay exactly, require an explicit acknowledgment when
the history is published, and keep a journal plus `refs/dsh/history-backups/*`
so a completed or interrupted operation can be continued, skipped, aborted or
restored from the History section. Refresh re-reads on open, on window focus,
and when the agent finishes a turn.

![History section with the commit action menu](media/history.webp)

**The agent as a collaborator.** Review changes, Explain diff, Draft commit
message, Resolve, and the history and conflict actions all open the same
chooser first: send to **this session** or start a **new session**, with the
file list (or commit count), the checkout and branch, and the exact prompt
shown before anything is submitted. Sensitive-looking files are left out unless
you tick them, the payload is truncated to the prompt budget and always names
how much was left out, and a finished answer is offered back as a commit
message only when the repository has not moved since it was asked.

**Repository actions.** A workspace for the operations that are not a working
tree edit: fetch (with prune), push of the current branch, stash save and
apply, and create, rename or delete a branch. Each one previews what it will do
and what it will fetch, push or drop first; a non-fast-forward push or an
unmerged branch delete needs a second, explicit confirmation.

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
- You can stage or unstage individual hunks from a file's diff, and fall back
  to the whole file when a hunk cannot be represented exactly.
- History rewrites (squash, fixup, reorder, reword) are planned, previewed and
  journaled, and refuse merge commits, non-contiguous selections and other
  topologies they cannot replay exactly. A published-history rewrite needs an
  explicit acknowledgment; nothing is pushed for you.
- Setup commands and copied files are per-create decisions. The plugin never
  runs `.worktrees.json` or copies `.worktreeinclude` on its own, and a copy
  never follows a symbolic link or replaces a file that is already there.
- Worktree sessions: scope inheritance for skills and Claude plugins is not
  part of this plugin.
- Contributors: see [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md).
