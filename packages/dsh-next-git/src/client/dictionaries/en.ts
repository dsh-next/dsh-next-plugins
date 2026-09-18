/**
 * English dictionary — the key source for this plugin's locale namespace.
 *
 * Repo contract: docs/i18n.md ("Plugin UI strings"). Every user-facing string
 * in the browser half is added here as a dotted key (English is the platform
 * fallback locale and this repo's language); zh.ts mirrors the key set and
 * the compiler enforces parity. Reference implementation:
 * packages/dsh-next-cc-plugins/src/client/dictionaries/.
 *
 * Keys are grouped by surface, in the order the panel renders them: chrome,
 * scroll and commit, worktrees, history, dialogs, agent verbs, then the named
 * failure states and their fixes.
 */

/** Locale namespace this plugin owns (also the slot label's namespace). */
export const NS = 'git'

/** User-facing strings; add keys here as UI lands. */
export const en = {
  // Chrome -----------------------------------------------------------------
  'type.label': 'Source control',
  'guide.title': 'Source control',
  'guide.description': 'Changes, diffs, history, branches and worktrees',
  'guide.iconLabel': 'Git branch',

  'header.detached': 'Detached HEAD',
  'header.unborn': 'No commits yet',
  'header.ahead': '{count} ahead',
  'header.behind': '{count} behind',
  'header.inSync': 'In sync',
  'header.refresh': 'Refresh',
  'header.refreshTitle': 'Re-read the repository',
  'header.branchMenu': 'Branches',
  'header.update': 'Update from branch',
  'header.updateTitle': 'Merge the upstream branch into this one',
  'header.newWorktree': 'New worktree',
  'header.identityMissing': 'Commit identity is not configured',
  'header.identityFix': 'Set user.name and user.email in git config, then refresh.',

  // Named states -----------------------------------------------------------
  'state.loading': 'Reading repository…',
  'state.noRepository': 'This session is not in a git repository',
  'state.noRepositoryFix': 'Open a session in a folder that is inside a git working tree, or run git init there.',
  'state.bare': 'This repository is bare',
  'state.bareFix': 'A bare repository has no working tree. Add a worktree (git worktree add) and open the session there.',
  'state.noGit': 'git is not available',
  'state.noGitFix': 'Install git and make sure it is on PATH, then reload this page.',
  'state.tooOld': 'git {installed} is too old',
  'state.tooOldFix': 'This panel needs git {required} or newer. Upgrade git, then reload this page.',
  'state.permission': 'git was denied access',
  'state.permissionFix': 'Check the repository directory permissions and try again.',
  'state.empty': 'Nothing to commit, working tree clean',
  'state.emptyHint': 'Edit a file in this workspace and it will show up here.',

  // Changes ----------------------------------------------------------------
  'changes.title': 'Changes',
  'changes.staged': 'Staged',
  'changes.unstaged': 'Unstaged',
  'changes.untracked': 'Untracked',
  'changes.conflicts': 'Conflicts',
  'changes.ignored': '{count} ignored',
  'changes.stage': 'Stage',
  'changes.unstage': 'Unstage',
  'changes.discard': 'Discard',
  'changes.open': 'Open',
  'changes.stageAll': 'Stage all',
  'changes.unstageAll': 'Unstage all',
  'changes.discardAll': 'Discard all changes',
  'changes.none': 'No changes',
  'changes.path': 'Path',
  'changes.status': 'Status',
  'changes.actions': 'Actions',

  // Commit -----------------------------------------------------------------
  'commit.placeholder': 'Message ({mod}+Enter to commit on "{branch}")',
  'commit.button': 'Commit',
  'commit.draft': 'Draft message',
  'commit.amend': 'Commit (Amend)',
  'commit.all': 'Commit All Changes',
  'commit.more': 'More commit commands',
  'commit.nothingStagedButChanges': 'Stage something, or use Commit All Changes.',
  'commit.nothingStaged': 'Stage something to commit.',

  // Hooks ------------------------------------------------------------------
  'hook.title': '{hook} failed',
  'hook.exitCode': 'Exit code {code}',
  'hook.retry': 'Retry',
  'hook.cancel': 'Cancel commit',
  'hook.dismiss': 'Dismiss',
  'hook.note': 'No hook output was captured.',

  // Operation state --------------------------------------------------------
  'operation.merge': 'Merge in progress',
  'operation.rebase': 'Rebase in progress',
  'operation.cherry-pick': 'Cherry-pick in progress',
  'operation.revert': 'Revert in progress',
  'operation.am': 'Patch application in progress',
  'operation.step': 'Step {step}',
  'operation.conflicts': '{count} conflicted file(s)',
  'operation.continue': 'Continue',
  'operation.abort': 'Abort',
  'operation.blocked': 'Finish or abort this operation before switching branches or merging.',

  // Worktrees --------------------------------------------------------------
  'worktrees.title': 'Worktrees',
  'worktrees.empty': 'No worktrees yet',
  'worktrees.emptyHint': 'Create one to work on another branch without leaving this checkout.',
  'worktrees.namePlaceholder': 'Worktree name',
  'worktrees.create': 'Create',
  'worktrees.primary': 'Primary',
  'worktrees.detached': 'detached',
  'worktrees.ahead': '{count} ahead',
  'worktrees.merged': 'Merged',
  'worktrees.dirty': 'Uncommitted changes',
  'worktrees.clean': 'Clean',
  'worktrees.merge': 'Merge into {branch}',
  'worktrees.update': 'Update from {branch}',
  'worktrees.delete': 'Delete worktree',
  'worktrees.openHint': 'The folder is inside this repository; open it as a workspace to work there.',
  'worktrees.setupRan': 'Ran {count} setup step(s)',
  'worktrees.setupFailed': 'Setup failed after {count} step(s)',
  'worktrees.setupOutput': 'Setup output',
  'worktrees.invalidName': 'Use lowercase letters, digits, dots and dashes.',

  // History ----------------------------------------------------------------
  'history.title': 'History',
  'history.empty': 'No commits yet',
  'history.loading': 'Reading history…',
  'history.loadMore': 'Load more',
  'history.openFiles': 'Open files changed',
  'history.copyHash': 'Copy hash',
  'history.copied': 'Copied',
  'history.checkout': 'Check out commit',
  'history.revert': 'Revert commit',
  'history.cherryPick': 'Cherry-pick',
  'history.changedFiles': '{count} file(s) changed',

  // Diff view --------------------------------------------------------------
  'diff.back': 'Back to changes',
  'diff.loading': 'Reading diff…',
  'diff.empty': 'No changes on this side',
  'diff.binary': 'Binary file — no text diff to show',
  'diff.tooLarge': 'Diff is too large to draw ({added} added, {removed} removed)',
  'diff.copyPatch': 'Copy patch',
  'diff.copied': 'Copied',
  'diff.added': '{count} added',
  'diff.removed': '{count} removed',
  'diff.newFile': 'New file',

  // Branches ---------------------------------------------------------------
  'branches.title': 'Branches',
  'branches.current': 'Current',
  'branches.switch': 'Switch',
  'branches.create': 'Create branch',
  'branches.createPlaceholder': 'New branch name',
  'branches.rename': 'Rename',
  'branches.renamePlaceholder': 'New name',
  'branches.delete': 'Delete branch',
  'branches.remote': 'Remote',
  'branches.checkoutRemote': 'Check out locally',
  'branches.none': 'No branches',

  // Confirmations ----------------------------------------------------------
  'confirm.title': 'Confirm',
  'confirm.cancel': 'Cancel',
  'confirm.discard': 'Discard changes',
  'confirm.discardBody': 'Discard changes in {count} file(s)? This cannot be undone. Untracked files are deleted from disk.',
  'confirm.removeUntracked': 'Delete untracked files',
  'confirm.deleteWorktree': 'Delete worktree',
  'confirm.deleteWorktreeBody': 'Delete {path}? The folder is removed from disk.',
  'confirm.deleteWorktreeUnmerged': 'Delete {path}? Its branch has commits that are not merged anywhere; they will be lost.',
  'confirm.switchBranch': 'Switch branch',
  'confirm.switchBranchBody': 'Switch to {branch} with uncommitted changes? git will refuse if a file would be overwritten.',
  'confirm.deleteBranch': 'Delete branch',
  'confirm.deleteBranchBody': 'Delete branch {branch}?',
  'confirm.deleteBranchUnmerged': 'Delete branch {branch}? It is not fully merged; its commits will be lost.',
  'confirm.checkoutCommit': 'Check out commit',
  'confirm.checkoutCommitBody': 'Check out {hash}? HEAD becomes detached, so new commits need a branch.',
  'confirm.force': 'Delete anyway',
  'confirm.paths': 'Affected paths',
  'confirm.proceed': 'Continue',

  // Agent verbs ------------------------------------------------------------
  'agent.title': 'Ask the agent',
  'agent.review': 'Review changes',
  'agent.explain': 'Explain diff',
  'agent.draft': 'Draft commit message',
  'agent.resolve': 'Resolve in this session',
  'agent.sent': 'Sent to this session.',
  'agent.unavailable': 'No session is available to ask.',
  'agent.truncated': 'The payload was truncated to fit the prompt budget.',

  // Notices ----------------------------------------------------------------
  'notice.truncated': 'Some files were left out of the agent payload.',
  'notice.setupInvalid': 'Setup was skipped: .worktrees.json is not valid.',
  'notice.setupFailed': 'Setup failed. The worktree was created; see the setup output.',
  'notice.dismiss': 'Dismiss',

  // Failure codes ----------------------------------------------------------
  'failure.gitUnavailable': 'git is not available',
  'failure.gitTooOld': 'git is too old',
  'failure.notARepository': 'Not a git repository',
  'failure.bareRepository': 'Bare repository',
  'failure.permissionDenied': 'Permission denied',
  'failure.identityMissing': 'Commit identity missing',
  'failure.indexLocked': 'Another git process is running',
  'failure.operationInProgress': 'An operation is in progress',
  'failure.dirtyTree': 'The working tree has uncommitted changes',
  'failure.notMerged': 'The branch is not fully merged',
  'failure.detachedHead': 'HEAD is detached',
  'failure.currentBranch': 'That is the current branch',
  'failure.branchExists': 'That branch already exists',
  'failure.worktreeExists': 'That worktree already exists',
  'failure.invalidName': 'That name is not valid',
  'failure.noUpstream': 'No upstream branch is configured',
  'failure.nothingToCommit': 'Nothing to commit',
  'failure.pathMissing': 'That path is not available',
  'failure.hookFailed': 'A git hook failed',
  'failure.hookCancelled': 'The commit was cancelled',
  'failure.cancelled': 'Cancelled',
  'failure.timeout': 'git timed out',
  'failure.gitFailed': 'git failed',

  'failure.fix.indexLocked': 'Another git process (most likely the agent in this session) is writing the index. It retries automatically; try again in a moment.',
  'failure.fix.operationInProgress': 'Finish or abort the operation from the banner above first.',
  'failure.fix.dirtyTree': 'Commit, stash or discard the listed changes first.',
  'failure.fix.notMerged': 'Merge the branch first, or confirm the forced delete.',
  'failure.fix.detachedHead': 'Check out a branch before this action.',
  'failure.fix.identityMissing': 'Set user.name and user.email in git config.',
  'failure.fix.noUpstream': 'Push the branch once (git push -u) so an upstream exists.',
  'failure.fix.pathMissing': 'The path was moved or deleted. Refresh and try again.',
  'failure.fix.gitFailed': 'Run the same git command in a terminal to see the full output.',

  // Busy labels ------------------------------------------------------------
  'busy.stage': 'Staging…',
  'busy.unstage': 'Unstaging…',
  'busy.discard': 'Discarding…',
  'busy.commit': 'Committing…',
  'busy.draft': 'Drafting…',
  'busy.agent': 'Asking the agent…',
  'busy.worktree-create': 'Creating worktree…',
  'busy.worktree-remove': 'Deleting worktree…',
  'busy.worktree-merge': 'Merging worktree…',
  'busy.worktree-update': 'Updating worktree…',
  'busy.branch-switch': 'Switching branch…',
  'busy.branch-create': 'Creating branch…',
  'busy.branch-rename': 'Renaming branch…',
  'busy.branch-delete': 'Deleting branch…',
  'busy.continue': 'Continuing…',
  'busy.abort': 'Aborting…',
  'busy.update': 'Updating…',
  'busy.revert': 'Reverting…',
  'busy.cherry-pick': 'Cherry-picking…',
  'busy.checkout': 'Checking out…',

  // DiffBlock chrome -------------------------------------------------------
  'diffBlock.copy': 'Copy',
  'diffBlock.copied': 'Copied',
  'diffBlock.collapseAria': 'Collapse diff',
  'diffBlock.expandAria': 'Expand {count} hidden line(s)',
  'diffBlock.collapse': 'Collapse',
  'diffBlock.expand': 'Show {count} more line(s)',
  'diffBlock.files': '{count} file(s)',

  // Validation issues ------------------------------------------------------
  'issue.slug.empty': 'Enter a name.',
  'issue.slug.too-long': 'Names are limited to 48 characters.',
  'issue.slug.invalid-character': 'Use lowercase letters, digits, dots and dashes.',
  'issue.slug.reserved': 'That name is reserved.',
  'issue.slug.separator': 'Slashes are not allowed in a worktree name.',
  'issue.branch.empty': 'Enter a branch name.',
  'issue.branch.separator': 'That branch name has an empty or hidden path segment.',
  'issue.branch.reserved': 'That branch name is reserved.',
  'issue.branch.invalid-character': 'A branch name cannot contain spaces, ~ ^ : ? * [ or control characters.',
  'issue.branch.trailing-dot': 'A branch name cannot end with a dot or a slash.',
  'issue.branch.leading-dash': 'A branch name cannot start with a dash.',
  'issue.branch.consecutive-dots': 'A branch name cannot contain two consecutive dots.',
  'issue.branch.existing': 'That branch already exists.',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en
