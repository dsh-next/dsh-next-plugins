import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TimerLike } from '../src/core/timer.ts'
import { createPresenceReporter, currentSessionId, isLookingNow, type PresenceReporter } from '../src/client/presence.ts'
import type { ClientPresence } from '../src/core/notifications.ts'

/**
 * Client presence reporting: the reporter is what makes "mute while viewing
 * the session" and page-alive gating real. These tests pin the pure helpers
 * and the event/timer wiring under jsdom (document/window exist).
 */
function snapshot(id: string) {
  return { byId: { [id]: { id, retainedBy: { mainView: 1 } } } }
}

describe('currentSessionId', () => {
  it('returns null for absent services, missing lists, or throwing snapshots', () => {
    expect(currentSessionId(undefined)).toBeNull()
    expect(currentSessionId({} as ISessions)).toBeNull()
    expect(currentSessionId({ list: { getSnapshot: () => { throw new Error('unavailable') } } } as unknown as ISessions)).toBeNull()
  })

  it('uses positive mainView retention, not background retention or legacy selection fields', () => {
    const sessions = { list: { getSnapshot: () => ({ current: 'legacy', byId: {
      background: { id: 'background', retainedBy: { sidebar: 1 } },
      zero: { id: 'zero', retainedBy: { mainView: 0 } },
      negative: { id: 'negative', retainedBy: { mainView: -1 } },
      active: { id: 'active', retainedBy: { mainView: 2 } },
    } }) }, currentProvideInfo: { getSnapshot: () => ({ sessionId: 'legacy' }) } } as unknown as ISessions
    expect(currentSessionId(sessions)).toBe('active')
  })

  it('returns null when no row is retained in the main view, without a legacy fallback', () => {
    const sessions = { list: { getSnapshot: () => ({ current: 'legacy', byId: {} }) },
      currentProvideInfo: { getSnapshot: () => ({ sessionId: 'legacy' }) } } as unknown as ISessions
    expect(currentSessionId(sessions)).toBeNull()
  })
})

describe('isLookingNow', () => {
  it('requires both focus and visibility', () => {
    Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    expect(isLookingNow()).toBe(true)

    Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true })
    expect(isLookingNow()).toBe(false)

    Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    expect(isLookingNow()).toBe(false)

    // jsdom's visibilityState may be read-only in some setups; restore the
    // visible default for the remaining reporter tests.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true })
  })

  it('falls back to not-looking when the APIs are unavailable', () => {
    Object.defineProperty(document, 'hasFocus', { value: undefined, configurable: true })
    expect(isLookingNow()).toBe(false)
    Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true })
  })
})

