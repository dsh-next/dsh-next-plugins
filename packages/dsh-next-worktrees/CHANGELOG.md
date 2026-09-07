# @dsh-next/dsh-next-worktrees

## 0.2.1

### Patch Changes

- The branch icon now spins while a new worktree session is being created, so a slow git checkout or setup command is visible instead of looking stuck.
- A new worktree session now appears in the sidebar immediately. Setup commands from `.worktrees.json` run afterward, with the row's branch icon spinning until they finish.

## 0.2.0

### Minor Changes

- Added a self-only `reclaim` so a session can hand its worktree claim to a new session in the same folder without dropping the one-writer lock.

## 0.1.1

### Patch Changes

- Merge lists uncommitted files as a warning (naming the branch they sit on) and still lets you Merge. Git will refuse if the main folder's files would be overwritten. Uncommitted worktree files are not included. Update still blocks on a dirty worktree.
- Clarified in the README when to commit a `.worktreeinclude` file (copy gitignored local files such as `.env` into new worktrees) and when to use setup commands instead.

## 0.1.0

### Minor Changes

- Initial release. Nested git worktrees in the DeepSeek Harness sidebar: isolate parallel agent sessions on one repository, optionally run setup from `.worktrees.json`, catch up with Update from the current branch, and land with a guarded one-click merge. When a merge would conflict, Resolve in this session lets the bound agent fix files in the worktree first; Abort merge undoes that in-progress merge without touching the main folder.
