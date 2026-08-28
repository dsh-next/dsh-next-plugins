import { describe, expect, it, vi, afterEach } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { TimerLike } from '../src/core/timer.ts'
import { createDrainer, showWebNotification, webPermission } from '../src/client/drainer.ts'

/**
 * Client web-notification drainer: polls the Host queue and renders browser
 * notifications. These tests pin the permission gating and the drain filter —
 * the behavior that decides whether the DeepSeek-icon notification actually shows.
 */

type FakeNotification = {
  title: string
  body: string
  icon: string
  tag: string
  onclick: (() => void) | null
  close: () => void
}

const fakeCtors: FakeNotification[] = []
function installNotification(permission: 'granted' | 'denied' | 'default'): void {
  class MockNotification {
    permission = permission
    title: string
    body: string
    icon: string
    tag: string
    onclick: (() => void) | null = null
    close = vi.fn()
    constructor(title: string, opts: Partial<FakeNotification> = {}) {
      this.title = title
      this.body = opts.body ?? ''
      this.icon = opts.icon ?? ''
      this.tag = opts.tag ?? ''
      fakeCtors.push(this)
    }
    static permission = permission
  }
  Object.defineProperty(globalThis, 'Notification', { value: MockNotification, configurable: true, writable: true })
}

function uninstallNotification(): void {
  delete (globalThis as Record<string, unknown>).Notification
  fakeCtors.length = 0
}

afterEach(uninstallNotification)

describe('webPermission', () => {
  it('returns unsupported when Notification is undefined', () => {
    uninstallNotification()
    expect(webPermission()).toBe('unsupported')
  })

  it('returns the current permission when supported', () => {
    installNotification('granted')
    expect(webPermission()).toBe('granted')
    ;(globalThis as unknown as { Notification: { permission: string } }).Notification.permission = 'denied'
    expect(webPermission()).toBe('denied')
  })
})

describe('showWebNotification', () => {
  it('does nothing when the browser lacks Notification support', () => {
    uninstallNotification()
    expect(() => showWebNotification({ title: 't' }, undefined)).not.toThrow()
    expect(fakeCtors).toHaveLength(0)
  })

  it('does nothing when permission is not granted', () => {
    installNotification('default')
    showWebNotification({ title: 't' }, undefined)
    expect(fakeCtors).toHaveLength(0)
  })

  it('creates a Notification with the DeepSeek icon when granted', () => {
    installNotification('granted')
    showWebNotification({ id: 7, title: 'Hello', body: 'World' }, undefined)
    expect(fakeCtors).toHaveLength(1)
    const n = fakeCtors[0]
    expect(n.title).toBe('\ud83d\udd14 Hello')
    expect(n.body).toBe('World')
    expect(n.icon).toMatch(/^data:image\/png;base64,/)
    expect(n.tag).toBe('dsh-next-notifier-7')
  })

  it('uses the kind emoji and the session title as the body', () => {
    installNotification('granted')
    const sessions = ({ list: { getSnapshot: () => ({ byId: { s5: { id: 's5', displayTitle: 'Design spec' } } }) } }) as unknown as ISessions
    showWebNotification({ id: 1, kind: 'approval', sessionId: 's5', title: 'Approval needed', body: 'Waiting for approval: bash' }, sessions)
    expect(fakeCtors[0].title).toBe('\u26a0\ufe0f Approval needed')
    expect(fakeCtors[0].body).toBe('Design spec')
  })

  it('uses a distinct emoji per kind', () => {
    const kinds: Record<string, string> = {
      finished: '\u2705',
      question: '\u2753',
      subagent: '\ud83d\udc65',
      'goal-complete': '\ud83c\udfc6',
      'goal-blocked': '\ud83d\udeab',
    }
    for (const [kind, emoji] of Object.entries(kinds)) {
      installNotification('granted')
      showWebNotification({ id: 1, kind, title: 'Type' }, undefined)
      expect(fakeCtors[fakeCtors.length - 1].title).toBe(emoji + ' Type')
    }
  })

  it('falls back to the detail body when the session is unknown', () => {
    installNotification('granted')
    const sessions = ({ list: { getSnapshot: () => ({ byId: {} }) } }) as unknown as ISessions
    showWebNotification({ id: 1, kind: 'approval', sessionId: 'ghost', title: 'Approval needed', body: 'Waiting for approval: bash' }, sessions)
    expect(fakeCtors[0].title).toBe('\u26a0\ufe0f Approval needed')
    expect(fakeCtors[0].body).toBe('Waiting for approval: bash')
  })

  it('uses the default emoji for an unknown kind', () => {
    installNotification('granted')
    showWebNotification({ id: 1, title: 'Test notification', body: 'Check it' }, undefined)
    expect(fakeCtors[0].title).toBe('\ud83d\udd14 Test notification')
  })

  it('falls back to DeepSeek Harness when the type title is empty', () => {
    installNotification('granted')
    showWebNotification({ id: 1, title: '' }, undefined)
    expect(fakeCtors[0].title).toBe('\ud83d\udd14 DeepSeek Harness')
  })

  it('closes itself on a 12s timer', () => {
    vi.useFakeTimers()
    installNotification('granted')
    showWebNotification({ id: 1, title: 't' }, undefined)
    vi.advanceTimersByTime(12000)
    expect(fakeCtors[0].close).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('createDrainer', () => {
  it('drains only fresh object events and skips stale/non-object rows', async () => {
    installNotification('granted')
    const timer: TimerLike = {
      timeout: vi.fn(),
      interval: (cb) => { cb(); return vi.fn() as unknown as () => void },
    }
    // fetchPending mirrors the Host's drainPending(): the queue empties on
    // first read, so a second poll (interval) returns nothing.
    const queue = [
      { id: 1, at: Date.now() - 1000, title: 'fresh' },
      { id: 2, at: Date.now() - 60000, title: 'stale' },
      null,
      'not-an-object',
    ]
    const fetchPending = vi.fn().mockResolvedValue(queue).mockResolvedValueOnce(queue).mockResolvedValue([])
    const drainer = createDrainer(undefined, timer, fetchPending)
    await new Promise((r) => setTimeout(r, 20))
    // Only the fresh, object row produced a notification (with the default emoji).
    expect(fakeCtors.map((n) => n.title)).toEqual(['\ud83d\udd14 fresh'])
    drainer.dispose()
  })

  it('faces an initial drain even without a timer', async () => {
    installNotification('granted')
    const fetchPending = vi.fn().mockResolvedValue([])
    const drainer = createDrainer(undefined, undefined, fetchPending)
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchPending).toHaveBeenCalledTimes(1)
    drainer.dispose()
  })

  it('opens the clicked session', () => {
    installNotification('granted')
    const open = vi.fn()
    showWebNotification({ id: 9, sessionId: 's5', title: 't' }, { open } as never)
    fakeCtors[0].onclick?.()
    expect(open).toHaveBeenCalledWith('s5')
  })
})
