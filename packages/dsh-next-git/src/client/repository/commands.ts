import type { MessageKey } from '../dictionaries.ts'
import type { RepositoryAction } from './workspace-types.ts'

/** Menu IDs describe user intent, not arbitrary Git arguments. */
export type RepositoryMenuCommand = RepositoryAction
  | 'pull' | 'clone' | 'checkout' | 'sync' | 'pull-rebase' | 'pull-from'
  | 'push-force' | 'push-to' | 'push-to-force' | 'fetch-prune' | 'fetch-all'
  | 'commit' | 'commit-staged' | 'commit-all' | 'commit-amend' | 'commit-staged-amend' | 'commit-all-amend'
  | 'commit-signoff' | 'commit-staged-signoff' | 'commit-all-signoff' | 'undo-commit' | 'abort-rebase'
  | 'stage-all' | 'unstage-all' | 'discard-all'
  | 'merge' | 'rebase' | 'branch-create-from' | 'remote-branch-delete' | 'publish'
  | 'remote-add' | 'remote-remove' | 'stash-untracked' | 'stash-staged'
  | 'stash-apply-latest' | 'stash-pop-latest' | 'stash-pop' | 'stash-drop' | 'stash-clear' | 'stash-view'
  | 'tag-create' | 'tag-delete' | 'remote-tag-delete' | 'tags-push'
  | 'worktree-create' | 'worktree-manage' | 'output'

export const commandLabels: Record<RepositoryMenuCommand, MessageKey> = {
  fetch: 'repository.fetch', push: 'repository.push', 'stash-save': 'repository.stash-save', 'stash-apply': 'repository.stash-apply',
  'branch-create': 'repository.branch.create', 'branch-rename': 'repository.branch.rename', 'branch-delete': 'repository.branch.delete',
  pull: 'commands.pull', clone: 'commands.clone', checkout: 'commands.checkout', sync: 'commands.sync',
  'pull-rebase': 'commands.pullRebase', 'pull-from': 'commands.pullFrom', 'push-force': 'commands.pushForce',
  'push-to': 'commands.pushTo', 'push-to-force': 'commands.pushToForce', 'fetch-prune': 'commands.fetchPrune', 'fetch-all': 'commands.fetchAll',
  commit: 'commit.button', 'commit-staged': 'commands.commitStaged', 'commit-all': 'commands.commitAll',
  'commit-amend': 'commands.commitAmend', 'commit-staged-amend': 'commands.commitStagedAmend', 'commit-all-amend': 'commands.commitAllAmend',
  'commit-signoff': 'commands.commitSignoff', 'commit-staged-signoff': 'commands.commitStagedSignoff', 'commit-all-signoff': 'commands.commitAllSignoff',
  'undo-commit': 'commands.undoCommit', 'abort-rebase': 'commands.abortRebase',
  'stage-all': 'changes.stageAll', 'unstage-all': 'changes.unstageAll', 'discard-all': 'changes.discardAll',
  merge: 'commands.merge', rebase: 'commands.rebase', 'branch-create-from': 'commands.branchCreateFrom',
  'remote-branch-delete': 'commands.remoteBranchDelete', publish: 'commands.publish',
  'remote-add': 'commands.remoteAdd', 'remote-remove': 'commands.remoteRemove',
  'stash-untracked': 'commands.stashUntracked', 'stash-staged': 'commands.stashStaged',
  'stash-apply-latest': 'commands.stashApplyLatest', 'stash-pop-latest': 'commands.stashPopLatest', 'stash-pop': 'commands.stashPop',
  'stash-drop': 'commands.stashDrop', 'stash-clear': 'commands.stashClear', 'stash-view': 'commands.stashView',
  'tag-create': 'commands.tagCreate', 'tag-delete': 'commands.tagDelete', 'remote-tag-delete': 'commands.remoteTagDelete', 'tags-push': 'commands.tagsPush',
  'worktree-create': 'header.newWorktree', 'worktree-manage': 'commands.worktreeManage', output: 'commands.output',
}
