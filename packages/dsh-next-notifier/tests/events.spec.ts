import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, type Events } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, SessionId, SessionSeq, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { GoalChanged } from '@deepseek-ai/dsh-goal'
import type { SubagentRunId, SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent'
import type { AskUserQuestionRequestEvent, AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/types'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { normalizeConfig } from '../src/core/config.ts'
import type { NotificationEvent } from '../src/core/notifications.ts'
import { wireEvents } from '../src/host/events.ts'

type EventName = 'agent/status' | 'agent/created' | 'agent/disposed' | 'session/event' | 'subagent/start' | 'subagent/end' | 'goal/changed' | 'approval/request' | 'user-questions/request'
function agent(id = 'main', header: Partial<Session['header']> = {}) {
  // Deliberately minimal SDK fixtures: these tests never run an Agent driver.
  return { session: { id: id as SessionId, header } as Session, status: 'running' } as Agent
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness(withGoals = true) {
  const listeners: Partial<{ [K in EventName]: OmitThisParameter<Events[K]> }> = {}
  const on = vi.fn((name: EventName, listener: Events[EventName]) => {
    Object.assign(listeners, { [name]: listener })
    return () => { delete listeners[name] }
  })
  const config = normalizeConfig(null)
  const views = new Map<Agent, { phase: string; activation: string }>()
  const published: NotificationEvent[] = []
  const queued = new Set<NotificationEvent>()
  const publish = vi.fn((event: NotificationEvent): (() => void) => {
    published.push(event)
    queued.add(event)
    return vi.fn(() => { queued.delete(event) })
  })
  const ctx = Object.assign(new Context(), { on })
  const dispose = wireEvents({
    ctx,
    config: () => config,
    goals: withGoals ? { get: a => views.get(a) } : undefined,
    timer: {
      timeout: (callback, delay) => { const id = setTimeout(callback, delay); return () => clearTimeout(id) },
      interval: (callback, delay) => { const id = setInterval(callback, delay); return () => clearInterval(id) },
    },
    publish,
  })
  function emit<K extends EventName>(name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]> {
    const listener = listeners[name] as ((...args: Parameters<Events[K]>) => ReturnType<Events[K]>) | undefined
    return listener?.(...args) as ReturnType<Events[K]>
  }
  function status(a: Agent, status: Agent['status']) {
    Object.assign(a, { status })
    emit('agent/status', { agent: a, status })
  }
  function start(a: Agent, turn = 1) {
    const event: SessionEvent<'turn/start'> = { type: 'turn/start', seq: 9 as SessionSeq, time: 0, data: { turn } }
    emit('session/event', a.session, event)
  }
  function end(a: Agent, reason: TurnEndReason = { kind: 'completed' }, turn = 1) {
    const event: SessionEvent<'turn/end'> = { type: 'turn/end', seq: turn as SessionSeq, time: 0, data: { turn, reason } }
    emit('session/event', a.session, event)
  }
  function goal(a: Agent, operation: 'complete' | 'block' | 'resume' | 'pause' | 'clear', revision = 1) {
    emit('goal/changed', { agent: a, change: { operation, ref: { id: 'g' as GoalChanged['ref']['id'], revision } } })
  }
  function childEnd(a: Agent, stopReason: SubagentRunEndInfo['stopReason'] = 'completed', run = 'r1') {
    emit('subagent/end', { id: a.session.id, runId: run as SubagentRunId, provider: 'local', local: true, stopReason })
  }
  function question(a: Agent | undefined, signal = new AbortController().signal): AskUserQuestionRequestEvent {
    return { agent: a, signal, questions: [{ id: 'q', question: 'Proceed?' }] }
  }
  return { ctx, emit, status, start, end, goal, childEnd, question, config, views, published, queued, publish, dispose, listeners, on }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('terminal event lifecycle', () => {
  it('wires synchronously and requires a completed turn, idle, then two seconds', () => {
    const h = harness(); const a = agent()
    expect(h.on.mock.calls.length).toBeGreaterThanOrEqual(6)
    h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published).toEqual([])
    h.status(a, 'running'); h.end(a); vi.advanceTimersByTime(5000)
    expect(h.published).toEqual([])
    h.status(a, 'idle'); vi.advanceTimersByTime(1999)
    expect(h.published).toEqual([])
    vi.advanceTimersByTime(1)
    expect(h.published).toEqual([{ kind: 'finished', group: 'finished', title: 'Agent finished', body: 'Agent finished its turn.', sessionId: 'main' }])
    h.status(a, 'idle'); h.end(a); vi.advanceTimersByTime(2000)
    expect(h.published).toHaveLength(1)
  })

  it.each([1, 99])('accepts real turn one after earlier marker turn %s and suppresses duplicate ends', priorTurn => {
    const h = harness(); const a = agent()
    h.status(a, 'idle'); h.end(a, { kind: 'completed' }, priorTurn)
    vi.advanceTimersByTime(2000)
    h.status(a, 'running'); h.start(a, 1)
    const reason: TurnEndReason = { kind: 'error', error: { message: 'Authentication failed', code: 'AUTH', status: 401 } }
    h.end(a, reason, 1); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published.map(e => e.kind)).toEqual(['finished', 'error'])
    h.end(a, reason, 1); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published.map(e => e.kind)).toEqual(['finished', 'error'])
  })

  it('resets turn dedup and stale goal suppression while the driver remains running', () => {
    const h = harness(); const a = agent()
    h.status(a, 'running'); h.start(a, 4); h.goal(a, 'complete'); h.end(a, { kind: 'completed' }, 4)
    h.start(a, 1)
    h.end(a, { kind: 'error', error: { message: 'Authentication failed', code: 'AUTH', status: 401 } }, 1)
    h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published.map(e => e.kind)).toEqual(['error'])
  })

  it.each([0, 2000])('new turn start cancels its prior timer or queued notification, not another session (%sms)', elapsed => {
    const h = harness(); const a = agent('a'); const b = agent('b')
    for (const x of [a, b]) { h.status(x, 'idle'); h.end(x) }
    vi.advanceTimersByTime(elapsed)
    Object.assign(a, { status: 'running' }); h.start(a, 1)
    vi.advanceTimersByTime(2000)
    expect([...h.queued].map(e => e.sessionId)).toEqual(['b'])
    h.end(a, { kind: 'blocked' }, 1); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect([...h.queued].map(e => e.kind)).toEqual(['finished', 'blocked'])
  })

  it.each([{ origin: 'subagent' as const }, { delegationDepth: 1 }])('never calls a local child main finished: %j', header => {
    const h = harness(); const a = agent('child', header)
    h.status(a, 'running'); h.end(a); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published).toEqual([])
    h.childEnd(a); vi.advanceTimersByTime(2000)
    expect(h.published).toEqual([])
  })

  it('does not mistake a main-session fork for a delegated child', () => {
    const h = harness(); const a = agent('fork', { delegationDepth: 0 })
    h.status(a, 'running'); h.end(a); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published[0]?.kind).toBe('finished')
  })

  it.each(['error', 'blocked', 'max-tokens'] as const)('classifies %s distinctly using finished settings', kind => {
    const h = harness(); const a = agent()
    h.status(a, 'running')
    h.end(a, kind === 'error' ? { kind, error: { message: 'failed', code: 'UNKNOWN' } } : { kind })
    h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published[0]).toMatchObject({ kind, group: 'finished', sessionId: 'main' })
    expect(h.published[0]?.title).not.toBe('Agent finished')
  })

  it.each(['aborted', 'interrupted'] as const)('keeps %s quiet', kind => {
    const h = harness(); const a = agent()
    h.status(a, 'running'); h.end(a, kind === 'aborted' ? { kind, reason: { kind: 'disposed' } } : { kind })
    h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published).toEqual([])
  })

  it('isolates two agents and cancels only the agent that resumes', () => {
    const h = harness(); const a = agent('a'); const b = agent('b')
    for (const x of [a, b]) { h.status(x, 'running'); h.end(x); h.status(x, 'idle') }
    h.status(a, 'running'); vi.advanceTimersByTime(2000)
    expect(h.published.map(e => e.sessionId)).toEqual(['b'])
    h.end(a, { kind: 'completed' }, 2); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published.map(e => e.sessionId)).toEqual(['b', 'a'])
    h.status(a, 'running')
    expect([...h.queued].map(e => e.sessionId)).toEqual(['b'])
  })

  it('revalidates live status even without receiving a running event', () => {
    const h = harness(); const a = agent()
    h.end(a); h.status(a, 'idle'); Object.assign(a, { status: 'running' })
    vi.advanceTimersByTime(2000); expect(h.published).toEqual([])
  })

  it('cancels a disposed agent and supports a new runtime of its session', () => {
    const h = harness(); const a = agent()
    h.end(a); h.status(a, 'idle'); h.emit('agent/disposed', { agent: a })
    vi.advanceTimersByTime(2000); expect(h.published).toEqual([])
    const resumed = agent(); h.status(resumed, 'running'); h.end(resumed); h.status(resumed, 'idle')
    vi.advanceTimersByTime(2000); expect(h.published).toHaveLength(1)
  })
})

