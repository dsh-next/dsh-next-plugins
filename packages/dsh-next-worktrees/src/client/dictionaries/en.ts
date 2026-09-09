/**
 * English dictionary — the key source for this plugin's locale namespace.
 *
 * Repo contract: docs/i18n.md ("Plugin UI strings"). Every user-facing string
 * in the browser half is added here as a dotted key (English is the platform
 * fallback locale and this repo's language); zh.ts mirrors the key set and
 * the compiler enforces parity. Reference implementation:
 * packages/dsh-next-cc-plugins/src/client/dictionaries/.
 */

/** Locale namespace this plugin owns (also the slot label's namespace). */
export const NS = 'worktrees'

/** User-facing strings; the key set follows the UX spec's copy table. */
export const en = {
  'row.facts.branch': 'Branch',
  'row.facts.status': 'Status',
  'row.facts.sessions': '{count} sessions, same files',
  'row.facts.sessionOne': '1 session, same files',
  'status.clean': 'clean',
  'status.dirty': 'uncommitted changes',
  'status.ahead': '{count} ahead',
  'status.merged': 'merged',
  'status.conflict': 'conflict (merge in progress)',
  'row.refresh': 'Refresh',
  'row.update': 'Update from {branch}',
  'row.merge': 'Merge to {branch}',
  'row.mergeFallback': 'Merge',
  'row.delete': 'Delete worktree',
  'merge.confirm': 'Merge',
  'merge.resolve': 'Resolve in this session…',
  'update.confirm': 'Update from {branch}',
  'update.resolve': 'Resolve in this session',
  'merge.title': 'Merge worktree',
  'merge.summary': 'Merge {source} into {target}',
  'merge.ff': 'Fast-forward (no merge commit)',
  'merge.commit': 'Creates a merge commit',
  'merge.blocker.running': 'A session is running in this worktree. Stop it or wait for it to finish.',
  'merge.blocker.unknownSlug': 'This worktree is gone. Refresh and try again.',
  'merge.blocker.noTarget': 'The main checkout is not on a branch. Check out a branch to merge into.',
  'merge.blocker.noSource': 'This worktree is detached. Check out a branch in the worktree before merging.',
  'merge.blocker.dirtyPrimary': 'Uncommitted changes on {branch}. Merge may fail if git cannot proceed.',
  'merge.blocker.dirtyWorktree': 'Uncommitted changes on {branch}. They will not be merged; only commits on this branch will.',
  'blocker.dirtyFiles': 'Uncommitted files',
  'merge.blocker.alreadyMerged': 'This worktree is already merged into the current branch.',
  'merge.blocker.conflict': 'Merging would conflict. Resolve in this session first; then Merge is a fast-forward.',
  'merge.blocker.oldGit': 'git 2.38 or newer is required for one-click merge. Run {command} manually.',
  'merge.done.title': 'Merged into {target}',
  'merge.done.cleanup': 'Remove the worktree?',
  'merge.done.keep': 'Keep it',
  'merge.done.remove': 'Remove worktree',
  'update.title': 'Update from {branch}',
  'update.inProgressTitle': 'Merge in progress',
  'update.summary': 'Merge {source} into {target}',
  'update.ff': 'Fast-forward (no merge commit)',
  'update.commit': 'Creates a merge commit in the worktree',
  'update.wouldConflict': 'This will start a merge in the worktree. This session will resolve the conflicts and commit; then Merge into the main checkout is a fast-forward.',
  'update.handoff': 'A merge is in progress in this worktree. Resolve the conflicted files and commit, then Merge into the main checkout. Closing this dialog leaves the merge in progress.',
  'update.prompt': 'A merge of {source} into this branch is in progress. Resolve the conflicted files, commit the merge, and stop. Do not push. The plugin will then fast-forward the main checkout.',
  'update.done': 'Updated from {source}. Merge into the main checkout is now a fast-forward.',
  'update.ok': 'OK',
  'update.abort': 'Abort merge',
  'update.blocker.unknownSlug': 'This worktree is gone. Refresh and try again.',
  'update.blocker.noTarget': 'The main checkout is not on a branch. Check out a branch to update from.',
  'update.blocker.noSource': 'This worktree is detached. Check out a branch in the worktree before updating.',
  'update.blocker.noSession': 'This worktree has no bound session. Open or recreate the session first.',
  'update.blocker.running': 'A session is running in this worktree. Stop it or wait for it to finish.',
  'update.blocker.inProgress': 'A merge is already in progress in this worktree.',
  'update.blocker.dirtyWorktree': 'Uncommitted changes on {branch}. Commit them in the worktree session first.',
  'update.blocker.alreadyUpdated': 'This worktree already contains the current branch.',
  'delete.confirm.title': 'Delete worktree',
  'delete.confirm.body': 'The branch {branch} and the session log survive; the working copy is deleted.',
  'delete.confirm.dirty': 'This worktree has uncommitted changes.',
  'delete.confirm.ok': 'Remove worktree',
  'delete.confirm.force': 'Remove anyway',
  'delete.confirm.cancel': 'Cancel',
  'create.title': 'New worktree in {repo}',
  'create.name': 'Name',
  'create.nameHint': 'Lowercase letters, numbers, and hyphens. This is the folder name too.',
  'create.nameError.empty': 'Enter a folder name.',
  'create.nameError.too-long': 'Use at most 60 characters.',
  'create.nameError.format': 'Use lowercase letters, numbers, and hyphens (for example update-plugin).',
  'create.nameError.reserved': 'That name is reserved. Pick another.',
  'create.submit': 'Create',
  'create.working': 'Creating worktree…',
  'create.settingUp': 'Setting up worktree…',
  'create.error.title': 'Could not create the worktree',
  'create.error.hint': 'Nothing was changed; resolve the issue above and click again.',
  'create.setupFailed.title': 'Worktree created, but setup failed',
  'create.setupFailed.hint': 'The worktree and session are ready. Run the setup command in this session, or delete the worktree.',
  'create.setupFailed.disk': 'On disk the folder is {folder}. The name you typed ({title}) is the sidebar title.',
  'create.error.ok': 'OK',
  'create.cancel': 'Cancel',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en
