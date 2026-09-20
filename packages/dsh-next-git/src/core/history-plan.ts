/** Pure, transport-neutral history planning. Commit inputs are resolved OIDs, never commands. */
export type HistoryAction = 'cherry-pick' | 'revert' | 'squash' | 'fixup' | 'reorder' | 'reword'
export interface HistorySource { readonly sessionId?: string; readonly cwd?: string }
export interface HistoryRequest {
  readonly action: HistoryAction
  /** Exact execution order for batches; chronological selection for rewrites. */
  readonly commits: readonly string[]
  /** Required only for reorder: a permutation of the selected commits. */
  readonly order?: readonly string[]
  /** Required for squash and reword. Never interpreted as code. */
  readonly message?: string
}
export interface HistoryCommit { readonly oid: string; readonly parents: readonly string[]; readonly subject: string }
export type HistoryReason = 'empty-selection' | 'too-many-commits' | 'duplicate-commit' | 'invalid-oid' | 'unsupported-action' | 'merge-unsupported' | 'root-unsupported' | 'not-current-history' | 'noncontiguous-selection' | 'ambiguous-topology' | 'invalid-order' | 'invalid-message'
export interface HistoryRejection { readonly eligible: false; readonly reason: HistoryReason; readonly detail: string }
export interface HistoryStep { readonly kind: 'pick' | 'fixup' | 'message'; readonly oid: string }
export interface HistoryPlan {
  readonly eligible: true
  readonly action: HistoryAction
  readonly selected: readonly string[]
  readonly ordered: readonly string[]
  /** Every commit whose identity may change, including unselected descendants. */
  readonly affected: readonly string[]
  readonly descendants: readonly string[]
  readonly base: string | null
  readonly steps: readonly HistoryStep[]
  readonly message: string | null
  readonly rewrites: boolean
}
export type HistoryEligibility = HistoryPlan | HistoryRejection
export type HistoryPublication =
  | { readonly state: 'reachable'; readonly refs: readonly string[]; readonly warning: string }
  | { readonly state: 'unknown'; readonly refs: readonly string[]; readonly warning: string }
export interface HistoryBinding {
  readonly source: HistorySource
  readonly checkout: string
  readonly gitDir: string
  readonly commonDir: string
  readonly head: string
  readonly headRef: string | null
  readonly tree: string
}
export interface HistoryPreview {
  readonly operationId: string
  readonly createdAt: string
  readonly binding: HistoryBinding
  readonly plan: HistoryPlan
  readonly publication: HistoryPublication
  readonly requiresPublishedAcknowledgment: boolean
  readonly backupRef: string
  readonly otherCheckouts: readonly { readonly checkout: string; readonly headRef: string | null }[]
  readonly diffSummary: string
  readonly diffMeaning: string
  readonly warnings: readonly string[]
  readonly permission: { readonly source: HistorySource; readonly checkout: string; readonly authority: 'apply-approved-history-plan' }
}
export type HistoryPhase = 'preview' | 'running' | 'stopped' | 'completed' | 'failed' | 'cancelled' | 'aborted' | 'interrupted' | 'recovering' | 'recovered'
export interface HistoryNativeState {
  readonly kind: 'rebase' | 'cherry-pick' | 'revert' | 'other' | null
  readonly remaining: readonly string[]
  readonly conflicts: readonly string[]
  readonly owned: boolean
}
export interface HistoryStatus {
  readonly preview: HistoryPreview
  readonly phase: HistoryPhase
  readonly native: HistoryNativeState
  readonly currentHead: string
  readonly currentRef: string | null
  readonly clean: boolean
  readonly completedHead: string | null
  readonly error: string | null
  readonly nextStep: string
  readonly canRestore: boolean
}
export interface HistoryApproval { readonly approved: true; readonly acknowledgePublishedHistory?: boolean }
export type HistoryRecovery =
  | { readonly action: 'cancel' }
  | { readonly action: 'continue' | 'skip' }
  | { readonly action: 'abort'; readonly discardResolutionEdits: true }
  | { readonly action: 'restore'; readonly approved: true }

/** Default UI order from a known chronological selection; explicit batch order is never changed. */
export function defaultHistoryOrder(action: HistoryAction, oldestFirst: readonly string[]): string[] {
  return action === 'revert' ? [...oldestFirst].reverse() : [...oldestFirst]
}
export function isHistoryOid(value: string): boolean { return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) }

