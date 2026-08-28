import { describe, expect, it, vi, afterEach } from 'vitest'
import type { TimerLike } from '../src/core/timer.ts'
import { createDrainer, showWebNotification, webPermission } from '../src/client/drainer.ts'

/**
 * Client web-notification drainer: polls the Host queue and renders browser
 * notifications. These tests pin the permission gating and the drain filter —
 * the behavior that decides whether the whale-icon notification actually shows.
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

  it('creates a Notification with the whale icon when granted', () => {
    installNotification('granted')
    showWebNotification({ id: 7, title: 'Hello', body: 'World' }, undefined)
    expect(fakeCtors).toHaveLength(1)
    const n = fakeCtors[0]
    expect(n.title).toBe('Hello')
    expect(n.body).toBe('World')
    expect(n.icon).toMatch(/^data:image\/png;base64,/)
    expect(n.tag).toBe('dsh-next-notifier-7')
  })

  it('closes itself on a 12s timer', () => {
    vi.useFakeTimers()
    installNotification('granted')
    showWebNotification({ id: 1, title: 't' }, undefined)
    expect(navigator !== undefined).toBe(true)
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
    // Only the fresh, object row produced a notification.
    expect(fakeCtors.map((n) => n.title)).toEqual(['fresh'])
    drainer.dispose()
  })

  it('fires an initial drain even without a timer', async () => {
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
