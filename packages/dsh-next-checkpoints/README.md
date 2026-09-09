# checkpoints

English | [中文](README.zh.md)

This DeepSeek Harness plugin restores a session to a known-good moment:
working-tree files and model-visible history together. Review the work in the
`Checkpoints` tab next to Chat and Trajectory. Click a checkpoint to inspect the
cumulative file diff. Click `Rewind`, then confirm, to restore. Selecting a
row never restores.

## How to use it

1. Work as usual. A `Session start` checkpoint is saved when the session
   begins, and another at the end of each turn.
2. Open the `Checkpoints` tab. The checkpoint rail is on the right; newest
   checkpoints sit at the top, ordered by descending timestamp.
3. Click a row to inspect every file changed **up to** that checkpoint
   (net vs the session baseline, then click a file for a GitHub-style unified preview with language highlighting).
4. Click `Rewind` on that row. Read the confirm modal (later turns, dirty
   paths, HEAD moved). Confirm to restore.
5. To undo the first turn's files, rewind `Session start` — rewind to
   `turn 1` keeps that turn's writes. After rewind, later checkpoints drop
   off this generation and Chat opens a truncated session without later
   turns. The previous session is archived.

## Features

### Checkpoints tab

A checkpoint rail plus a file list. Each row shows a `Created`, `Deleted`, or
`Modified` pill, GitHub-style `+N`/`-N` counts with a five-block bar, and a
struck-through path for deletes. The `Files` header shows the checkpoint total
in the same format. While a turn is running, the latest row replaces `Rewind`
with a spinner and the file list plus line counts update live. Click a file to
open a GitHub-style unified preview (line numbers, hunk headers, language
highlighting); the preview header repeats the file time and `+N`/`-N` bar next
to `Close`. Binary, too-large, invalid UTF-8, symlink, and directory paths get
a row without a status pill, not a fake create.

### One checkpoint, files and history

Rewind writes the snapshot back to disk, then forks a child session whose
log ends at that checkpoint so Chat no longer shows later turns. It does
not run `git reset`, `git revert`, or `git checkout`. Commits made during
the session stay. The previous session is archived. If it was bound to a
plugin worktree, that claim moves onto the child so it stays a worktree
session.

### Honest warnings

The confirm modal warns when non-agent dirty paths would be overwritten, and
when HEAD has moved since the checkpoint.

## Install

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-checkpoints
```

`<name>` is your DSH profile (for example `web`). Reload the profile after
adding the plugin.

## Good to know

- Needs DeepSeek Harness `0.1.2-rc.1` or newer.
- Checkpoints are not git. The file list is this session's touched paths
  (write/edit tools), not `git status`. A bash `mv` of a file this session
  created is followed by content hash, so it still shows at the new path.
  Files another session changes in the same folder are not listed. After
  rewind, `git status` may look like later commits were undone as unstaged
  changes — that is the honest state.
- Refuse rewind while a turn is still running.
- Contributors: see [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md).
