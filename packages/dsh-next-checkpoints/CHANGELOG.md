# @dsh-next/dsh-next-checkpoints

## 0.2.1

### Patch Changes

- Show checkpoints newest-first, with the latest timestamp at the top of the list.

## 0.2.0

### Minor Changes

- File rows in the Checkpoints tab now show Created, Deleted, and Modified pills, strike through deleted paths, and GitHub-style +N/−N counts with a five-block bar. Binary, symlink, and other special rows have no status pill. The Files header totals the selected checkpoint; the file preview header shows the file time and the same bar next to Close. ([@sitegroove](https://github.com/sitegroove))
  
  While a turn is running, the latest checkpoint row shows a spinner instead of Rewind, and the file list plus line counts update live. Stopping the turn commits that snapshot so Rewind works again.
  
  The file list is this session's touched paths, not git status. A bash move of a file this session created is followed by content hash, so it still appears at the new path.

## 0.1.0

### Minor Changes

- Added a Checkpoints tab that records files and chat together each turn. Selecting a row inspects the net diff from session start; Rewind restores those files, opens a truncated session at that moment, and archives the previous one.
