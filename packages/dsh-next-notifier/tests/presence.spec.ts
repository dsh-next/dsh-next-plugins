import { describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { TimerLike } from '../src/core/timer.ts'
import { createPresenceReporter, currentSessionId } from '../src/client/presence.ts'

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

  it('returns null when currentProvideInfo is absent', () => {
    expect(currentSessionId({} as ISessions)).toBeNull()
  })

  it('returns null when getSnapshot is not a function', () => {
    expect(currentSessionId({ currentProvideInfo: {} } as unknown as ISessions)).toBeNull()
  })

  it('returns the snapshot sessionId when present', () => {
    const sessions = {
      currentProvideInfo: { getSnapshot: () => ({ sessionId: 's42' }) },
    } as unknown as ISessions
    expect(currentSessionId(sessions)).toBe('s42')
  })

  it('returns null on a throwing getSnapshot', () => {
    const sessions = {
      currentProvideInfo: { getSnapshot: () => { throw new Error('boom') } },
    } as unknown as ISessions
    expect(currentSessionId(sessions)).toBeNull()
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
