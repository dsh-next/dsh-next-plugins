# Checkpoints: inspection and rewind

Start with the [plugin README](<../packages/dsh-next-checkpoints/README.md>) for installation and a first rewind.

## Read a checkpoint

Checkpoints are saved at session start and at the end of each turn. The rail is
newest-first. Selecting a checkpoint shows the cumulative net file changes from
the session baseline to that point, not just changes from the preceding turn.
Selecting a row never restores files.

- The file list distinguishes `Created`, `Modified`, and `Deleted` text files.
  Deleted paths are struck through.
- Added/removed line counts and a five-block bar appear on each file and on the
  `Files` total.
- Select a file for a unified diff with line numbers, change-block headings, and
  syntax highlighting. The preview also shows its time and change counts.
- Binary files, files too large to preview, invalid UTF-8, symbolic links, and
  directories remain listed without a misleading text-file status pill.
- During a turn, the file list and counts update live. The latest row shows a
  spinner instead of `Rewind`; a rewind is refused while a turn is running.

## Understand what a rewind changes

**Back up work you want to keep before confirming.** A rewind can overwrite
later edits or remove files created after the chosen checkpoint. The confirmation
warns about edits outside the agent's tracked work and about a changed Git HEAD
(the checked-out commit).

Restoration writes saved file contents back to disk and opens a child session
whose conversation ends at that checkpoint. The previous session is archived.
Later checkpoints are removed from the new session's checkpoint generation, and
later messages are not sent to the model. If the old session owned a plugin
worktree, that ownership passes to the child session.

Choose `Session start` to undo the first turn's file changes too. Choosing the
checkpoint after turn 1 keeps those changes.

The confirmation can require an additional explicit `Restore this checkpoint`
action when the first confirmation is not enough. Read the current warnings;
dismissing the dialog leaves files untouched.

## Understand the limits

Checkpoints are **not a full workspace backup or a replacement for Git**.

- The list tracks this session's file work, including write/edit tools, rather
  than everything that would appear in `git status`.
- A shell move of a file created by the session can be followed by its content
  hash to the new path. This is not a promise to capture every shell operation.
- Files changed only by another session in the same folder are not listed.
- Rewind does not run `git reset`, `git revert`, or `git checkout`. Commits made
  during the session remain. Restored file contents can therefore appear in Git
  as unstaged changes against those commits.

For test and development procedures, see [Contributing](<../CONTRIBUTING.md>).
