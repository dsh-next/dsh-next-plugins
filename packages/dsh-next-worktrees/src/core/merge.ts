/**
 * Pure merge-preflight decision (docs/ideas/dsh-next-worktrees-sidebar-ux.md
 * -> "The Merge action").
 *
 * The plugin performs exactly one guarded write to the user's branch: a
 * preflighted `git merge --no-edit` of a worktree branch into the primary
 * checkout's current branch. This module turns raw git facts into the
 * blocker list the modal renders; it never runs git.
 */

/** Machine codes the client maps to blocker copy naming the fix. */
export type MergeBlocker =
  | 'unknown-slug'
  | 'old-git'
  | 'dirty-primary'
  | 'dirty-worktree'
  | 'conflict'
  | 'already-merged'
  | 'no-target-branch'

export interface MergeFactsInput {
  /** A registry row exists for the slug and its worktree is live. */
  readonly slugKnown: boolean
  /** `git --version` satisfies the merge-tree gate (>= 2.38). */
  readonly gitModern: boolean
  /** The primary checkout's porcelain is empty. */
  readonly primaryClean: boolean
  /** The worktree's porcelain is empty (branch fully committed). */
  readonly worktreeClean: boolean
  /** The primary has a checked-out branch to merge into. */
  readonly targetBranch: string | undefined
  /**
   * `git merge-tree --write-tree <target> <source>` exited clean (0) when
   * run; false means conflict or not-run. `dryRunRan` distinguishes the two.
   */
  readonly dryRunClean: boolean
  /** Whether the conflict dry-run actually executed (git modern + inputs). */
  readonly dryRunRan: boolean
  /** The source branch is already an ancestor of the target. */
  readonly alreadyMerged: boolean
}

export interface MergeVerdict {
  /** Blockers in display priority order. */
  readonly blockers: readonly MergeBlocker[]
  /** True when every gate passed and Merge may execute. */
  readonly green: boolean
}

/**
 * Decide the merge verdict from collected facts.
 *
 * Priority: identity errors first, then environment, then tree state, then
 * content — the modal shows the first blocker that blocks, all of them when
 * several apply.
 *
 * @param input - the raw facts.
 * @returns the verdict the modal renders.
 */
export function mergeVerdict(input: MergeFactsInput): MergeVerdict {
  const blockers: MergeBlocker[] = []
  if (!input.slugKnown) blockers.push('unknown-slug')
  if (input.targetBranch === undefined || input.targetBranch === '') {
    blockers.push('no-target-branch')
  }
  if (!input.gitModern) blockers.push('old-git')
  if (!input.primaryClean) blockers.push('dirty-primary')
  if (!input.worktreeClean) blockers.push('dirty-worktree')
  if (input.alreadyMerged) blockers.push('already-merged')
  else if (input.dryRunRan && !input.dryRunClean) blockers.push('conflict')
  return { blockers, green: blockers.length === 0 }
}

/** Parse `git version x.y.z` output into a comparable [major, minor]. */
export function parseGitVersion(stdout: string): [number, number] | undefined {
  const match = /git version (\d+)\.(\d+)/.exec(stdout.trim())
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2])]
}

/** The merge-tree gate: the dry-run subcommand needs git >= 2.38. */
export function gitSupportsMergeTree(version: [number, number] | undefined): boolean {
  if (version === undefined) return false
  const [major, minor] = version
  return major > 2 || (major === 2 && minor >= 38)
}

/**
 * Whether merging source into target would fast-forward (no merge commit).
 *
 * @param targetAncestorOfSource - `merge-base --is-ancestor target source`
 * exited 0.
 */
export function mergeWouldFastForward(targetAncestorOfSource: boolean): boolean {
  return targetAncestorOfSource
}