describe('createPresenceReporter', () => {
  it('reports immediately on construction with a presence payload', () => {
    const send = vi.fn().mockResolvedValue({})
    const reporter = createPresenceReporter(undefined, undefined, send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe('reportPresence')
    const payload = send.mock.calls[0][1] as { focused: boolean; visible: boolean; open: boolean; sessionId: string | null }
    expect(payload).toHaveProperty('focused')
    expect(payload).toHaveProperty('visible')
    expect(payload.open).toBe(true)
    reporter.dispose()
  })

  it('reports on focus and blur events', () => {
    const send = vi.fn().mockResolvedValue({})
    const reporter = createPresenceReporter(undefined, undefined, send)
    send.mockClear()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('blur'))
    expect(send.mock.calls.filter((c) => c[0] === 'reportPresence')).toHaveLength(2)
    reporter.dispose()
  })

  it('sends a closed presence on pagehide', () => {
    const send = vi.fn().mockResolvedValue({})
    const reporter = createPresenceReporter(undefined, undefined, send)
    send.mockClear()
    window.dispatchEvent(new Event('pagehide'))
    const call = send.mock.calls.find((c) => c[0] === 'reportPresence')
    expect(call).toBeDefined()
    const payload = call![1] as { focused: boolean; visible: boolean; open: boolean; sessionId: string | null }
    expect(payload.focused).toBe(false)
    expect(payload.visible).toBe(false)
    expect(payload.open).toBe(false)
    reporter.dispose()
  })

  it('registers an interval when a timer is provided and clears on dispose', () => {
    const off = vi.fn()
    const interval = vi.fn(() => off as unknown as () => void)
    const timer = { timeout: vi.fn(), interval } as TimerLike
    const send = vi.fn().mockResolvedValue({})
    const reporter = createPresenceReporter(undefined, timer, send)
    expect(interval).toHaveBeenCalledTimes(1)
    reporter.dispose()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('subscribes only to the modern list and unsubscribes on disposal', () => {
    const unsubscribe = vi.fn()
    const legacySubscribe = vi.fn()
    const subscribe = vi.fn(() => unsubscribe)
    const sessions = { list: { getSnapshot: () => snapshot('s1'), subscribe },
      currentProvideInfo: { subscribe: legacySubscribe } } as unknown as ISessions
    const reporter = createPresenceReporter(sessions, undefined, vi.fn().mockResolvedValue({}))
    expect(subscribe).toHaveBeenCalledOnce()
    expect(legacySubscribe).not.toHaveBeenCalled()
    reporter.dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('masks session presence while a global panel is active and reports panel changes immediately', () => {
    let current = 's1'
    const sessions = { list: { getSnapshot: () => snapshot(current) } } as unknown as ISessions
    const send = vi.fn().mockResolvedValue({})
    const reporter = createPresenceReporter(sessions, undefined, send)
    expect(send.mock.calls.at(-1)![1]).toMatchObject({ sessionId: 's1' })
    reporter.setPanelActive(true)
    expect(send.mock.calls.at(-1)![1]).toMatchObject({ sessionId: null, open: true })
    expect(reporter.snapshot().sessionId).toBeNull()
    const count = send.mock.calls.length
    reporter.setPanelActive(true)
    expect(send).toHaveBeenCalledTimes(count)
    current = 's2'
    reporter.setPanelActive(false)
    expect(send.mock.calls.at(-1)![1]).toMatchObject({ sessionId: 's2' })
    reporter.setPanelActive(false)
    expect(send).toHaveBeenCalledTimes(count + 1)
    reporter.dispose()
    reporter.setPanelActive(true)
    reporter.setPanelActive(false)
    expect(send).toHaveBeenCalledTimes(count + 2)
    expect(reporter.snapshot()).toMatchObject({ sessionId: null, open: false })
  })

  it('reports a fresh sessionId from the list snapshot on every report()', () => {
    const send = vi.fn().mockResolvedValue({})
    const sessions = {
      list: { getSnapshot: () => snapshot('s-current'), subscribe: vi.fn(() => vi.fn()) },
    } as unknown as ISessions
    const reporter = createPresenceReporter(sessions, undefined, send)
    expect((send.mock.calls[0][1] as { sessionId: string | null }).sessionId).toBe('s-current')
    reporter.dispose()
  })

  it('report() can be re-invoked to push a fresh payload', () => {
    const send = vi.fn().mockResolvedValue({})
    const reporter = createPresenceReporter(undefined, undefined, send)
    send.mockClear()
    reporter.report()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe('reportPresence')
    reporter.dispose()
  })
})

describe('sequenced presence lifecycle', () => {
  const reporters: PresenceReporter[] = []
  afterEach(() => {
    for (const reporter of reporters.splice(0)) reporter.dispose()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function create(send = vi.fn().mockResolvedValue({}), sessions?: ISessions, timer?: TimerLike) {
    const reporter = createPresenceReporter(sessions, timer, send)
    reporters.push(reporter)
    return { reporter, send }
  }

  it('assigns a fresh UUID to each reporter and sequences snapshots and reports together', () => {
    const one = create()
    const two = create()
    expect(one.reporter.clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(one.reporter.clientId).not.toBe(two.reporter.clientId)
    expect(one.send.mock.calls[0][1]).toMatchObject({ clientId: one.reporter.clientId, sequence: 1 })
    const claim = one.reporter.snapshot()
    expect(claim.sequence).toBe(2)
    one.reporter.report()
    expect(one.send.mock.calls[1][1]).toMatchObject({ clientId: claim.clientId, sequence: 3 })
    expect(two.reporter.snapshot().sequence).toBe(2)
  })

  it('reads current browser state, session selection, and permission for every snapshot', () => {
    let focused = true
    let visible = 'visible'
    let current = 'first'
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible as DocumentVisibilityState)
    const notification = { permission: 'granted' }
    vi.stubGlobal('Notification', notification)
    const sessions = { list: { getSnapshot: () => snapshot(current) } } as unknown as ISessions
    const { reporter } = create(undefined, sessions)
    expect(reporter.snapshot()).toEqual({ clientId: reporter.clientId, sequence: 2, focused: true, visible: true, open: true, sessionId: 'first', permission: 'granted' })
    focused = false
    visible = 'hidden'
    current = 'second'
    notification.permission = 'denied'
    expect(reporter.snapshot()).toMatchObject({ sequence: 3, focused: false, visible: false, open: true, sessionId: 'second', permission: 'denied' })
  })

  it('sends one sequenced pagehide transition and stays closed through intervals until pageshow', () => {
    let tick!: () => void
    const off = vi.fn()
    const timer = { interval: vi.fn((callback: () => void) => { tick = callback; return off }), timeout: vi.fn() } as TimerLike
    const { reporter, send } = create(undefined, undefined, timer)
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pagehide'))
    expect(send).toHaveBeenCalledTimes(2)
    const closed = send.mock.calls[1][1] as ClientPresence
    expect(closed).toMatchObject({ clientId: reporter.clientId, sequence: 2, focused: false, visible: false, open: false, sessionId: null })
    tick()
    expect((send.mock.calls.at(-1)![1] as ClientPresence).open).toBe(false)
    expect(reporter.snapshot().open).toBe(false)
    window.dispatchEvent(new Event('pageshow'))
    const resumed = send.mock.calls.at(-1)![1] as ClientPresence
    expect(resumed.open).toBe(true)
    expect(resumed.sequence).toBeGreaterThan(closed.sequence)
    expect(resumed.clientId).toBe(closed.clientId)
  })

  it('sends final closed presence once and removes every listener, timer, and subscription', () => {
    const addWindow = vi.spyOn(window, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    let tick!: () => void
    let change!: () => void
    const off = vi.fn()
    const unsubscribe = vi.fn()
    const timer = { interval: vi.fn((callback: () => void) => { tick = callback; return off }), timeout: vi.fn() } as TimerLike
    const sessions = { list: { getSnapshot: () => snapshot('session'), subscribe: (callback: () => void) => { change = callback; return unsubscribe } } } as unknown as ISessions
    const { reporter, send } = create(undefined, sessions, timer)
    const before = reporter.snapshot()
    reporter.dispose()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][1]).toMatchObject({ clientId: reporter.clientId, sequence: before.sequence + 1, open: false, focused: false, visible: false, sessionId: null })
    for (const [event, callback] of addWindow.mock.calls.filter(([name]) => ['focus', 'blur', 'pagehide', 'pageshow'].includes(name))) {
      expect(removeWindow).toHaveBeenCalledWith(event, callback)
    }
    for (const [event, callback] of addDocument.mock.calls.filter(([name]) => name === 'visibilitychange')) {
      expect(removeDocument).toHaveBeenCalledWith(event, callback)
    }
    reporter.dispose()
    reporter.report()
    tick()
    change()
    for (const event of ['focus', 'blur', 'pagehide', 'pageshow']) window.dispatchEvent(new Event(event))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(send).toHaveBeenCalledTimes(2)
    expect(off).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(reporter.snapshot().open).toBe(false)
  })

  it('does not leave pagehide listeners behind across reporter replacement', () => {
    const old = create()
    old.reporter.dispose()
    const next = create()
    old.send.mockClear()
    next.send.mockClear()
    window.dispatchEvent(new Event('pagehide'))
    expect(old.send).not.toHaveBeenCalled()
    expect(next.send).toHaveBeenCalledTimes(1)
    expect(next.send.mock.calls[0][1]).toMatchObject({ clientId: next.reporter.clientId, open: false })
  })

  it('reports session and visibility changes immediately and survives rejected sends', async () => {
    let current = 'first'
    let change!: () => void
    const sessions = { list: { getSnapshot: () => snapshot(current), subscribe: (callback: () => void) => { change = callback; return vi.fn() } } } as unknown as ISessions
    const send = vi.fn().mockRejectedValue(new Error('network failed'))
    const { reporter } = create(send, sessions)
    current = 'second'
    change()
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls[1][1]).toMatchObject({ sessionId: 'second', sequence: 2 })
    reporter.dispose()
    await Promise.resolve()
    expect(send.mock.calls[3][1]).toMatchObject({ open: false, sequence: 4 })
  })

  it('continues cleanup when sends or individual disposers throw synchronously', () => {
    const off = vi.fn(() => { throw new Error('timer cleanup') })
    const unsubscribe = vi.fn()
    const timer = { interval: () => off, timeout: vi.fn() } as TimerLike
    const sessions = { list: { getSnapshot: () => ({}), subscribe: () => unsubscribe } } as unknown as ISessions
    const send = vi.fn(() => { throw new Error('transport failure') })
    const { reporter } = create(send, sessions, timer)
    expect(() => reporter.dispose()).not.toThrow()
    expect(off).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    reporter.report()
    expect(send).toHaveBeenCalledTimes(2)
  })
})
