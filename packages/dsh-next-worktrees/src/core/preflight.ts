/**
 * Preflight decision model — pure logic.
 *
 * The composer toggle only appears for blank sessions in git-passing
 * workspaces. Degraded (read-only) mode covers a present-but-unusable git
 * state: the toggle hides instead of offering an action that would fail.
 */

/** Raw facts the host gathers before the toggle may render. */
export interface PreflightInput {
  /** `git` binary ran at all. */
  readonly gitAvailable: boolean
  /** `git rev-parse --show-toplevel` produced an absolute path. */
  readonly toplevel: string | null
  /** Placement math succeeded (primary resolvable, not a bare repo). */
  readonly placementOk: boolean
  /** A base ref resolved (`origin/HEAD` with local `HEAD` fallback). */
  readonly baseRef: string | null
  /** The `.dsh` directory is covered by the repo's gitignore. */
  readonly dirIgnored: boolean
}

/** Structured preflight outcome the client renders from. */
export interface PreflightResult {
  /** Toggle renders and creation is offered. */
  readonly ok: boolean
  /** Toggle hides entirely (git unusable for isolation). */
  readonly degraded: boolean
  /** Machine-readable blockers, empty when ok. */
  readonly reasons: readonly PreflightReason[]
  /** One-time hint shows when the worktree dir is not gitignored. */
  readonly showIgnoreHint: boolean
}

export type PreflightReason =
  | 'git-unavailable'
  | 'not-a-repository'
  | 'bare-or-unknown-layout'
  | 'no-base-ref'

/** Evaluate the toggle's preflight from gathered facts. */
export function evaluatePreflight(input: PreflightInput): PreflightResult {
  const reasons: PreflightReason[] = []
  if (!input.gitAvailable) reasons.push('git-unavailable')
  else if (input.toplevel === null) reasons.push('not-a-repository')
  else if (!input.placementOk) reasons.push('bare-or-unknown-layout')
  else if (input.baseRef === null) reasons.push('no-base-ref')

  const fatal = reasons.length > 0
  return {
    ok: !fatal,
    // A repo that cannot host a worktree at all degrades to read-only mode:
    // the toggle never renders, nothing breaks.
    degraded: fatal,
    reasons,
    showIgnoreHint: !fatal && !input.dirIgnored,
  }
}
