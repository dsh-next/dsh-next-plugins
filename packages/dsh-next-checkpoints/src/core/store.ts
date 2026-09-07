/**
 * Pure checkpoint fold: append, truncate after rewind, baseline first-seen.
 */
import { capPrompt, promptTooltip } from './prompt.ts'
import type { BaselineEntry, Checkpoint, CheckpointListItem, SessionState, SnapshotEntry } from './types.ts'

/**
 * Sparse checkpoint trees only record paths inspected at that turn.
 * Paths not in the tree still exist as the session baseline — they are
 * not deletes. Overlay so diffs and rewind see the effective tree.
 */
export function overlayTree(
  baseline: Record<string, BaselineEntry>,
  tree: readonly SnapshotEntry[],
): SnapshotEntry[] {
  const map = new Map<string, SnapshotEntry>()
  for (const entry of Object.values(baseline)) {
    map.set(entry.targetKey, { ...entry })
  }
  for (const entry of tree) {
    map.set(entry.targetKey, entry)
  }
  return [...map.values()]
}

/** Stable id for one turn-boundary checkpoint. */
export function checkpointId(sessionId: string, turn: number, seq: number): string {
  return `${sessionId}:${turn}:${seq}`
}

/** Empty in-memory session fold. */
export function emptyState(sessionId: string, cwd: string): SessionState {
  return {
    sessionId,
    cwd,
    sessionStartHead: null,
    baseline: {},
    checkpoints: [],
    intentKeys: [],
    openTurn: null,
    rewoundTo: null,
    seqCursor: 0,
  }
}

/** First-seen wins; later observations do not clobber the baseline. */
export function rememberBaseline(state: SessionState, entry: BaselineEntry): SessionState {
  if (state.baseline[entry.targetKey] !== undefined) return state
  let next: SessionState = {
    ...state,
    baseline: { ...state.baseline, [entry.targetKey]: entry },
  }
  const originIndex = next.checkpoints.findIndex((item) => item.turn === 0)
  if (originIndex !== -1) {
    const origin = next.checkpoints[originIndex]!
    if (!origin.tree.some((item) => item.targetKey === entry.targetKey)) {
      const checkpoints = [...next.checkpoints]
      checkpoints[originIndex] = { ...origin, tree: [...origin.tree, { ...entry }] }
      next = { ...next, checkpoints }
    }
  }
  return next
}

/** Session-start restore point: rewind here undoes every later file mutation. */
export function ensureOriginCheckpoint(state: SessionState, now: number): SessionState {
  if (state.checkpoints.some((item) => item.turn === 0)) return state
  const origin: Checkpoint = {
    id: checkpointId(state.sessionId, 0, 0),
    sessionId: state.sessionId,
    turn: 0,
    seq: 0,
    time: now,
    tree: Object.values(state.baseline),
    head: state.sessionStartHead,
  }
  return {
    ...state,
    checkpoints: [origin, ...state.checkpoints],
  }
}

/** Record a path the fs tools touched (not git-discovered names). */
export function rememberIntent(state: SessionState, targetKey: string): SessionState {
  if (state.intentKeys.includes(targetKey)) return state
  return { ...state, intentKeys: [...state.intentKeys, targetKey] }
}

export function setOpenTurn(state: SessionState, openTurn: number | null): SessionState {
  return { ...state, openTurn }
}

export function setSessionStartHead(state: SessionState, head: SessionState['sessionStartHead']): SessionState {
  if (state.sessionStartHead !== null) return state
  return { ...state, sessionStartHead: head }
}

export function appendCheckpoint(state: SessionState, checkpoint: Checkpoint): SessionState {
  return {
    ...state,
    checkpoints: [...state.checkpoints, checkpoint],
    seqCursor: Math.max(state.seqCursor, checkpoint.seq),
  }
}

/**
 * After rewind, later checkpoints drop off the current generation.
 * New work appends on the restored tail.
 */
export function truncateAfter(state: SessionState, id: string): SessionState {
  const index = state.checkpoints.findIndex((item) => item.id === id)
  if (index === -1) return state
  return {
    ...state,
    checkpoints: state.checkpoints.slice(0, index + 1),
    openTurn: null,
    rewoundTo: id,
  }
}

/** Move a truncated fold onto a forked session id (checkpoint ids include the session). */
export function rehomeState(state: SessionState, nextId: string): SessionState {
  const checkpoints = state.checkpoints.map((item) => ({
    ...item,
    id: checkpointId(nextId, item.turn, item.seq),
    sessionId: nextId,
  }))
  const previous = state.rewoundTo === null ? undefined : state.checkpoints.find((item) => item.id === state.rewoundTo)
  return {
    ...state,
    sessionId: nextId,
    checkpoints,
    rewoundTo: previous === undefined ? null : checkpointId(nextId, previous.turn, previous.seq),
  }
}

export function findCheckpoint(state: SessionState, id: string): Checkpoint | undefined {
  return state.checkpoints.find((item) => item.id === id)
}

/** Rail projection: one row per checkpoint, caller decides sort. */
export function listItems(state: SessionState): CheckpointListItem[] {
  return state.checkpoints.map((item) => ({
    id: item.id,
    turn: item.turn,
    seq: item.seq,
    time: item.time,
    fileCount: item.tree.length,
    head: item.head,
    promptPreview: item.promptPreview === undefined || item.promptPreview === null
      ? null
      : capPrompt(item.promptPreview),
    promptTooltip: promptTooltip(item.promptPreview ?? null),
  }))
}

/**
 * Every session-touched path that must be removed to match the restore
 * target: later checkpoint trees plus intent keys never present (or
 * present as missing) on the effective overlay. Captures files created
 * after the target even when a later snapshot missed them.
 */
export function rewindDeletes(state: SessionState, checkpointId: string): string[] {
  const checkpoint = state.checkpoints.find((item) => item.id === checkpointId)
  if (checkpoint === undefined) return []
  const keep = new Set(
    overlayTree(state.baseline, checkpoint.tree)
      .filter((entry) => entry.kind !== 'missing')
      .map((entry) => entry.targetKey),
  )
  const extra = new Set<string>()
  for (const key of state.intentKeys) {
    if (!keep.has(key)) extra.add(key)
  }
  for (const item of state.checkpoints) {
    for (const entry of item.tree) {
      if (!keep.has(entry.targetKey)) extra.add(entry.targetKey)
    }
  }
  return [...extra]
}
