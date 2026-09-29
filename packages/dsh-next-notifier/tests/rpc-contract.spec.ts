import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Notifier } from '../src/host/notifier.ts'
import { defaultConfig } from '../src/core/config.ts'
import type { ClientPresence } from '../src/core/notifications.ts'
import type { TimerLike } from '../src/core/timer.ts'

const timer: TimerLike = {
  timeout: (fn, delay) => { const id = setTimeout(fn, delay); return () => clearTimeout(id) },
  interval: (fn, delay) => { const id = setInterval(fn, delay); return () => clearInterval(id) },
}
const report = (overrides: Partial<ClientPresence> = {}): ClientPresence => ({ clientId: 'browser', sequence: 1,
  focused: true, visible: true, open: true, sessionId: 'viewed', permission: 'denied', ...overrides })
function makeNotifier() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const config = defaultConfig()
  const scope = { get: () => config } as never
  const get = vi.fn(() => undefined)
  const ctx = { get, on: (name: string, fn: (...args: never[]) => unknown) => {
    handlers.set(name, fn); return () => handlers.delete(name)
  } } as never
  const notifier = new Notifier({ ctx, scope, timer, goals: undefined })
  notifier.wire()
  const complete = (sessionId = 'agent') => {
    handlers.get('goal/changed')!({ agent: { status: 'idle', session: { id: sessionId, header: {} } },
      change: { operation: 'complete', ref: { id: 'goal-' + sessionId, revision: 1 } } } as never)
    vi.advanceTimersByTime(2000)
  }
  return { notifier, complete, config, handlers, get }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('host delivery contract', () => {
  it('returns config in an envelope, with client-specific permissions and catalog', () => {
    const { notifier } = makeNotifier()
    const state = notifier.state()
    expect(Object.keys(state).sort()).toEqual(['config', 'sounds', 'webPermission'])
    expect(state.config).toEqual(defaultConfig())
    expect(state).not.toHaveProperty('enabled')
    expect(state).not.toHaveProperty('volume')
    expect(state.webPermission).toBeNull()
    notifier.reportPresence(report())
    notifier.reportPresence(report({ clientId: 'other', permission: 'granted' }))
    expect(notifier.state('browser').webPermission).toBe('denied')
    expect(notifier.state('other').webPermission).toBe('granted')
    expect(state.sounds).toHaveLength(17)
    for (const sound of state.sounds) expect(Object.keys(sound).sort()).toEqual(['group', 'id', 'name'])
  })
  it('leases sound metadata to the receiving client and consumes each receipt once', () => {
    const { notifier, complete, get } = makeNotifier()
    notifier.reportPresence(report())
    complete()
    const [event] = notifier.claimPending('browser')
    expect(event).toMatchObject({ kind: 'goal-complete', sessionId: 'agent', id: expect.any(String),
      lease: expect.any(String) })
    expect(event).not.toHaveProperty('channel')
    const receipt = { clientId: 'browser', id: event.id, lease: event.lease }
    expect(notifier.acknowledge(receipt)).toEqual({ ok: true, sound: { id: 'chime', volume: 70 } })
    expect(notifier.acknowledge(receipt)).toEqual({ ok: false })
    expect(notifier.claimPending('browser')).toEqual([])
    expect(get).not.toHaveBeenCalledWith('subprocess')
  })
  it('retains an undeliverable background event for a foreground toast', () => {
    const { notifier, complete } = makeNotifier()
    notifier.reportPresence(report({ focused: false, visible: false }))
    complete()
    expect(notifier.claimPending('browser')).toEqual([])
    notifier.reportPresence(report({ sequence: 2 }))
    expect(notifier.claimPending('browser')).toHaveLength(1)
  })
  it('delivers in background with permission', () => {
    const { notifier, complete } = makeNotifier()
    notifier.reportPresence(report({ focused: false, visible: false, permission: 'granted' }))
    complete()
    expect(notifier.claimPending('browser')).toHaveLength(1)
  })
  it('suppresses the viewed session', () => {
    const { notifier, complete } = makeNotifier()
    notifier.reportPresence(report({ sessionId: 'agent' }))
    complete()
    expect(notifier.claimPending('browser')).toEqual([])
  })
  it('releases failed rendering and permits retry', () => {
    const { notifier, complete } = makeNotifier()
    notifier.reportPresence(report())
    complete()
    const [first] = notifier.claimPending('browser')
    notifier.release({ clientId: 'browser', id: first.id, lease: first.lease })
    expect(notifier.claimPending('browser')).toEqual([])
    vi.advanceTimersByTime(10000)
    notifier.reportPresence(report({ sequence: 2 }))
    expect(notifier.claimPending('browser')[0].id).toBe(first.id)
  })
  it.each(['zero', 'sound', 'disabled'])('rechecks settings on claim: %s', mode => {
    const { notifier, complete, config } = makeNotifier()
    notifier.reportPresence(report())
    complete()
    if (mode === 'zero') config.volume = 0
    if (mode === 'sound') config.finished.sound = false
    if (mode === 'disabled') config.enabled = false
    const events = notifier.claimPending('browser')
    if (mode === 'disabled') expect(events).toEqual([])
    else expect(notifier.acknowledge({ clientId: 'browser', id: events[0].id, lease: events[0].lease })).toEqual({ ok: true })
  })
  it.each(['zero', 'muted', 'disabled', 'viewed', 'expired'])('rechecks sound authority after delayed rendering: %s', mode => {
    const { notifier, complete, config } = makeNotifier()
    notifier.reportPresence(report())
    complete()
    const [event] = notifier.claimPending('browser')
    if (mode === 'zero') config.volume = 0
    if (mode === 'muted') config.finished.sound = false
    if (mode === 'disabled') config.enabled = false
    if (mode === 'viewed') notifier.reportPresence(report({ sequence: 2, sessionId: 'agent' }))
    if (mode === 'expired') vi.advanceTimersByTime(10000)
    expect(notifier.acknowledge({ clientId: 'browser', id: event.id, lease: event.lease }))
      .toEqual({ ok: mode === 'zero' || mode === 'muted' })
  })
  it('wires once and disposes events, clients and leases idempotently', () => {
    const { notifier, complete, handlers } = makeNotifier()
    const size = handlers.size
    notifier.wire()
    expect(handlers.size).toBe(size)
    notifier.reportPresence(report())
    complete()
    const [event] = notifier.claimPending('browser')
    notifier.dispose()
    notifier.dispose()
    notifier.wire()
    expect(handlers.size).toBe(0)
    expect(notifier.claimPending('browser')).toEqual([])
    expect(notifier.acknowledge({ clientId: 'browser', id: event.id, lease: event.lease })).toEqual({ ok: false })
  })
})
