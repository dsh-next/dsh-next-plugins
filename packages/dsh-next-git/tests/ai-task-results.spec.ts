import { describe, expect, it, vi } from 'vitest'
import type { SessionEventLikeEntry, SessionEventWindow, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createAiTaskResults, type AiTaskAdmission, type AiTaskResultsDependencies } from '../src/client/ai/task-results.ts'

const sourceId = 'source' as SessionId, targetId = 'target' as SessionId
const admission: AiTaskAdmission = { accepted: true, sourceSessionId: sourceId, targetSessionId: targetId, requestId: 'request' as SessionRequestId, root: '/repo', cwd: '/repo/src', verb: 'draft', fingerprint: 'fingerprint' }
function events(request = 'request', reason = 'completed', text = 'feat: result', extras: SessionEventLikeEntry[] = []): SessionEventLikeEntry[] {
  return [event('turn/start', { turn: 1 }, 1), event('user/message', { role: 'user', source: { kind: 'user', rpcId: request }, content: [] }, 2), ...extras,
    event('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text }] }, stream: [] }, 20),
    event('turn/end', { turn: 1, reason: { kind: reason } }, 21)]
}
function event(type: string, data: unknown, seq: number): SessionEventLikeEntry {
  return { type: 'event', event: { type, data, seq, time: 0, surfaceOp: 'append' } } as SessionEventLikeEntry
}
function fixture(options: { more?: boolean; pending?: boolean; maxRecords?: number; maxTextChars?: number; storage?: AiTaskResultsDependencies['storage'] } = {}) {
  let window: SessionEventWindow = { entries: [], revision: 0, hasMore: options.more ?? false, change: { kind: 'replace', entries: [] } }
  const watchers = new Set<() => void>(), lists = new Set<() => void>()
  const release = vi.fn()
  let cwd = admission.cwd
  let ready!: (value: { eventSource: typeof eventSource }) => void
  const eventSource = { getSnapshot: () => window, subscribe: (fn: () => void) => { watchers.add(fn); return () => { watchers.delete(fn) } } }
  const retained = vi.fn(() => ({ release, ready: options.pending ? new Promise<{ eventSource: typeof eventSource }>(resolve => { ready = resolve }) : Promise.resolve({ eventSource }) }))
  const sessions: AiTaskResultsDependencies['sessions'] = { retain: retained,
    list: { getSnapshot: () => ({ byId: { [targetId]: { id: targetId, cwd } } } as unknown as SessionListState), subscribe: (fn: () => void) => { lists.add(fn); return () => { lists.delete(fn) } } },
  }
  const deps: AiTaskResultsDependencies = { sessions, sourceSessionId: sourceId, root: '/repo', storage: options.storage ?? null, maxRecords: options.maxRecords, maxTextChars: options.maxTextChars }
  const store = createAiTaskResults(deps)
  const emit = async (entries: SessionEventLikeEntry[], more = false): Promise<void> => {
    window = { entries, revision: window.revision + 1, hasMore: more, change: { kind: 'append', entries } }
    for (const notify of [...watchers]) notify()
    await Promise.resolve()
  }
  return { store, deps, release, retained, watchers, lists, emit, ready: () => ready({ eventSource }), move: (path: string) => { cwd = path; for (const fn of [...lists]) fn() } }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('exact-request AI results', () => {
  it('keeps a fresh request queued through unrelated turns and adopts only its final visible text', async () => {
    const f = fixture({ more: true })
    f.store.admit(admission); await tick()
    expect(f.store.getSnapshot().records[0]!.phase).toBe('queued')
    await f.emit(events('unrelated'))
    expect(f.store.getSnapshot().records[0]!.phase).toBe('queued')
    await f.emit(events())
    expect(f.store.getSnapshot().records[0]).toMatchObject({ phase: 'needs-review', finalAssistantText: 'feat: result', canUseMessage: true })
    expect(JSON.stringify(f.store.getSnapshot())).not.toContain('private reasoning')
    expect(f.release).toHaveBeenCalledOnce()
    f.store.dispose()
  })

  it('does not attribute a batched multi-request answer to one request', async () => {
    const f = fixture(); f.store.admit(admission); await tick()
    await f.emit(events('request', 'completed', 'combined answer', [event('user/message', { source: { kind: 'user', rpcId: 'other' }, content: [] }, 3)]))
    expect(f.store.getSnapshot().records[0]).toMatchObject({ phase: 'unknown', reason: 'ambiguous-history', finalAssistantText: null, canUseMessage: false })
    f.store.dispose()
  })

  it.each([['error', 'failed'], ['aborted', 'cancelled'], ['max-tokens', 'unknown'], ['blocked', 'failed']])('never adopts a %s outcome', async (reason, phase) => {
    const f = fixture(); f.store.admit(admission); await tick()
    await f.emit(events('request', reason, 'partial output'))
    expect(f.store.getSnapshot().records[0]).toMatchObject({ phase, finalAssistantText: null, canUseMessage: false })
    f.store.dispose()
  })

  it('requires a turn boundary and can recover when complete correlated history arrives', async () => {
    const f = fixture(); f.store.admit(admission); await tick()
    await f.emit(events().slice(1), true)
    expect(f.store.getSnapshot().records[0].phase).toBe('unknown')
    await f.emit(events())
    expect(f.store.getSnapshot().records[0].phase).toBe('needs-review')
    f.store.dispose()
  })

  it('refuses repeated request IDs across different turns', async () => {
    const f = fixture(); f.store.admit(admission); await tick()
    const second = events().map(entry => entry.type === 'event' ? { ...entry, event: { ...entry.event, seq: entry.event.seq + 100, data: { ...entry.event.data, turn: 2 } } } as SessionEventLikeEntry : entry)
    await f.emit([...events(), ...second])
    expect(f.store.getSnapshot().records[0].reason).toBe('ambiguous-history')
    f.store.dispose()
  })

  it('handles nested cwd exactly and stops when target switches checkout', async () => {
    const f = fixture(); f.store.admit(admission); await tick()
    expect(f.retained).toHaveBeenCalledOnce()
    f.move('/different')
    await f.emit(events())
    expect(f.store.getSnapshot().records[0]).toMatchObject({ phase: 'unknown', reason: 'cwd-mismatch', canUseMessage: false })
    expect(f.release).toHaveBeenCalledOnce()
    f.store.dispose()
  })

  it('keeps task ownership after the source view unsubscribes and releases pending ready on dispose', async () => {
    const f = fixture({ pending: true }); f.store.admit(admission)
    const listener = vi.fn(), off = f.store.subscribe(listener); off()
    expect(f.release).not.toHaveBeenCalled()
    f.store.dispose(); f.ready(); await tick()
    expect(f.release).toHaveBeenCalledOnce()
    expect(f.watchers.size).toBe(0)
    expect(listener).not.toHaveBeenCalled()
  })

  it('persists bounded results, flags clipping, and isolates source/root scopes', async () => {
    const memory = new Map<string, string>()
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
    const f = fixture({ storage, maxTextChars: 4 }); f.store.admit(admission); await tick()
    await f.emit(events())
    expect(f.store.getSnapshot().records[0]).toMatchObject({ textTruncated: true, canUseMessage: false, finalAssistantText: 'feat' })
    f.store.dispose()
    const restored = createAiTaskResults(f.deps)
    expect(restored.getSnapshot().records[0].finalAssistantText).toBe('feat')
    restored.dispose()
    const other = createAiTaskResults({ ...f.deps, root: '/other' })
    expect(other.getSnapshot().records).toEqual([]); other.dispose()
  })

  it('deduplicates admissions, rejects mismatches and bounds record retention', async () => {
    const f = fixture({ maxRecords: 2 })
    const first = f.store.admit(admission)
    expect(f.store.admit(admission)).toBe(first)
    expect(() => f.store.admit({ ...admission, fingerprint: 'different' })).toThrow('conflicting-task-admission')
    expect(() => f.store.admit({ ...admission, root: '/wrong' })).toThrow('invalid-task-admission')
    f.store.admit({ ...admission, requestId: 'second' as SessionRequestId })
    f.store.admit({ ...admission, requestId: 'third' as SessionRequestId })
    expect(f.store.getSnapshot().records).toHaveLength(2)
    expect(f.store.getSnapshot().recordsTruncated).toBe(true)
    f.store.dispose()
    expect(() => f.store.admit(admission)).toThrow('task-results-disposed')
  })

  it('tolerates storage failure without losing observed results', async () => {
    const f = fixture({ storage: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } } })
    f.store.admit(admission); await tick(); await f.emit(events())
    expect(f.store.getSnapshot()).toMatchObject({ storage: 'unavailable', records: [expect.objectContaining({ phase: 'needs-review' })] })
    f.store.dispose()
  })
})