describe('goal and subagent canonical outcomes', () => {
  it.each(['complete', 'block'] as const)('emits goal %s only once after idle and suppresses ordinary end', operation => {
    const h = harness(); const a = agent()
    h.status(a, 'running'); h.goal(a, operation); h.goal(a, operation)
    vi.advanceTimersByTime(2000); expect(h.published).toEqual([])
    h.end(a); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    h.goal(a, operation); h.end(a); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published.map(e => e.kind)).toEqual([operation === 'complete' ? 'goal-complete' : 'goal-blocked'])
  })

  it('replaces an already queued ordinary finish with canonical goal completion', () => {
    const h = harness(); const a = agent()
    h.end(a); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    h.goal(a, 'complete'); vi.advanceTimersByTime(2000)
    expect([...h.queued].map(e => e.kind)).toEqual(['goal-complete'])
  })

  it.each([
    ['active', 'armed', true], ['active', 'disarmed', false], ['paused', 'armed', false],
    ['complete', 'armed', false], ['blocked', 'disarmed', false],
  ] as const)('suppression is exactly active+armed: %s %s', (phase, activation, quiet) => {
    const h = harness(); const a = agent()
    h.end(a); h.status(a, 'idle'); h.views.set(a, { phase, activation })
    vi.advanceTimersByTime(2000)
    expect(h.published).toHaveLength(quiet ? 0 : 1)
  })

  it('revalidates a canonical goal terminal against the live goal view', () => {
    const h = harness(); const a = agent()
    h.status(a, 'idle'); h.goal(a, 'complete')
    h.views.set(a, { phase: 'active', activation: 'armed' })
    vi.advanceTimersByTime(2000); expect(h.published).toEqual([])
  })

  it('allows ordinary completion with goals absent or goal-only disabled', () => {
    for (const withGoals of [false, true]) {
      const h = harness(withGoals); const a = agent()
      h.config.finished.goalOnly = false; h.views.set(a, { phase: 'active', activation: 'armed' })
      h.end(a); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
      expect(h.published).toHaveLength(1); h.dispose()
    }
  })

  it('resumes after a goal terminal without suppressing a later unrelated turn', () => {
    const h = harness(); const a = agent()
    h.goal(a, 'block'); h.end(a); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    h.goal(a, 'resume', 2); h.status(a, 'running'); h.end(a, { kind: 'completed' }, 2)
    h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published.map(e => e.kind)).toEqual(['goal-blocked', 'finished'])
  })

  it('ignores child goal terminals and rechecks subagent opt-in at delivery', () => {
    const h = harness(); const a = agent('child', { origin: 'subagent' })
    h.config.finished.subagent = true
    h.goal(a, 'complete'); h.status(a, 'idle'); vi.advanceTimersByTime(2000)
    expect(h.published).toEqual([])
    h.childEnd(a); h.config.finished.subagent = false; vi.advanceTimersByTime(2000)
    expect(h.published).toEqual([])
  })

  it('uses canonical opted-in child completion without a status duplicate', () => {
    const h = harness(); h.config.finished.subagent = true
    const a = agent('child', { origin: 'subagent' })
    h.status(a, 'running'); h.end(a); h.status(a, 'idle'); h.childEnd(a); h.childEnd(a)
    vi.advanceTimersByTime(2000)
    expect(h.published.map(e => e.kind)).toEqual(['subagent'])
  })

  it.each(['aborted', 'error', 'max-tokens', 'refusal'] as const)('handles opted-in child %s honestly', reason => {
    const h = harness(); h.config.finished.subagent = true; const a = agent('child', { origin: 'subagent' })
    h.childEnd(a, reason); vi.advanceTimersByTime(2000)
    expect(h.published.map(e => e.kind)).toEqual(reason === 'aborted' ? [] : [reason === 'refusal' ? 'blocked' : reason])
  })

  it('bounds detached child tombstones and cancels evicted pending notifications', () => {
    const h = harness(); h.config.finished.subagent = true
    for (let i = 0; i < 150; i++) h.childEnd(agent('child-' + i), 'completed', 'run-' + i)
    expect(vi.getTimerCount()).toBeLessThanOrEqual(100)
    vi.advanceTimersByTime(2000)
    expect(h.published).toHaveLength(100)
    expect(h.published[0]?.sessionId).toBe('child-50')
    h.dispose(); expect(vi.getTimerCount()).toBe(0); expect(h.queued.size).toBe(0)
  })

  it('preserves subagent opt-in identity on failure events for broker retries', () => {
    const h = harness(); h.config.finished.subagent = true
    h.childEnd(agent('child'), 'error'); vi.advanceTimersByTime(2000)
    expect(h.published[0]).toMatchObject({ kind: 'error', isSubagent: true })
  })

  it('cancels child completion when a new canonical run starts', () => {
    const h = harness(); h.config.finished.subagent = true; const a = agent('child')
    h.childEnd(a)
    h.emit('subagent/start', { id: a.session.id, runId: 'r2' as SubagentRunId, provider: 'remote', local: false })
    vi.advanceTimersByTime(2000); expect(h.published).toEqual([])
    h.childEnd(a, 'completed', 'r2'); vi.advanceTimersByTime(2000)
    expect(h.published).toHaveLength(1)
  })
})

