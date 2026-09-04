import { describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { TimerLike } from '../src/core/timer.ts'
import { createPresenceReporter, currentSessionId, isLookingNow } from '../src/client/presence.ts'

/**
 * Client presence reporting: the reporter is what makes "mute while viewing
 * the session" and page-alive gating real. These tests pin the pure helpers
 * and the event/timer wiring under jsdom (document/window exist).
 */
function isoString(key: string, value: unknown): unknown {
  return value === undefined ? '<<undef>>' : value
}

describe('currentSessionId', () => {
  it('returns null when sessions is undefined', () => {
    expect(currentSessionId(undefined)).toBeNull()
  })

  it('returns null when both channels are absent', () => {
    expect(currentSessionId({} as ISessions)).toBeNull()
  })

  it('returns the list snapshot current id (the 0.1.2 shell channel)', () => {
    const sessions = {
      list: { getSnapshot: () => ({ current: 's-list' }) },
    } as unknown as ISessions
    expect(currentSessionId(sessions)).toBe('s-list')
  })

  it('prefers the list snapshot over the legacy channel', () => {
    const sessions = {
      list: { getSnapshot: () => ({ current: 's-list' }) },
      currentProvideInfo: { getSnapshot: () => ({ sessionId: 's-legacy' }) },
    } as unknown as ISessions
    expect(currentSessionId(sessions)).toBe('s-list')
  })

  it('falls back to the legacy channel when the list has no current', () => {
    const sessions = {
      list: { getSnapshot: () => ({}) },
      currentProvideInfo: { getSnapshot: () => ({ sessionId: 's-legacy' }) },
    } as unknown as ISessions
    expect(currentSessionId(sessions)).toBe('s-legacy')
  })

  it('returns null when list.current is absent and no legacy channel exists', () => {
    const sessions = {
      list: { getSnapshot: () => ({ current: undefined }) },
    } as unknown as ISessions
    expect(currentSessionId(sessions)).toBeNull()
  })

  it('falls back to the legacy channel when the list snapshot throws', () => {
    const sessions = {
      list: { getSnapshot: () => { throw new Error('boom') } },
      currentProvideInfo: { getSnapshot: () => ({ sessionId: 's-legacy' }) },
    } as unknown as ISessions
    expect(currentSessionId(sessions)).toBe('s-legacy')
  })

  it('returns null on a throwing legacy getSnapshot with no list current', () => {
    const sessions = {
      list: { getSnapshot: () => ({}) },
      currentProvideInfo: { getSnapshot: () => { throw new Error('boom') } },
    } as unknown as ISessions
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

  it('subscribes to currentProvideInfo when present and unsubscribes on dispose', () => {
    const unsub = vi.fn()
    const subscribe = vi.fn(() => unsub)
    const sessions = {
      currentProvideInfo: { getSnapshot: () => ({ sessionId: 's1' }), subscribe },
    } as unknown as ISessions
    const send = vi.fn().mockResolvedValue({})
    const reporter = createPresenceReporter(sessions, undefined, send)
    expect(subscribe).toHaveBeenCalledTimes(1)
    reporter.dispose()
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('prefers the list subscription over the legacy channel', () => {
    const unsubList = vi.fn()
    const unsubLegacy = vi.fn()
    const sessions = {
      list: { getSnapshot: () => ({ current: 's1' }), subscribe: vi.fn(() => unsubList) },
      currentProvideInfo: { getSnapshot: () => ({ sessionId: 's1' }), subscribe: vi.fn(() => unsubLegacy) },
    } as unknown as ISessions
    const send = vi.fn().mockResolvedValue({})
    const reporter = createPresenceReporter(sessions, undefined, send)
    expect((sessions.list.subscribe as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
    expect((sessions.currentProvideInfo.subscribe as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    reporter.dispose()
    expect(unsubList).toHaveBeenCalledTimes(1)
    expect(unsubLegacy).not.toHaveBeenCalled()
  })

  it('reports a fresh sessionId from the list snapshot on every report()', () => {
    const send = vi.fn().mockResolvedValue({})
    const sessions = {
      list: { getSnapshot: () => ({ current: 's-current' }), subscribe: vi.fn(() => vi.fn()) },
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
