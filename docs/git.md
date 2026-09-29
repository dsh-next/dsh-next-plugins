# Source control: advanced tasks and safety

Start with the [Git plugin first-run guide](<../packages/dsh-next-git/README.md>)
for availability, requirements, installation, and your first commit. This guide
covers the `Source control` tab in Harness's right sidebar.

## Review and stage changes

- Expand `Changes` to see staged, unstaged, untracked, and conflicted files.
  Sections start folded; opening one closes the others. Click again to fold it.
- Click a file row to open its own preview tab. It uses the panel's branch glyph
  and the filesystem preview's chrome. Changed lines are tinted, with three
  context lines on each side; unchanged stretches fold behind dashed edges while
  preserving file line numbers.
- Use the toolbar to switch between changed lines and the whole file, wrap lines,
  reread the file, or stage/unstage hunks with `+`/`−`.
- Hover a file row for `Stage`, `Unstage`, or `Discard`; section-header actions
  apply to all files. Rows keep these actions rather than a separate diff button.
  Hover or focus icon-only controls for their labels throughout `Changes`,
  `Worktrees`, and `History`.
- Diffs use the platform's diff renderer. Oversized diffs fall back to line counts
  and a copyable patch. When a hunk cannot be represented exactly, explicitly
  choose a whole-file action instead.

![Changed file in its own tab with changed lines marked](<../packages/dsh-next-git/media/change-file.webp>)

## Commit or stash selected work

1. Stage the changes you want to commit. The `Changes` header's `Commit` and
   `Stash` buttons require a nonempty, conflict-free index (the staged changes).
   Hover a disabled button to read the reason.
2. Choose `Commit` and fill in `Commit message`: summary first, then an optional
   blank line and details. Press `Cmd`/`Ctrl` + `Enter` to commit.
3. Alternatively, choose `Stash` and optionally name the saved work. This saves
   staged and unstaged tracked changes; untracked files stay in place. Other
   stash modes are available in the repository menu.

