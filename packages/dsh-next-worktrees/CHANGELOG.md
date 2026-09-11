# @dsh-next/dsh-next-worktrees

## 0.4.0

### Minor Changes

- Worktrees are now named folders of chats nested under the repo.
  
  The branch icon asks for a kebab-case folder name (`update-plugin`); Create stays off until the name is valid. That name is the sidebar title and the folder on disk. Git commands live on that folder menu; folder `+` starts another session on the same files. Session menus are stock again (`Rename` / `Fork` / `Archive`). `Delete worktree…` replaces stock `Delete workspace` on the folder.
  
  Setup commands such as `pnpm install` start as soon as the folder exists and run isolated from the harbor's npm/pnpm workspace, so a nested worktree is not treated as a missing package.
  
  Hovering a cluster swaps the branch icon for the expand chevron, same as a stock folder. Session titles line up with the cluster title.

### Patch Changes

- Fixed suggested worktree names colliding with existing folders or branches retained after deleting a worktree.
- Show the destination branch in the worktree menu's Merge action and remove trailing ellipses from Update, Merge, and Delete labels.
- Fixed worktree folders being automatically deleted when switching away from a never-started session. Worktrees now remain available until explicitly deleted.
- Fixed worktree setup, cleanup, branch tracking, and file-copy edge cases that could lose work or overwrite local files.
- Updated sidebar search navigation to reveal selected sessions, automatically opening collapsed worktree clusters and hidden session rows. Preserved workspace-loading safeguards from the stock sidebar.

## 0.3.0

### Minor Changes

- When a setup command such as `pnpm install` fails, the worktree and session stay. The error shows the command output so you can finish setup yourself or delete the worktree. ([@sitegroove](https://github.com/sitegroove))
- New worktrees now use a timestamped branch name (`willow-202606140222`, UTC). Creating after Delete no longer fails because the old branch is still there. ([@sitegroove](https://github.com/sitegroove))

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
