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
  /** The worktree has MERGE_HEAD (an in-flight merge, typically a conflict). */
  readonly merging?: boolean
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
  /** In-flight merge in the worktree (red icon; Abort / Continue). */
  readonly conflict: boolean
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
  const conflict = input.merging === true
  return {
    clean: input.dirtyCount === 0 && !conflict,
    dirty: input.dirtyCount > 0 || conflict,
    ahead: input.aheadCount,
    merged: input.mergedIntoTarget && !input.tipEqualsBase,
    conflict,
  }
}

/**
 * Paths from `git status --porcelain` that count as dirt. Drops empty
 * lines and the plugin sidecar (`.dsh/`), which worktree add creates and
 * which must not block Merge.
 *
 * @param stdout - raw porcelain stdout.
 * @returns relative paths in porcelain order.
 */
export function porcelainDirtyPaths(stdout: string): readonly string[] {
  const paths: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    // Porcelain is "XY <path>" (or "XY orig -> dest" for renames).
    const path = line.slice(3).replace(/\\/g, '/').replace(/^"/, '').replace(/"$/, '')
    if (path === '.dsh' || path.startsWith('.dsh/')) continue
    paths.push(path)
  }
  return paths
}

/** One-line summary for tooltips and the menu facts block. */
export function statusLine(status: WorktreeStatus): string {
  const parts: string[] = []
  if (status.conflict) parts.push('conflict')
  else parts.push(status.dirty ? 'dirty' : 'clean')
  if (status.ahead > 0) parts.push(`${status.ahead} ahead`)
  if (status.merged) parts.push('merged')
  return parts.join(', ')
}
