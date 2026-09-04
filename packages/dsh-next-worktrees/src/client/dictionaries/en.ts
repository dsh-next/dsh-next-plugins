/**
 * English dictionary — the key source for the `worktrees` locale namespace.
 *
 * English is this repo's language and the platform's fallback locale, so
 * the key set is defined here; zh.ts mirrors it (parity is compile-checked
 * and `pnpm i18n:check` enforces it). Values may carry `{name}` placeholders.
 */

/** Locale namespace this plugin owns. */
export const NS = 'worktrees'

export const en = {
  'toggle.label': 'Isolated',
  'toggle.busy': 'Creating worktree…',
  'toggle.retry': 'Retry',
  'toggle.untitled': 'untitled',

  'modal.title': 'Start in an isolated worktree?',
  'modal.description': 'A git worktree and branch will be created for this session.',
  'modal.fullAccess': 'Sessions in a worktree run with full file access so git can write the shared repository metadata. Approval prompts stay on.',
  'modal.draftStays': 'Your draft stays in this session; the new session starts empty.',
  'modal.confirm': 'Create and switch',
  'modal.cancel': 'Cancel',

  'hint.ignore': 'Add .dsh/ to .gitignore so plugin worktrees stay untracked.',
  'hint.dismiss': 'Dismiss',
  'hint.copy': 'Copy',

  'chip.clean': 'clean',
  'chip.dirty': 'uncommitted changes',
  'chip.error': 'status unavailable',
  'chip.ahead': '{count} ahead',
  'chip.open': 'Worktree details',

  'panel.branch': 'Branch',
  'panel.base': 'Base',
  'panel.path': 'Path',
  'panel.siblings': 'Siblings',
  'panel.siblings.none': 'No other worktrees',
  'panel.siblings.running': 'running',
  'panel.siblings.idle': 'idle',
  'panel.copyBranch': 'Copy branch name',
  'panel.copyMerge': 'Copy merge command',
  'panel.copied': 'Copied',
  'panel.newSession': 'New session here',
  'panel.newSession.busy': 'Session is running — stop it first',
  'panel.remove': 'Remove worktree',
  'panel.refresh': 'Refresh',

  'remove.title': 'Remove this worktree?',
  'remove.survives': 'The branch {branch} and its commits survive; only the worktree directory is removed.',
  'remove.dirty': 'It has uncommitted or untracked changes.',
  'remove.confirm': 'Remove',
  'remove.force': 'Remove anyway (discard changes)',
  'remove.cancel': 'Cancel',

  'error.rpc': 'Worktrees service unreachable ({status})',
  'error.flow': '{message}',
  'error.create': 'Could not create the worktree: {message}',
} as const

/** Every dictionary key. */
export type MessageKey = keyof typeof en
