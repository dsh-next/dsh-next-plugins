/**
 * In-progress history operations: merge, rebase, cherry-pick, revert, am.
 *
 * This is the state users get stuck in, so it is detected explicitly and
 * drives the panel's Continue / Abort section. The host reads the git
 * directory's marker files and hands their contents here; this module is
 * pure so every branch is unit-testable without a repository.
 */

import type { OperationKind, OperationState, StatusEntry } from './types.ts'

/** Raw marker-file evidence the host collected from the git directory. */
export interface OperationMarkers {
  /** `MERGE_HEAD` content, or null when absent. */
  readonly mergeHead: string | null
  /** `rebase-merge/` exists (interactive or merge-backend rebase). */
  readonly rebaseMerge: boolean
  /** `rebase-apply/` exists (apply-backend rebase or git am). */
  readonly rebaseApply: boolean
  /** `rebase-apply/applying` exists: standalone git am, not rebase. */
  readonly rebaseApplyApplying?: boolean
  /** `rebase-apply/rebasing` exists: apply-backend rebase. */
  readonly rebaseApplyRebasing?: boolean
  /** `CHERRY_PICK_HEAD` content, or null when absent. */
  readonly cherryPickHead: string | null
  /** `REVERT_HEAD` content, or null when absent. */
  readonly revertHead: string | null
  /** `rebase-merge/msgnum` + `end`, when present (a `2/5` step label). */
  readonly rebaseStep: { readonly current: number; readonly total: number } | null
  /** `MERGE_MSG` content, or null. */
  readonly message: string | null
}

/** No markers at all: the common case. */
export function atRestMarkers(): OperationMarkers {
  return {
    mergeHead: null,
    rebaseMerge: false,
    rebaseApply: false,
    cherryPickHead: null,
    revertHead: null,
    rebaseStep: null,
    message: null,
  }
}

/**
 * Which operation is in progress.
 *
 * Precedence follows git's own: a rebase directory outranks the others
 * because `git rebase` leaves `CHERRY_PICK_HEAD` from the conflicted pick
 * it is mid-way through. Standalone git am is identified by its applying
 * marker; older collectors without that evidence retain the rebase fallback.
 */
export function operationKindOf(markers: OperationMarkers): OperationKind | null {
  if (markers.rebaseMerge) return 'rebase'
  if (markers.rebaseApply) {
    if (markers.rebaseApplyApplying && !markers.rebaseApplyRebasing) return 'am'
    return 'rebase'
  }
  if (markers.mergeHead !== null) return 'merge'
  if (markers.cherryPickHead !== null) return 'cherry-pick'
  if (markers.revertHead !== null) return 'revert'
  return null
}

/**
 * Build the panel's operation state.
 *
 * @param markers - marker-file evidence from the git directory.
 * @param entries - status entries, for the unmerged path list.
 * @returns the operation state; `kind: null` means the tree is at rest.
 */
export function detectOperation(
  markers: OperationMarkers,
  entries: readonly StatusEntry[] = [],
): OperationState {
  const kind = operationKindOf(markers)
  const conflicts = entries.filter((entry) => entry.unmerged !== undefined).map((entry) => entry.path)
  const step =
    markers.rebaseStep !== null && markers.rebaseStep.total > 0
      ? `${markers.rebaseStep.current}/${markers.rebaseStep.total}`
      : null
  return {
    kind,
    step: kind === 'rebase' ? step : null,
    message: markers.message === null || markers.message.trim() === '' ? null : markers.message.trim(),
    conflicts,
  }
}

/** The git subcommand that continues an operation, or null when none applies. */
export function continueCommand(kind: OperationKind | null): string | null {
  switch (kind) {
    case 'merge':
      return 'commit'
    case 'rebase':
      return 'rebase --continue'
    case 'cherry-pick':
      return 'cherry-pick --continue'
    case 'revert':
      return 'revert --continue'
    case 'am':
      return 'am --continue'
    default:
      return null
  }
}

/** The git subcommand that aborts an operation, or null when none applies. */
export function abortCommand(kind: OperationKind | null): string | null {
  switch (kind) {
    case 'merge':
      return 'merge --abort'
    case 'rebase':
      return 'rebase --abort'
    case 'cherry-pick':
      return 'cherry-pick --abort'
    case 'revert':
      return 'revert --abort'
    case 'am':
      return 'am --abort'
    default:
      return null
  }
}

/** Whether an operation must clear before a checkout-changing write runs. */
export function blocksCheckout(kind: OperationKind | null): boolean {
  return kind !== null
}