/** currentHistory is oldest first and must include all selected commits and descendants through HEAD. */
export function planHistory(request: HistoryRequest, selected: readonly HistoryCommit[], currentHistory: readonly HistoryCommit[]): HistoryEligibility {
  const reject = (reason: HistoryReason, detail: string): HistoryRejection => ({ eligible: false, reason, detail })
  if (!['cherry-pick', 'revert', 'squash', 'fixup', 'reorder', 'reword'].includes(request.action)) return reject('unsupported-action', 'This history action is not supported.')
  if (selected.length === 0) return reject('empty-selection', 'Select at least one commit.')
  if (selected.length > 100) return reject('too-many-commits', 'Select at most 100 commits.')
  const ids = selected.map(c => c.oid)
  if (ids.some(id => !isHistoryOid(id))) return reject('invalid-oid', 'Every commit must resolve to a full commit OID.')
  if (new Set(ids).size !== ids.length) return reject('duplicate-commit', 'A commit may only occur once.')
  if (selected.some(c => c.parents.length > 1)) return reject('merge-unsupported', 'Merge commits require a mainline or merge-preserving plan; neither is supported.')
  if (selected.some(c => c.parents.length === 0)) return reject('root-unsupported', 'Root commits are not supported by this planner.')
  const rewrites = request.action !== 'cherry-pick' && request.action !== 'revert'
  if (!rewrites) return { eligible: true, action: request.action, selected: ids, ordered: ids, affected: ids, descendants: [], base: null, steps: ids.map(oid => ({ kind: 'pick', oid })), message: null, rewrites }
  const positions = ids.map(id => currentHistory.findIndex(c => c.oid === id))
  if (positions.some(p => p < 0)) return reject('not-current-history', 'Rewrites must select commits on the current branch within the loaded history window.')
  const sorted = [...positions].sort((a, b) => a - b)
  if (sorted.some((p, i) => i > 0 && p !== sorted[i - 1]! + 1)) return reject('noncontiguous-selection', 'Select a contiguous range; intervening commits cannot be omitted.')
  if (request.action === 'reword' && ids.length !== 1) return reject('invalid-order', 'Reword accepts exactly one commit.')
  if ((request.action === 'squash' || request.action === 'fixup') && ids.length < 2) return reject('invalid-order', 'Squash and fixup require at least two commits.')
  const range = currentHistory.slice(sorted[0]!)
  if (range.some(c => c.parents.length !== 1)) return reject('merge-unsupported', 'A rewritten descendant is a merge or root; refusing to flatten topology.')
  if (range.some((c, i) => i > 0 && c.parents[0] !== range[i - 1]!.oid)) return reject('ambiguous-topology', 'The entire rewritten range must be a single linear parent chain.')
  const chronological = currentHistory.slice(sorted[0]!, sorted[0]! + ids.length).map(c => c.oid)
  const descendants = range.slice(ids.length).map(c => c.oid)
  let ordered = chronological
  if (request.action === 'reorder') {
    const order = request.order
    if (order === undefined || order.length !== ids.length || new Set(order).size !== ids.length || order.some(id => !ids.includes(id))) return reject('invalid-order', 'Reorder must be an exact permutation of the selected commits.')
    ordered = [...order]
  }
  const needsMessage = request.action === 'reword' || request.action === 'squash'
  if (needsMessage && (typeof request.message !== 'string' || request.message.trim() === '' || request.message.includes('\0') || request.message.length > 65536)) return reject('invalid-message', 'Provide a nonempty message of at most 65536 characters without NUL bytes.')
  const steps: HistoryStep[] = ordered.map((oid, i) => ({ kind: (request.action === 'squash' || request.action === 'fixup') && i > 0 ? 'fixup' : 'pick', oid }))
  if (needsMessage) steps.push({ kind: 'message', oid: ordered[ordered.length - 1]! })
  steps.push(...descendants.map(oid => ({ kind: 'pick' as const, oid })))
  return { eligible: true, action: request.action, selected: chronological, ordered, affected: range.map(c => c.oid), descendants, base: range[0]!.parents[0]!, steps, message: needsMessage ? request.message! : null, rewrites }
}
