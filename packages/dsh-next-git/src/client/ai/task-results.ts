import type {
  ISessions, SessionBinding, SessionEventWindow, SessionReference, SessionRetainOptions, SessionTarget,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    dshNextGitTaskResults: unknown
  }
}

export type AiTaskPhase = 'queued' | 'running' | 'needs-review' | 'failed' | 'cancelled' | 'unknown'
export type AiTaskResultReason = 'history-missing' | 'history-truncated' | 'cwd-mismatch'
  | 'target-unavailable' | 'subscription-failed' | 'no-final-text' | 'incomplete-output'
  | 'turn-failed' | 'turn-cancelled' | 'unsupported-outcome' | 'ambiguous-history'

/** Captured chooser facts plus the exact successful SessionDelivery receipt. No prompt text. */
export interface AiTaskAdmission {
  readonly accepted: true
  readonly sourceSessionId: SessionId
  readonly targetSessionId: SessionId
  readonly requestId: SessionRequestId
  readonly verb: string
  readonly root: string
  readonly cwd: string
  readonly fingerprint: string
}

export interface AiTaskRecord extends AiTaskAdmission {
  readonly phase: AiTaskPhase
  readonly turns: readonly number[]
  /** Only the last durable, non-interrupted assistant message of completed correlated turns. */
  readonly finalAssistantText: string | null
  readonly textTruncated: boolean
  /** Explicit adoption must also compare root/fingerprint with current Git state. */
  readonly canUseMessage: boolean
  readonly reason: AiTaskResultReason | null
}

export interface AiTaskResultsSnapshot {
  readonly records: readonly AiTaskRecord[]
  readonly recordsTruncated: boolean
  readonly storage: 'available' | 'unavailable' | 'disabled'
}

export type AiTaskResultStorage = Pick<Storage, 'getItem' | 'setItem'>
type ObservedReference = Pick<SessionReference, 'release'> & {
  readonly ready: Promise<Pick<SessionBinding, 'eventSource'>>
}
export interface AiTaskResultsDependencies {
  readonly sessions: Pick<ISessions, 'list'> & {
    retain(target: SessionTarget, options: SessionRetainOptions): ObservedReference
  }
  readonly sourceSessionId: SessionId
  /** Active checkout, not workspace label or repository common directory. */
  readonly root: string
  /** Omit for guarded sessionStorage; null disables persistence. */
  readonly storage?: AiTaskResultStorage | null
  readonly maxRecords?: number
  readonly maxTextChars?: number
}
export interface AiTaskResults {
  /** Idempotent by destination + request ID; conflicting metadata is rejected. */
  admit(input: AiTaskAdmission): AiTaskRecord
  getSnapshot(): AiTaskResultsSnapshot
  /** Unsubscribing a pane does NOT release task ownership. */
  subscribe(listener: () => void): () => void
  /** Root/plugin lifetime only, not source-pane unmount. Does not cancel Host work. */
  dispose(): void
}

const MAX_RECORDS = 40
const MAX_TEXT = 16_384
const MAX_METADATA = 4_096
const MAX_STORED_CHARS = 2_000_000
const phases: readonly AiTaskPhase[] = ['queued', 'running', 'needs-review', 'failed', 'cancelled', 'unknown']
const reasons: readonly AiTaskResultReason[] = ['history-missing', 'history-truncated', 'cwd-mismatch',
  'target-unavailable', 'subscription-failed', 'no-final-text', 'incomplete-output', 'turn-failed',
  'turn-cancelled', 'unsupported-outcome', 'ambiguous-history']