describe('pending human requests', () => {
  // The published SDK ask() implementation validates live-root ownership before
  // emitting this waterfall. These tests target our observer, not upstream policy.

  it.each(['allowed-once', 'rejected', 'cancelled', 'unavailable'] as const)('does not alert for immediate approval %s', outcome => {
    const h = harness(); const a = agent()
    const result = h.emit('approval/request', { agent: a, toolName: 'bash' }, () => Promise.resolve(outcome))
    return result.then(value => {
      expect(value).toBe(outcome); vi.advanceTimersByTime(1000); expect(h.published).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  it.each(['approval', 'question'] as const)('delays pending %s and retracts queued notification on settlement', kind => {
    const h = harness(); const a = agent(); const approval = deferred<ApprovalOutcome>(); const question = deferred<AskUserQuestionAnswer>()
    const result = kind === 'approval'
      ? h.emit('approval/request', { agent: a, toolName: 'bash', reason: 'write' }, () => approval.promise)
      : h.emit('user-questions/request', h.question(a), () => question.promise)
    vi.advanceTimersByTime(199); expect(h.published).toEqual([])
    vi.advanceTimersByTime(1); expect(h.published[0]).toMatchObject({ kind, group: kind, sessionId: 'main' })
    const toolAnswer: AskUserQuestionAnswer = { answers: [] }
    const answer = kind === 'approval' ? 'allowed-once' : toolAnswer
    approval.resolve('allowed-once'); question.resolve(toolAnswer)
    return result.then(value => { expect(value).toBe(answer); expect(h.queued.size).toBe(0); expect(vi.getTimerCount()).toBe(0) })
  })

  it.each(['approval', 'question'] as const)('cancels pending %s on signal and removes abort listener', async kind => {
    const h = harness(); const a = agent(); const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = deferred<never>()
    const result = kind === 'approval'
      ? h.emit('approval/request', { agent: a, toolName: 'bash', signal: controller.signal }, () => pending.promise)
      : h.emit('user-questions/request', h.question(a, controller.signal), () => pending.promise)
    vi.advanceTimersByTime(200); expect(h.queued.size).toBe(1)
    controller.abort(); expect(h.queued.size).toBe(0)
    const failure = new Error('cancelled'); pending.reject(failure)
    await expect(result).rejects.toBe(failure)
    expect(remove).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })

  it('does not mistake resumed lineage for a currently delegated human request', async () => {
    const h = harness(); const a = agent('resumed', { origin: 'subagent' })
    const answer = deferred<AskUserQuestionAnswer>()
    const result = h.emit('user-questions/request', h.question(a), () => answer.promise)
    vi.advanceTimersByTime(200)
    expect(h.published[0]).toMatchObject({ kind: 'question', sessionId: 'resumed' })
    answer.resolve({ answers: [] }); await result
  })

  it('remains quiet when an answerer fails during the pending grace period', async () => {
    const h = harness(); const answer = deferred<AskUserQuestionAnswer>()
    const result = h.emit('user-questions/request', h.question(agent()), () => answer.promise)
    vi.advanceTimersByTime(100); const error = new Error('NO_PROVIDER'); answer.reject(error)
    await expect(result).rejects.toBe(error)
    vi.advanceTimersByTime(1000); expect(h.published).toEqual([])
  })

  it('preserves immediate human-answer rejection without an alert', async () => {
    const h = harness(); const a = agent(); const error = new Error('NO_PROVIDER')
    await expect(h.emit('user-questions/request', h.question(a), () => Promise.reject(error))).rejects.toBe(error)
    vi.advanceTimersByTime(1000); expect(h.published).toEqual([])
  })

  it('observes the actual human waterfall, not arbitrary tool executions', async () => {
    const h = harness(); const pending = deferred<AskUserQuestionAnswer>()
    expect(Object.keys(h.listeners)).not.toContain('tools/execute')
    const ownerless = h.emit('user-questions/request', h.question(undefined), () => pending.promise)
    expect(ownerless).toBe(pending.promise)
    vi.advanceTimersByTime(1000); expect(h.published).toEqual([])
    const value = { answers: [] }; pending.resolve(value)
    await expect(ownerless).resolves.toBe(value)
  })

  it.each(['approval', 'question'] as const)('never alerts for already-cancelled %s but still delegates', async kind => {
    const h = harness(); const a = agent(); const controller = new AbortController(); controller.abort()
    const next = vi.fn(() => Promise.reject(new Error('cancelled')))
    const result = kind === 'approval'
      ? h.emit('approval/request', { agent: a, toolName: 'bash', signal: controller.signal }, next)
      : h.emit('user-questions/request', h.question(a, controller.signal), next)
    await expect(result).rejects.toThrow('cancelled')
    expect(next).toHaveBeenCalledOnce(); vi.advanceTimersByTime(1000)
    expect(h.published).toEqual([]); expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps synchronous waterfall throws unchanged and does not create a timer', () => {
    const h = harness(); const failure = new Error('unavailable')
    expect(() => h.emit('user-questions/request', h.question(agent()), () => { throw failure })).toThrow(failure)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels only the disposed agent human request', async () => {
    const h = harness(); const a = agent('a'); const b = agent('b')
    const answer = deferred<AskUserQuestionAnswer>()
    const first = h.emit('user-questions/request', h.question(a), () => answer.promise)
    const second = h.emit('user-questions/request', h.question(b), () => answer.promise)
    h.emit('agent/disposed', { agent: a }); vi.advanceTimersByTime(200)
    expect(h.published.map(e => e.sessionId)).toEqual(['b'])
    answer.resolve({ answers: [] }); await Promise.all([first, second])
    expect(h.queued.size).toBe(0)
  })

  it('does not let publish or its disposer failures alter a human answer', async () => {
    const h = harness(); const answer = deferred<AskUserQuestionAnswer>()
    h.publish.mockImplementationOnce(() => { throw new Error('delivery failed') })
    const result = h.emit('user-questions/request', h.question(agent()), () => answer.promise)
    expect(() => vi.advanceTimersByTime(200)).not.toThrow()
    const value = { answers: [] }; answer.resolve(value); await expect(result).resolves.toBe(value)
    h.publish.mockImplementationOnce(() => () => { throw new Error('cleanup failed') })
    const second = deferred<ApprovalOutcome>()
    const approval = h.emit('approval/request', { agent: agent(), toolName: 'bash' }, () => second.promise)
    vi.advanceTimersByTime(200); second.resolve('allowed-once'); await expect(approval).resolves.toBe('allowed-once')
  })

  it('cleans a request even when delivery synchronously disposes the plugin', async () => {
    const h = harness(); const answer = deferred<AskUserQuestionAnswer>(); const retract = vi.fn()
    h.publish.mockImplementationOnce(() => { h.dispose(); return retract })
    const result = h.emit('user-questions/request', h.question(agent()), () => answer.promise)
    vi.advanceTimersByTime(200)
    expect(retract).toHaveBeenCalledOnce()
    answer.resolve({ answers: [] }); await result
  })

  it('disposes all timers, queued events, and synchronous listeners idempotently without aborting work', async () => {
    const h = harness(); const a = agent(); const controller = new AbortController(); const pending = deferred<ApprovalOutcome>()
    const result = h.emit('approval/request', { agent: a, toolName: 'bash', signal: controller.signal }, () => pending.promise)
    h.end(a); h.status(a, 'idle'); vi.advanceTimersByTime(200)
    h.dispose(); h.dispose()
    expect(Object.keys(h.listeners)).toEqual([]); expect(h.queued.size).toBe(0); expect(vi.getTimerCount()).toBe(0)
    expect(controller.signal.aborted).toBe(false)
    pending.resolve('allowed-once'); await expect(result).resolves.toBe('allowed-once')
    vi.advanceTimersByTime(5000); expect(h.published).toHaveLength(1)
  })
})
