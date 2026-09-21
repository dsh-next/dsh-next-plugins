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
   upstream you are. Click the branch name for the **checkout picker** — a
   filter over every branch, remote-tracking branch and tag, with each row
   showing its tip commit's author, hash and subject, its drift and its age.
   Pick a branch to switch, a remote-tracking branch to check out its local
   twin, or a tag to detach. The picker's first rows create a branch — from the
   current HEAD or from a ref you choose — or open the detached list. The
   `Sync` icon immediately before the branch name opens the existing Sync
   dialog for review and confirmation; clicking the shortcut alone does not
   pull or push. The composer at the bottom carries the same branch in its
   control row, so a session can start on the branch you mean to work on.
3. Stage something, then press **Commit** or **Stash** in the **Changes**
   header — both stay disabled until the index has work, and each opens its own
   small dialog. **Commit** has one multiline `Commit message` box: put the
   summary on the first line, then optional details after a blank line. The
   sparkle inside its top-right corner drafts from staged changes and replaces
   the entire message. Failed or cancelled drafts leave your text unchanged.
   Press `Cmd`/`Ctrl` + `Enter` to commit. **Stash** takes a name.
4. Under **Changes**, click any row to read its diff. Hover a row for
   **Stage**, **Unstage** and **Discard**, or use the section header to stage,
   unstage or discard everything. The sections start folded: click a section
   header to unfold it and close the other sections; click again to fold it away.
5. Under **Worktrees**, use the start-point button to choose what the new
   checkout gets: a fresh `dsh-git/<name>` branch from the base, or an existing
   branch, a remote branch or a tag — the same picker the header's branch name
   opens, with the same filtered, detailed rows. Press **Create** and it lands at
   `.worktrees/<name>` without leaving this repository. If the project
   declares create-time work, a confirmation lists the exact commands and
   paths and asks for each of them separately; nothing runs and nothing is
   copied unless you tick it. The button under it picks the **comparison base**
   every row is measured against, and the folder icon on a row opens a session
   in that checkout.
6. Under **History**, browse recent commits of the current checkout. Click commits
   to select them (no modifier keys), then pick one command from the toolbar:
   **Inspect**, **Compare**, **Squash**, **Fixup**, **Reorder**, **Reword**,
   **Cherry-pick** or **Revert**. Each one opens its own small modal that shows
   exactly what it will do before its button is pressed. A `Check out commit`
   icon sits on every row. Use `Load more` for older commits and the
   branch picker in the sidebar header to switch branches.
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

Clicking a changed file opens it in a tab of its own, marked with the same branch
glyph as the panel and using the same chrome the filesystem preview uses. It opens on the changes: each changed line is tinted and
marked with three lines of context around it, and the unchanged stretches between
them are folded away behind a dashed edge, so the file's own line numbers still
read true. The toolbar has a toggle between that and the whole file, a wrap
toggle, **Refresh** (read the file again), and a `+`/`−` action that stages or
unstages the file's hunks in place. File rows keep only stage/unstage and discard
actions; review the changes by clicking the row to open its preview tab.

![A changed file in its own tab with the changed lines marked](media/change-file.webp)

![The Commit dialog with one multiline message field](media/commit-dialog.webp)

![The Stash dialog with a name field](media/stash-dialog.webp)

**One ref picker for every checkout.** The header's branch name opens a search
field over grouped refs rather than a dropdown: local branches, remote-tracking
branches and tags, each row carrying its tip commit's author, short hash and
subject next to the branch's drift and age. Typing filters on any of those, so a
branch is found by name, by what it last changed or by its commit hash. The
quick actions create a branch (from HEAD or from a picked base) or open the
detached list; picking a tag detaches, and picking a remote-tracking branch
whose local twin is already checked out is a no-op instead of an error. The
worktree start-point button uses the same picker.

![The branch picker with grouped refs and tip-commit detail](media/branch-picker.webp)

**The branch where a session starts.** The composer's control row carries the
session's branch beside the attach, permission and model controls. It is the
same chip and the same picker as the panel header, so a branch is chosen — or
created — before the first message, and a new session never silently starts on
the wrong one. A workspace that is not a git repository shows nothing there at
all: the chip is an addition to the composer, never a state of it. On a narrow
composer it keeps only its glyph and chevron, the way the access selector
beside it does.

![The composer's branch chip between the permission and model controls](media/composer-branch.webp)

**Two writes in the Changes header.** **Commit** and **Stash** sit beside the
header's staging actions and stay disabled until the index has something staged,
so neither can run against an empty index or a conflicted one; hovering a
disabled button says why. The commit dialog takes one multiline message — the
summary line, then optional details, the way git reads them — and the stash
dialog names what it saves.

**Guardrails by blast radius.** Staging, unstaging and committing act
immediately. Anything that can lose work — discard, delete a worktree, switch
or delete a branch, merge, check out a commit — asks
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
config). A worktree successfully created through this panel is also registered
in the left workspace sidebar, without opening a session or switching your current
one. Existing worktrees are not automatically registered on discovery or refresh;
use their folder icon when you want to open them. Deleting a worktree through the
panel also removes its matching sidebar workspace entry after Git succeeds;
saved sessions are retained.

![The Worktrees section with clean, dirty and merged worktrees](media/worktrees.webp)