const terminal = (phase: AiTaskPhase): boolean => phase === 'needs-review' || phase === 'failed' || phase === 'cancelled'
const keyOf = (record: AiTaskAdmission): string => JSON.stringify([record.targetSessionId, record.requestId])
const boundedString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_METADATA
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function limit(value: number | undefined, maximum: number): number {
  return value === undefined || !Number.isFinite(value) ? maximum : Math.max(1, Math.min(maximum, Math.floor(value)))
}
function admission(value: unknown): value is AiTaskAdmission {
  return object(value) && value.accepted === true && ['sourceSessionId', 'targetSessionId', 'requestId', 'verb', 'root', 'cwd', 'fingerprint']
    .every(field => boundedString(value[field]))
}
function storedRecord(value: unknown): value is AiTaskRecord {
  return admission(value) && object(value) && phases.some(phase => phase === value.phase)
    && (value.reason === null || reasons.some(reason => reason === value.reason))
    && Array.isArray(value.turns) && value.turns.length <= MAX_RECORDS
    && value.turns.every(turn => Number.isSafeInteger(turn) && turn >= 0)
    && (value.finalAssistantText === null || typeof value.finalAssistantText === 'string')
    && typeof value.textTruncated === 'boolean' && typeof value.canUseMessage === 'boolean'
}
function freeze(record: AiTaskRecord): AiTaskRecord {
  return Object.freeze({ ...record, turns: Object.freeze([...record.turns]) })
}

interface FoldedTurn {
  readonly turn: number
  readonly start: number
  matchedAt?: number
  assistant?: SessionEvent<'assistant/message'>
  end?: SessionEvent<'turn/end'>
  attemptAfterMessage: boolean
  requests: Set<string>
}
type Result = Pick<AiTaskRecord, 'phase' | 'turns' | 'finalAssistantText' | 'textTruncated' | 'canUseMessage' | 'reason'>
function unknown(reason: AiTaskResultReason, turns: readonly number[] = []): Result {
  return { phase: 'unknown', turns, finalAssistantText: null, textTruncated: false, canUseMessage: false, reason }
}

/** Re-fold the contiguous window: replacement never inherits an old turn association. */
function fold(window: SessionEventWindow, requestId: SessionRequestId, fresh: boolean, textLimit: number): Result {
  const turns: FoldedTurn[] = []
  let current: FoldedTurn | undefined
  let ambiguous = false
  let unpositioned = false
  const seen = new Set<number>()
  for (const entry of window.entries) {
    if (entry.type !== 'event') continue // Streaming chunks and failed attempts are never adoptable text.
    const event = entry.event
    if (seen.has(event.seq)) continue
    seen.add(event.seq)
    if (event.type === 'turn/start') {
      current = { turn: event.data.turn, start: event.seq, attemptAfterMessage: false, requests: new Set() }
      turns.push(current)
    } else if (event.type === 'user/message') {
      const source = event.data.source
      if (source.kind !== 'user') continue
      if (current) current.requests.add('rpcId' in source && typeof source.rpcId === 'string' ? source.rpcId : 'unidentified')
      if (!('rpcId' in source) || source.rpcId !== requestId) continue
      if (!current || event.surfaceOp !== 'append') { unpositioned = true; continue }
      current.matchedAt ??= event.seq
    } else if (event.type === 'assistant/message' && current?.turn === event.data.turn) {
      current.assistant = event
      current.attemptAfterMessage = false
    } else if (event.type === 'assistant/attempt' && current?.turn === event.data.turn) {
      current.attemptAfterMessage = true
    } else if (event.type === 'turn/end') {
      if (current?.turn === event.data.turn) current.end = event
      current = undefined
    }
  }
  const matched = turns.filter(turn => turn.matchedAt !== undefined)
  const ids = matched.map(turn => turn.turn)
  ambiguous = ids.length > 1 || matched.some(turn => turn.requests.size !== 1)
  if (ambiguous) return unknown('ambiguous-history')
  if (unpositioned) return unknown(window.hasMore ? 'history-truncated' : 'ambiguous-history', ids)
  if (!matched.length) return fresh
    ? { ...unknown('history-missing'), phase: 'queued', reason: null }
    : unknown(window.hasMore ? 'history-truncated' : 'history-missing')
  const base = { turns: ids, finalAssistantText: null, textTruncated: false, canUseMessage: false }
  for (const turn of matched) {
    const kind = turn.end?.data.reason.kind
    if (kind === 'aborted') return { ...base, phase: 'cancelled', reason: 'turn-cancelled' }
    if (kind === 'error' || kind === 'blocked' || kind === 'interrupted') return { ...base, phase: 'failed', reason: 'turn-failed' }
    if (kind === 'max-tokens') return unknown('incomplete-output', ids)
    if (kind !== undefined && kind !== 'completed') return unknown('unsupported-outcome', ids)
  }
  if (matched.some(turn => !turn.end)) return { ...base, phase: 'running', reason: null }
  const last = matched[matched.length - 1]
  const assistant = last.assistant
  if (!assistant || assistant.seq <= last.matchedAt! || last.attemptAfterMessage) return unknown('no-final-text', ids)
  if (assistant.data.interrupted || assistant.surfaceOp !== 'append'
    || assistant.data.message.content.some(block => block.type === 'tool-call')) return unknown('incomplete-output', ids)
  // Exclude reasoning, tools, provider metadata, raw streams, and all intermediate messages.
  const text = assistant.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
  if (!text.trim()) return unknown('no-final-text', ids)
  const textTruncated = text.length > textLimit
  return { phase: 'needs-review', turns: ids, finalAssistantText: text.slice(0, textLimit), textTruncated,
    canUseMessage: !textTruncated, reason: null }
}

