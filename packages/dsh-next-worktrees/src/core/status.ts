/**
 * Pure status derivation for one worktree: the facts badges, menus, and
 * the merge flow consume. Inputs are raw git answers (porcelain line
 * count, rev-list counts); this module only shapes them.
 */

export interface WorktreeStatusInput {
  /** `git status --porcelain` line count at the worktree (0 = clean). */
  readonly dirtyCount: number
  /** `git rev-list --count <baseRef>..<branch>` at the worktree. */
  readonly aheadCount: number
  /** The branch is an ancestor of the primary's checked-out branch. */
  readonly mergedIntoTarget: boolean
  /**
   * The branch tip points at the same commit as the base ref (a fresh
   * worktree with no unique work yet).
   */
  readonly tipEqualsBase: boolean
}

export interface WorktreeStatus {
  /** Clean tree (nothing to lose). */
  readonly clean: boolean
  /** Dirty tree (uncommitted work present). */
  readonly dirty: boolean
  /** Commits on the branch not on the base. */
  readonly ahead: number
  /** Landed in the primary's branch already (cleanup is safe-ish). */
  readonly merged: boolean
}

/**
 * Derive the status facts.
 *
 * Merged discriminator: a branch with zero unique commits is trivially an
 * ancestor of the base, so ancestry alone reports "merged" on a fresh
 * worktree. Merged requires the branch tip to differ from the base tip —
 * tip == base means "no unique work yet", never "landed".
 *
 * @param input - raw git answers.
 * @returns the shaped status.
 */
export function worktreeStatus(input: WorktreeStatusInput): WorktreeStatus {
  return {
    clean: input.dirtyCount === 0,
    dirty: input.dirtyCount > 0,
    ahead: input.aheadCount,
    merged: input.mergedIntoTarget && !input.tipEqualsBase,
  }
}

/** One-line summary for tooltips and the menu facts block. */
export function statusLine(status: WorktreeStatus): string {
  const parts: string[] = []
  parts.push(status.dirty ? 'dirty' : 'clean')
  if (status.ahead > 0) parts.push(`${status.ahead} ahead`)
  if (status.merged) parts.push('merged')
  return parts.join(', ')
}