Staging and unstaging apply immediately; submitting a commit does not add another
confirmation. The commit dialog's top-right sparkle drafts from staged changes
and replaces the entire message. Failed or cancelled drafts leave your text
unchanged. Read [AI sharing and drafting](<#ask-for-ai-help-and-configure-drafting>)
before using it.

![Commit dialog with one multiline message field](<../packages/dsh-next-git/media/commit-dialog.webp>)

![Stash dialog with an optional name field](<../packages/dsh-next-git/media/stash-dialog.webp>)

## Choose the branch for a session

- The header shows the current branch and its ahead/behind counts relative to its
  upstream. Click its name to search local branches, remote-tracking branches,
  and tags. Rows show the tip commit's author, short hash, subject, drift, and age;
  search by those details as well as by name.
- Choose a local branch to switch, or a remote-tracking branch to check out its
  local twin. If that twin is already the current branch, the action is a no-op.
- `Create new branch…` starts from HEAD (the current commit).
  `Create new branch from…` lets you choose a base. `Checkout detached…` opens
  the detached list. Selecting a tag also detaches HEAD: create a branch before
  making commits you want to retain.
- The `Sync` icon immediately before the branch name opens a review dialog.
  Clicking the shortcut alone does not pull or push.
- The message composer's branch chip uses the same picker. Choose or create a
  branch before your first message. Non-Git workspaces show no chip; a narrow
  composer shows only its glyph and chevron beside the other controls.

![Branch picker with grouped refs and tip-commit details](<../packages/dsh-next-git/media/branch-picker.webp>)

![Composer branch chip between permission and model controls](<../packages/dsh-next-git/media/composer-branch.webp>)

## Create and manage worktrees

A worktree is a separate working folder for the same repository. It lets you
work on another branch without switching the current checkout.

### Create a working folder

1. Expand `Worktrees`. Use the start-point button—the same ref picker as the
   header—to choose a fresh `dsh-git/<name>` branch from the base, an existing
   branch, a remote branch, or a tag (detached).
2. Enter a name and choose `Create`. The folder is created at
   `.worktrees/<name>` inside the repository.
3. If setup is declared, review the exact commands and paths before approving
   them. Nothing runs or is copied unless you select it for this creation.
4. Use the row's folder icon when you want to open a session in that checkout.

Worktree folders are hidden through `.git/info/exclude`, not the committed
`.gitignore`. A successful panel-created worktree is registered in the left
workspace sidebar without opening or switching sessions. Discovery or refresh
does not register existing worktrees automatically; use their folder icon.

### Approve setup and local-file copying

- `.worktrees.json` declares create-time setup commands, such as `pnpm install`.
  Approved commands run project code with your account: review them first.
- `.worktreeinclude` declares untracked files to copy, such as `.env` or local
  configuration. Review sensitive files before copying them.
- Command execution and file copying are separate, per-create approvals; neither
  happens automatically. Copying never follows symbolic links or replaces an
  existing file.

### Compare, update, merge, or delete

- The visible `Base` control sets one comparison base for every row; it defaults
  to the repository's default branch. Ahead/behind counts are measured against
  this base, not an unspecified branch.
- Rows use the branch reported by Git and show the folder, clean/dirty status,
  ahead/behind counts, merged status, locks, and whether the folder is missing
  and prunable.
- Use row actions to update from the base, merge into the current checkout,
  unlock, or delete. Hover or focus the merge icon to check its destination.
  Prune an entry when its folder is missing.
- Deleting removes the worktree folder. Review unmerged work and the confirmation;
  guardrails are not a backup or a guarantee against data loss.
- After Git successfully deletes a worktree through the panel, its matching
  sidebar workspace entry is removed. Saved sessions are retained.

![Worktrees with clean, dirty, and merged states](<../packages/dsh-next-git/media/worktrees.webp>)

## Inspect, compare, or rewrite history

1. Expand `History` to load recent commits for the current checkout, newest first,
   in a bounded-depth graph. Rows show subject, short hash, author, and refs.
2. Click commits to select or deselect them; modifier keys are not required.
3. Choose a toolbar command and review its dedicated dialog before applying it.
   Disabled commands explain why on hover.

Use `Load more` for older commits and the header's branch picker to change
branches. Each row's `Check out commit` icon appears on hover or keyboard focus
and stays visible on touch devices; checking out a commit detaches HEAD.

### Choose a history command

- `Inspect` shows a commit's changed files beside the selected file's diff, using
  the same renderer as `Changes`. With several commits selected, choose which
  commit to inspect inside the dialog.
- `Compare` shows a file-by-file diff between two selected commits.
- `Squash` and `Reword` prefill `Summary` and `Description` from the full commit
  messages. Their sparkle drafts from selected commits, not staged changes.
  One click replaces both fields without another dialog or confirmation; review
  and edit the result before applying the history operation.
- `Fixup`, `Reorder`, `Cherry-pick`, and `Revert` show compact commit lists and
  one action. `Reorder` also provides move controls.

Errors appear with details in a red-bordered section, without a `Retry` button
or routine implementation details crowding the dialog.

### Check history safety requirements

- Rewrites are planned, previewed, and journaled. They refuse merge commits,
  non-contiguous selections, and other topologies they cannot replay exactly.
- Potentially shared history requires explicit acknowledgment. Rewrites change
  descendant commit IDs; nothing is pushed automatically.
- `Squash`, `Fixup`, and `Reword` rewrite history without checking out files.
  Staged, unstaged, and untracked work stays untouched; no stash is needed.
  Authors and dates are preserved, but old commit signatures are removed.
- `Reorder`, `Cherry-pick`, `Revert`, and `Restore backup…` require a fully clean
  checkout. All history commands refuse an active Git operation.
- Do not run another history edit or switch branches while a command is running.

### Recover a stopped operation

- The history dialog offers `Continue`, `Skip commit…`, `Abort…`, and
  `Restore backup…` as appropriate. Review recovery confirmations before acting.
- Skipping omits that commit's changes; aborting can discard resolution edits.
  Restoring a backup returns the current branch to its recorded history and
  requires a clean checkout.
- Resolve conflicts before continuing. For a native Git operation not owned by
  the history dialog, use the panel's operation banner.

The commit list loads only when `History` opens and refreshes only while visible.
Returning from a diff reloads an open `History` section. Other visible panel data
refreshes on open, window focus, and after an agent turn.

![History section with commit rows and actions](<../packages/dsh-next-git/media/history.webp>)

## Resolve conflicts and continue an operation

1. Open a conflicted file to view base, current, incoming, and result side by side.
2. Choose content per hunk or edit the result. Choose `Save result` to write it.
3. Review the saved result, then explicitly choose `Mark resolved` to stage it.
4. Use the merge, rebase, cherry-pick, or revert banner to `Continue`,
   `Skip this step` (when supported, after confirmation), or `Abort`.

Drafts survive repository changes; marking resolved stages only what you saved.
The editor honors Git's `conflict-marker-size` attribute. It refuses workflows
it cannot represent faithfully—custom `working-tree-encoding`, Git filters,
submodules, or oversized blobs—and explains why instead of silently rewriting
those files. Use an external tool for unsupported cases.

![Merge conflict banner with Continue and Abort](<../packages/dsh-next-git/media/conflict.webp>)

## Ask for AI help and configure drafting

AI actions send repository content to the selected model provider and may incur
provider charges. Check for secrets before sending: filename-based exclusions
are not a complete security check.

### Send a task to an agent session

- `Review changes`, `Explain diff`, `Draft commit message`, and conflict-resolution
  actions let you choose `Current session` or `New session`.
- Review the file list, checkout, branch, and exact prompt before sending.
  Sensitive-looking filenames are excluded unless you select them.
- File-based prompts have a size budget and identify omitted content. A finished
  draft can be adopted only while its repository context remains current.

### Generate a message in place

The sparkle buttons in `Commit`, `Squash`, and `Reword` generate text directly,
without starting an agent turn. They send staged diffs or selected commit patches
to the drafting model; do not assume the file-selection exclusions above apply.
A successful draft replaces the existing message; review it before committing
or rewriting history.

### Set the model and writing style

1. Open `Plugins`, select `Git`, and choose `Drafting model`.
2. Leave `Default (session model)` to follow the source session's selection,
   falling back to Harness's default when none is selected. This does not change
   the chat model.
3. Optionally enter up to 4,000 characters in `Commit message instructions`.
   For example: “Use Conventional Commits. Keep the subject under 72 characters.”
4. Choose `Save`. Clear the field and save to restore the default style.

Preferences apply to `Commit`, `Reword`, and `Squash`. They supplement built-in
grounding and safety rules; they do not affect other agent actions.

![Git drafting model and message-instruction settings](<../packages/dsh-next-git/media/drafting-settings.webp>)

## Use repository actions

Open the three-dot menu at the end of the header. Top-level shortcuts are `Pull`,
`Push`, `Fetch`, and `Stash`; nested groups cover additional tasks:

- `Commit`: staged/all commits, amend, sign-off, undo the last commit, and abort
  a rebase.
- `Changes`: stage, unstage, or discard all changes.
- `Pull, push`: sync, pull (including rebase), choose a remote, normal or
  force-with-lease push, fetch/prune, and fetch all remotes.
- `Branches`: merge, rebase, create from a start point, rename, delete local or
  remote branches, and publish.
- `Remote`: add or remove a remote.
- `Stash`: save tracked, untracked, or staged work; apply or pop selected/latest
  stashes; drop one/all; inspect a patch.
- `Tags`: create lightweight or annotated tags, delete local or remote tags,
  and push tags.
- `Worktrees`: create or manage checkouts through the existing controls.

Each command opens a compact dialog with labels above aligned fields and one
action button, without tabs, a repository heading, or a `Refresh`/`Cancel` footer.
Close with × or `Escape`; reopening reads fresh choices.

### Review destructive and network actions

- `Discard` cannot be undone, and untracked files are deleted from disk.
  Commands such as discard, worktree deletion, branch switching/deletion,
  merge, and commit checkout ask for confirmation or preflight review where
  required and refuse unsafe states. Dirty-tree, active-operation, and
  detached-HEAD restrictions depend on the command.
- Confirmations and affected-path lists help you review changes; they do not
  make every operation lossless. Back up work you cannot afford to lose.
- Force push uses an explicit lease and refuses a changed remote tip.
- Normal pull/sync is fast-forward only; choose `Pull (rebase)` for diverged
  history.
- Undoing the last commit keeps its changes staged.
- Popping a stash removes it only after successful application; conflicts keep
  the stash. Applying a stash keeps the entry.
- `Show Git output` displays bounded command-result summaries, not raw output
  that might contain credentials.
- Executable filters, custom merge drivers, and unusual stash-reference storage
  may require the terminal; the plugin does not bypass its safety checks.

![Repository menu with Branches submenu](<../packages/dsh-next-git/media/repository-menu.webp>)

![Compact Rename branch dialog with aligned fields](<../packages/dsh-next-git/media/repository-rename.webp>)

## Troubleshoot a missing or blocked panel

- **Git missing or too old:** install Git 2.31+ on `PATH`, then reload.
- **Not a repository:** open a session inside a Git working folder. For a bare
  repository, add a working folder and open the session there.
- **Permission denied:** check repository directory permissions.
- **Commit identity missing:** configure `user.name` and `user.email` in Git,
  then refresh.
- **Another Git process holds `index.lock`:** plugin mutations serialize per
  repository, and lock collisions retry automatically. The session's agent may
  also be using Git in the same repository; avoid competing writes.
- **Restored tab says the session is not open:** after a Harness restart, the
  tab can appear before its session loads. Open that session again. The panel
  retries in the background and recovers when the session is available; this
  state does not mean the folder is not a repository.
- **No session, a pending read, or a failed render:** the panel names the state
  rather than going blank. Render failures remain contained and retryable
  instead of retiring the tab.

For local development, see the [contributor guide](<../CONTRIBUTING.md>).
