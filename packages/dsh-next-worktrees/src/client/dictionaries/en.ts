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
  'row.facts.base': 'Base',
  'row.facts.path': 'Path',
  'row.facts.status': 'Status',
  'status.clean': 'clean',
  'status.dirty': 'uncommitted changes',
  'status.ahead': '{count} ahead',
  'status.merged': 'merged',
  'row.refresh': 'Refresh',
  'row.merge': 'Merge…',
  'row.delete': 'Delete worktree…',
  'row.newSession.aria': 'New session in this worktree',
  'merge.title': 'Merge worktree',
  'merge.summary': 'Merge {source} into {target}',
  'merge.ff': 'Fast-forward (no merge commit)',
  'merge.commit': 'Creates a merge commit',
  'merge.blocker.dirtyPrimary': 'The main checkout has uncommitted changes. Commit or stash them first.',
  'merge.blocker.dirtyWorktree': 'The worktree has uncommitted changes. Commit them in the worktree session first.',
  'merge.blocker.running': 'A session is running in this worktree. Stop it or wait for it to finish.',
  'merge.blocker.conflict': 'Merging would conflict. Resolve manually: {command}',
  'merge.blocker.oldGit': 'git 2.38 or newer is required for one-click merge. Run {command} manually.',
  'merge.done.title': 'Merged into {target}',
  'merge.done.cleanup': 'Remove the worktree?',
  'merge.done.keep': 'Keep it',
  'merge.done.remove': 'Remove worktree',
  'delete.confirm.title': 'Delete worktree',
  'delete.confirm.body': 'The branch {branch} and the session log survive; the working copy is deleted.',
  'delete.confirm.dirty': 'This worktree has uncommitted changes.',
  'delete.confirm.ok': 'Remove worktree',
  'delete.confirm.force': 'Remove anyway',
  'delete.confirm.cancel': 'Cancel',
  'create.title': 'New worktree in {repo}',
  'create.cancel': 'Cancel',
  'hint.gitignore': 'Add .dsh/ to .gitignore so worktrees stay untracked.',
  'error.rpc': 'Worktrees request failed ({status}).',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en
