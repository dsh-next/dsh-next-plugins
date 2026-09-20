import type { SetupStep } from './types.ts'

/**
 * Create-time options that carry trust decisions.
 *
 * A repository can declare work a fresh worktree needs: commands in
 * `.worktrees.json` and untracked paths in `.worktreeinclude`. Neither is
 * performed by default. The host runs a command only for an explicit
 * `setupApproved` and copies a path only for an explicit `copyApproved`,
 * each bound to the preview the user saw through `expectedSetupVersion`.
 */
export interface WorktreeCreateOptions {
  readonly mode?: 'new' | 'ref'
  readonly name?: string
  readonly ref?: string
  readonly refKind?: 'branch' | 'remote' | 'tag'
  readonly base?: string
  /** Run the resolved `.worktrees.json` steps. */
  readonly setupApproved?: boolean
  /** Copy the resolved `.worktreeinclude` paths. */
  readonly copyApproved?: boolean
  /** The preview version both approvals were given against. */
  readonly expectedSetupVersion?: string
}

/**
 * The setup a create would perform, shown before anything runs.
 *
 * `version` fingerprints the primary checkout, the chosen base commit, the
 * platform, and the exact resolved steps and paths. A create carrying an
 * approval for any other version is refused, so a repository edit cannot turn
 * a reviewed preview into a different command.
 */
export interface WorktreeSetupPreview {
  /** Primary checkout the setup commands and copied paths come from. */
  readonly root: string
  readonly slug: string
  /** Absolute path the worktree will occupy. */
  readonly path: string
  readonly branch: string | null
  /** Base ref as requested. */
  readonly base: string
  /** Immutable commit the base resolved to. */
  readonly baseOid: string
  readonly version: string
  readonly steps: readonly SetupStep[]
  readonly includePaths: readonly string[]
  /** A setup-file error code, or null when the file parsed. */
  readonly notice: string | null
}

/** Whether a preview would run or copy anything. */
export function setupHasEffects(preview: WorktreeSetupPreview): boolean {
  return preview.steps.length > 0 || preview.includePaths.length > 0
}
