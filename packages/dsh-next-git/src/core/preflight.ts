/**
 * Preflight decisions for the writes whose blast radius is not local.
 *
 * Cheap writes (stage, unstage, commit) act directly. Everything that can
 * lose work or change what is checked out — discard, worktree delete, branch
 * switch/delete, merge, update, checkout of a commit, revert, cherry-pick —
 * runs through this model first. It answers one of three things:
 *
 * - `allow` — run it.
 * - `confirm` — the user must name the fix (the panel renders a danger
 *   confirmation carrying the affected paths).
 * - `block` — git cannot do it now, and the panel names what must change.
 *
 * The model is pure and total: every action/context pair has a verdict.
 */

import { blocksCheckout } from './operation.ts'
import type { GitFailureCode, OperationKind, PreflightAction, PreflightDecision } from './types.ts'

/** Everything the model reads. All fields are already-resolved facts. */
export interface PreflightInput {
  readonly action: PreflightAction
  /** Operation in progress, or null when at rest. */
  readonly operation: OperationKind | null
  /** Dirty tracked paths (unstaged changes). */
  readonly modified: readonly string[]
  /** Untracked paths. */
  readonly untracked: readonly string[]
  /** Unmerged paths. */
  readonly conflicts: readonly string[]
  /** Whether HEAD is detached. */
  readonly detached: boolean
  /** Commit-ish or branch the action targets, when it has one. */
  readonly target?: string
  /** Whether the target branch is already an ancestor of HEAD. */
  readonly merged?: boolean
  /** Whether the target branch is the checked-out one. */
  readonly current?: boolean
  /** Whether the current branch has an upstream configured (update/merge). */
  readonly hasUpstream?: boolean
  /** How many commits the branch is behind its upstream (update). */
  readonly behind?: number
}

/** Every dirty path, modified first (the order the panel lists them). */
export function dirtyPathsOf(input: PreflightInput): string[] {
  return [...input.modified, ...input.untracked]
}

/** Whether anything would make a checkout-changing write unsafe. */
export function isDirty(input: PreflightInput): boolean {
  return input.modified.length > 0 || input.untracked.length > 0
}

const allow: PreflightDecision = { verdict: 'allow' }

function confirm(code: GitFailureCode, paths: readonly string[], detail: string): PreflightDecision {
  return { verdict: 'confirm', code, paths, detail }
}

function block(code: GitFailureCode, paths: readonly string[], detail: string): PreflightDecision {
  return { verdict: 'block', code, paths, detail }
}

/** The in-progress-operation block every checkout-changing action shares. */
function operationBlock(input: PreflightInput): PreflightDecision | null {
  if (input.operation === null) return null
  return block('operation-in-progress', input.conflicts, `operation:${input.operation}`)
}

/**
 * Decide one action.
 *
 * @param input - resolved repository facts.
 * @returns the verdict the panel acts on.
 */
export function decidePreflight(input: PreflightInput): PreflightDecision {
  switch (input.action) {
    case 'discard':
      // Whole-file discard is destructive on both sides, and on an untracked
      // path it deletes the file outright: always a named confirmation.
      return confirm('dirty-tree', dirtyPathsOf(input), 'discard')

    case 'remove-untracked':
      return confirm('dirty-tree', input.untracked, 'remove-untracked')

    case 'delete-worktree': {
      const inProgress = operationBlock(input)
      if (inProgress !== null) return inProgress
      const dirty = dirtyPathsOf(input)
      if (input.merged === false) {
        return confirm('not-merged', dirty, 'delete-worktree-unmerged')
      }
      if (dirty.length > 0) {
        return confirm('dirty-tree', dirty, 'delete-worktree-dirty')
      }
      return allow
    }

    case 'switch-branch': {
      const inProgress = operationBlock(input)
      if (inProgress !== null) return inProgress
      if (isDirty(input)) {
        return confirm('dirty-tree', dirtyPathsOf(input), `switch:${input.target ?? ''}`)
      }
      return allow
    }

    case 'delete-branch': {
      const inProgress = operationBlock(input)
      if (inProgress !== null) return inProgress
      if (input.current === true) {
        return block('current-branch', [], `delete:${input.target ?? ''}`)
      }
      if (input.merged === false) {
        return confirm('not-merged', [], `delete-unmerged:${input.target ?? ''}`)
      }
      return confirm('not-merged', [], `delete:${input.target ?? ''}`)
    }

    case 'merge': {
      const inProgress = operationBlock(input)
      if (inProgress !== null) return inProgress
      if (input.detached) return block('detached-head', [], 'merge')
      if (isDirty(input)) return block('dirty-tree', dirtyPathsOf(input), 'merge')
      return allow
    }

    case 'update': {
      const inProgress = operationBlock(input)
      if (inProgress !== null) return inProgress
      if (input.detached) return block('detached-head', [], 'update')
      if (input.hasUpstream === false) return block('no-upstream', [], 'update')
      if (isDirty(input)) return block('dirty-tree', dirtyPathsOf(input), 'update')
      return allow
    }

    case 'checkout-commit': {
      const inProgress = operationBlock(input)
      if (inProgress !== null) return inProgress
      if (isDirty(input)) return confirm('dirty-tree', dirtyPathsOf(input), 'checkout-commit')
      // A commit checkout detaches HEAD; always name that.
      return confirm('detached-head', [], `checkout:${input.target ?? ''}`)
    }

    case 'revert':
    case 'cherry-pick': {
      const inProgress = operationBlock(input)
      if (inProgress !== null) return inProgress
      if (isDirty(input)) return block('dirty-tree', dirtyPathsOf(input), input.action)
      return allow
    }

    default:
      return allow
  }
}

/** Whether an action always confirms, whatever the repository state. */
export function alwaysConfirms(action: PreflightAction): boolean {
  return action === 'discard' || action === 'remove-untracked'
}

/** Whether an abortable operation is what stands in the way. */
export function needsOperationAbort(decision: PreflightDecision): boolean {
  return decision.verdict === 'block' && decision.code === 'operation-in-progress'
}

/** Whether the operation must clear before a checkout-changing write. */
export function operationBlocksCheckout(kind: OperationKind | null): boolean {
  return blocksCheckout(kind)
}