**History you can act on, one command at a time.** Recent commits from the
current checkout in a bounded-depth graph column, newest first. Each row shows
the subject, the short hash, the author and any refs; a `Check out commit` icon
reveals on hover or keyboard focus and stays visible on
touch devices. Clicking commits builds a selection, and every command gets its
own small modal rather than one crowded workspace:

- **Inspect** shows one commit: its changed files beside the selected file's
  diff, rendered with the same diff primitive as the Changes section. Selecting
  several commits adds a picker for which one to read.
- **Compare** shows one file-by-file diff between two selected commits.
- **Squash** and **Reword** have **Summary** and **Description** fields,
  prefilled from the full commit messages. The sparkle drafts a message from
  those selected commits, not from staged changes. One click replaces both fields
  directly, without a second dialog or confirmation. Review the editable result
  before applying the history operation.
- **Fixup**, **Reorder**, **Cherry-pick** and **Revert** show compact commit
  lists and one action; `Reorder` also has move controls. A short acknowledgment
  protects potentially shared history. Errors show their details in a red-bordered section without a Retry button;
  routine implementation details do not fill the dialog.

Commands that cannot run on the current selection are disabled with the reason
on hover. A stopped operation stays recoverable from the same modal with
**Continue**, **Skip**, **Abort** and **Restore backup**. The commit list loads
only when the History accordion opens and is re-read only while that section is
visible; returning from a diff reloads an open History section. Other visible
panel data still refreshes on open, window focus and after an agent turn.

![History section with commit rows and their actions](media/history.webp)

**The agent as a collaborator.** Review changes, Explain diff, Draft commit
message and Resolve ask you to choose **this session** or a **new session**,
with the file list, checkout, branch and exact prompt available before sending.
Sensitive-looking files are left out unless you tick them. These file-based
prompts have a size budget and name omitted content; a finished draft can be
used only if the repository has not moved. The sparkle buttons inside Commit,
Squash and Reword instead generate text directly, without starting an agent turn.

**Drafting model.** Open **Plugins**, select `next-git`, and choose a `Drafting model`.
`Default (session model)` follows the source session's selection, falling back to
Harness's default when none is selected. This setting does not change the chat model.
Below it, `Commit message instructions` accepts optional writing preferences for
Commit, Reword and Squash (up to 4,000 characters). For example: “Use Conventional
Commits. Keep the subject under 72 characters.” Click `Save` to apply them; clear
the field and save to restore the default style. These preferences supplement
the built-in grounding and safety rules and do not affect other agent actions.

![Git drafting model setting](media/drafting-settings.webp)

**Repository actions.** Click the three dots that close the header row for a nested menu:

- `Commit`: staged/all commits, amend, sign-off, undo the last commit, or abort a rebase.
- `Changes`: stage, unstage or discard all changes.
- `Pull, push`: sync, pull (including rebase), choose a remote, normal or force-with-lease push, fetch/prune, and fetch all remotes.
- `Branches`: merge, rebase, create from a starting point, rename, delete local/remote branches, and publish.
- `Remote`: add or remove a remote.
- `Stash`: tracked/untracked/staged saves, apply or pop a selected/latest stash, drop one/all, and inspect its patch.
- `Tags`: create lightweight or annotated tags, delete local/remote tags, and push tags.
- `Worktrees`: create or manage checkouts using the existing Worktrees controls.

The top-level shortcuts are `Pull`, `Push`, `Fetch` and `Stash`.
Pick a command to open a small dialog with labels above aligned fields and one
compact action button — no tabs, repository heading, or Refresh/Cancel footer.
Close with the × or Escape; reopening reads fresh choices. Destructive commands
require review; force push uses an explicit lease and refuses a changed remote tip.
Normal pull/sync fast-forward only; choose `Pull (rebase)` for diverged history.
Undo keeps the removed commit's changes staged. Pop removes its stash only after
successful application, keeping it when conflicts occur.
`Show Git output` displays bounded command-result summaries, not raw credential-bearing
Git output. Executable filters/custom merge drivers and unusual stash reference storage
may require the terminal rather than bypassing the plugin's safety checks.

![Repository dropdown with the Branches submenu](media/repository-menu.webp)

![Compact Rename branch dialog with aligned fields](media/repository-rename.webp)

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
- A tab restored after the harness restarts can open before its session is
  loaded again. Source control keeps reading in the background and recovers on
  its own once that session is open; while it waits it says the session is not
  open yet instead of claiming the folder is not a repository.
- You can stage or unstage individual hunks from a file's diff, and fall back
  to the whole file when a hunk cannot be represented exactly.
- History rewrites are planned, previewed and journaled, and refuse merge
  commits, non-contiguous selections and other topologies they cannot replay
  exactly. A published-history rewrite needs an explicit acknowledgment, and
  nothing is ever pushed for you.
- **Squash**, **Fixup** and **Reword** keep your staged, unstaged and untracked
  work untouched; no stash is needed. They rewrite commit history without
  checking out files. Authors and dates are preserved; old commit signatures
  are removed. Descendants receive new commit IDs, and nothing is pushed.
- **Reorder**, **Cherry-pick**, **Revert** and **Restore backup** still require
  a fully clean checkout. All history commands refuse an active Git operation.
  Do not run another history edit or switch branches while a command is running.
- Setup commands and copied files are per-create decisions. The plugin never
  runs `.worktrees.json` or copies `.worktreeinclude` on its own, and a copy
  never follows a symbolic link or replaces a file that is already there.
- Worktree sessions: scope inheritance for skills and Claude plugins is not
  part of this plugin.
- Contributors: see [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md).
