/**
 * Pure update-from-main preflight (docs/ideas/dsh-next-worktrees-0.1.md).
 *
 * Direction flip of Merge: merge the primary's current branch INTO the
 * worktree. Conflicts are not a blocker — they are the reason this verb
 * exists. The plugin starts the merge in the worktree and leaves it for
 * the bound session's agent; it never authors commit content.
 *
 * This module turns raw git/session facts into the blocker list the modal
 * renders; it never runs git.
 */

/** Machine codes the client maps to blocker copy naming the fix. */
export type UpdateBlocker =
  | 'unknown-slug'
  | 'no-target-branch'
  | 'no-bound-session'
  | 'running-session'
  | 'in-progress'
  | 'dirty-worktree'
  | 'already-updated'

export interface UpdateFactsInput {
  /** A registry row exists for the slug and its worktree is live. */
  readonly slugKnown: boolean
  /** The primary has a checked-out branch to merge from. */
  readonly sourceBranch: string | undefined
  /** The worktree row is bound to a session (the resolver). */
  readonly boundSession: boolean
  /** The bound session is currently running (one-writer). */
  readonly sessionRunning: boolean
  /** The worktree is already in the middle of a merge. */
  readonly inProgress: boolean
  /** The worktree's porcelain is empty (ignored when inProgress). */
  readonly worktreeClean: boolean
  /** The primary branch is already an ancestor of the worktree branch. */
  readonly alreadyUpdated: boolean
}

export interface UpdateVerdict {
  /** Blockers in display priority order. */
  readonly blockers: readonly UpdateBlocker[]
  /** True when Update may execute (start or complete a clean merge). */
  readonly green: boolean
}

/**
 * Decide the update verdict from collected facts.
 *
 * Priority: identity, then a home for the agent, then tree state.
 * `in-progress` suppresses `dirty-worktree` — a merge in flight is always
 * dirty, and the modal's job then is Abort / Continue, not Execute.
 *
 * @param input - the raw facts.
 * @returns the verdict the modal renders.
 */
export function updateVerdict(input: UpdateFactsInput): UpdateVerdict {
  const blockers: UpdateBlocker[] = []
  if (!input.slugKnown) blockers.push('unknown-slug')
  if (input.sourceBranch === undefined || input.sourceBranch === '') {
    blockers.push('no-target-branch')
  }
  // Session and tree-state blockers are noise when the slug is gone —
  // the modal only needs "refresh".
  if (input.slugKnown && !input.boundSession) blockers.push('no-bound-session')
  if (input.slugKnown && input.sessionRunning) blockers.push('running-session')
  if (input.slugKnown && input.inProgress) blockers.push('in-progress')
  else if (input.slugKnown && !input.worktreeClean) blockers.push('dirty-worktree')
  if (input.slugKnown && input.alreadyUpdated) blockers.push('already-updated')
  return { blockers, green: blockers.length === 0 }
}