/**
 * Create once per source-session/checkout at plugin lifetime. It observes only already-admitted
 * work: never creates a Session, sends a prompt, navigates, or mutates Git. A completed model
 * turn means needs-review, NOT verified Git success. Uncorrelated continuation rounds are ignored.
 */
export function createAiTaskResults(deps: AiTaskResultsDependencies): AiTaskResults {
  const { sessions, sourceSessionId, root } = deps
  if (!boundedString(sourceSessionId) || !boundedString(root)) throw new Error('invalid-task-scope')
  const recordLimit = limit(deps.maxRecords, MAX_RECORDS)
  const textLimit = limit(deps.maxTextChars, MAX_TEXT)
  const storageKey = 'dsh-next-git:ai-task-results:v1:' + JSON.stringify([sourceSessionId, root])
  let storage: AiTaskResultStorage | null = null
  let storageState: AiTaskResultsSnapshot['storage'] = 'disabled'
  try {
    storage = deps.storage === undefined ? globalThis.sessionStorage ?? null : deps.storage
    storageState = storage ? 'available' : 'disabled'
  } catch { storageState = 'unavailable' }
  const records = new Map<string, AiTaskRecord>()
  const watchers = new Map<string, () => void>()
  const listeners = new Set<() => void>()
  let recordsTruncated = false
  let disposed = false
  let snapshot: AiTaskResultsSnapshot

  function publish(): void {
    if (storage) {
      try { storage.setItem(storageKey, JSON.stringify({ version: 1, records: [...records.values()], recordsTruncated })) }
      catch { storageState = 'unavailable' }
    }
    snapshot = Object.freeze({ records: Object.freeze([...records.values()]), recordsTruncated, storage: storageState })
    for (const listener of listeners) {
      try { listener() } catch { /* A view cannot break ownership or other subscribers. */ }
    }
  }
  function trim(): void {
    while (records.size > recordLimit) {
      const key = records.keys().next().value!
      watchers.get(key)?.()
      records.delete(key)
      recordsTruncated = true
    }
  }
  function replace(key: string, result: Result): void {
    const previous = records.get(key)
    if (!previous || disposed) return
    const record = freeze({ ...previous, ...result })
    if (terminal(record.phase)) watchers.get(key)?.()
    if (JSON.stringify(record) === JSON.stringify(previous)) return
    records.set(key, record)
    publish()
  }
  function watch(key: string, fresh: boolean): void {
    const record = records.get(key)!
    if (disposed || terminal(record.phase) || watchers.has(key)) return
    const controller = new AbortController()
    let reference: ObservedReference | undefined
    let unsubscribeEvents: (() => void) | undefined
    let unsubscribeList: (() => void) | undefined
    let stopped = false
    const stop = (): void => {
      if (stopped) return
      stopped = true
      watchers.delete(key)
      controller.abort()
      for (const cleanup of [unsubscribeEvents, unsubscribeList, () => reference?.release()]) {
        try { cleanup?.() } catch { /* Best-effort teardown must release the remaining owners. */ }
      }
    }
    watchers.set(key, stop)
    const checkPath = (): boolean => {
      const row = sessions.list.getSnapshot().byId[record.targetSessionId]
      if (row?.cwd === record.cwd) return true
      replace(key, unknown(row?.cwd ? 'cwd-mismatch' : 'target-unavailable'))
      stop()
      return false
    }
    try {
      if (!sessions.list.getSnapshot().byId[record.targetSessionId]?.cwd) {
        unsubscribeList = sessions.list.subscribe(() => {
          if (stopped || !sessions.list.getSnapshot().byId[record.targetSessionId]?.cwd) return
          stop(); watch(key, fresh)
        })
        return
      }
      if (!checkPath()) return
      reference = sessions.retain(record.targetSessionId, { source: 'dshNextGitTaskResults', signal: controller.signal })
      unsubscribeList = sessions.list.subscribe(() => { if (!stopped) checkPath() })
      void reference.ready.then(binding => {
        if (disposed || stopped || !checkPath()) return
        const source = binding.eventSource
        let revision = -1
        let initial = true
        const observe = (): void => {
          if (disposed || stopped) return
          const window = source.getSnapshot()
          if (revision === window.revision) return
          revision = window.revision
          // Only the first fresh-admission baseline and subsequent appends may remain queued.
          if (!initial && window.change.kind === 'replace') fresh = false
          initial = false
          replace(key, fold(window, record.requestId, fresh, textLimit))
        }
        unsubscribeEvents = source.subscribe(observe)
        observe()
      }).catch(() => { if (!stopped && !disposed) { replace(key, unknown('subscription-failed')); stop() } })
    } catch { replace(key, unknown('subscription-failed')); stop() }
  }

  if (storage) {
    try {
      const raw = storage.getItem(storageKey)
      if (raw && raw.length > MAX_STORED_CHARS) throw new Error('stored-tasks-too-large')
      const saved: unknown = raw ? JSON.parse(raw) : null
      if (object(saved) && saved.version === 1 && Array.isArray(saved.records)) {
        recordsTruncated = saved.recordsTruncated === true
        for (const value of saved.records) {
          if (!storedRecord(value) || value.sourceSessionId !== sourceSessionId || value.root !== root) continue
          const text = value.finalAssistantText
          const textTruncated = value.textTruncated || (text !== null && text.length > textLimit)
          // Only validated fields survive storage; never retain arbitrary stored properties.
          const record: AiTaskRecord = { accepted: true, sourceSessionId, root, targetSessionId: value.targetSessionId,
            requestId: value.requestId, verb: value.verb, cwd: value.cwd, fingerprint: value.fingerprint, phase: value.phase,
            turns: value.turns, finalAssistantText: value.phase === 'needs-review' ? text?.slice(0, textLimit) ?? null : null,
            textTruncated, canUseMessage: value.phase === 'needs-review' && !!text?.trim() && !textTruncated,
            reason: value.reason }
          records.set(keyOf(record), freeze(record))
          trim()
        }
      }
    } catch { storageState = 'unavailable' }
  }
  publish()
  for (const key of records.keys()) watch(key, false)

  return {
    admit(input) {
      if (disposed) throw new Error('task-results-disposed')
      if (!admission(input) || input.sourceSessionId !== sourceSessionId || input.root !== root) throw new Error('invalid-task-admission')
      const key = keyOf(input)
      const previous = records.get(key)
      if (previous) {
        if (previous.verb !== input.verb || previous.fingerprint !== input.fingerprint) throw new Error('conflicting-task-admission')
        return previous
      }
      const record = freeze({ accepted: true, sourceSessionId, root, targetSessionId: input.targetSessionId,
        requestId: input.requestId, verb: input.verb, cwd: input.cwd, fingerprint: input.fingerprint,
        phase: 'queued', turns: [], finalAssistantText: null, textTruncated: false, canUseMessage: false, reason: null })
      records.set(key, record)
      trim()
      publish()
      watch(key, true)
      return records.get(key)!
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const stop of [...watchers.values()]) stop()
      listeners.clear()
    },
  }
}
