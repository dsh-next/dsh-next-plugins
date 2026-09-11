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
  onshow?: (() => void) | null
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
    fakeCtors[0].onshow?.()
    vi.advanceTimersByTime(11999)
    expect(fakeCtors[0].close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fakeCtors[0].close).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('createDrainer', () => {
  const delivery = (overrides = {}) => ({ id: 'event', lease: 'token', leaseExpiresAt: Date.now() + 10000, at: Date.now(), kind: 'finished', title: 'Done', body: 'Finished', sessionId: 's1', ...overrides })
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
  function setup(claim = vi.fn().mockResolvedValue([delivery()])) {
    const transport = { claim, show: vi.fn().mockResolvedValue(true), acknowledge: vi.fn().mockResolvedValue({ ok: true }), release: vi.fn().mockResolvedValue({ ok: true }) }
    const off = vi.fn()
    const timer = { interval: vi.fn(() => off), timeout: vi.fn() } as TimerLike
    return { transport, timer, off }
  }
  it('acknowledges only after rendering succeeds', async () => {
    const { transport, timer, off } = setup()
    let rendered!: (shown: boolean) => void
    transport.show.mockImplementation(() => new Promise((r) => { rendered = r }))
    const drainer = createDrainer(timer, transport)
    await flush()
    expect(transport.acknowledge).not.toHaveBeenCalled()
    rendered(true)
    await flush()
    expect(transport.acknowledge).toHaveBeenCalledTimes(1)
    drainer.dispose()
    expect(off).toHaveBeenCalledTimes(1)
  })
  it('releases permission-denied and throwing render attempts without acknowledging', async () => {
    for (const show of [vi.fn().mockResolvedValue(false), vi.fn().mockRejectedValue(new Error('browser'))]) {
      const { transport } = setup()
      transport.show = show
      const drainer = createDrainer(undefined, transport)
      await flush()
      expect(transport.release).toHaveBeenCalledTimes(1)
      expect(transport.acknowledge).not.toHaveBeenCalled()
      drainer.dispose()
    }
  })
  it('single-flights requests and releases late claims after disposal', async () => {
    let resolve!: (events: unknown) => void
    const { transport } = setup(vi.fn(() => new Promise((r) => { resolve = r })))
    const drainer = createDrainer(undefined, transport)
    await drainer.poll()
    expect(transport.claim).toHaveBeenCalledTimes(1)
    drainer.dispose()
    resolve([delivery()])
    await flush()
    expect(transport.show).not.toHaveBeenCalled()
    expect(transport.release).toHaveBeenCalledTimes(1)
    await drainer.poll()
    expect(transport.claim).toHaveBeenCalledTimes(1)
  })
  it('does not acknowledge a renderer that settles after disposal', async () => {
    const { transport } = setup()
    let resolve!: (shown: boolean) => void
    transport.show.mockImplementation(() => new Promise((r) => { resolve = r }))
    const drainer = createDrainer(undefined, transport)
    await flush()
    drainer.dispose()
    resolve(true)
    await flush()
    expect(transport.acknowledge).not.toHaveBeenCalled()
    expect(transport.release).toHaveBeenCalledTimes(1)
  })
  it('retries acknowledgements without rendering the same event twice', async () => {
    const { transport } = setup()
    transport.acknowledge.mockRejectedValueOnce(new Error('lost response'))
    const drainer = createDrainer(undefined, transport)
    await flush()
    await drainer.poll()
    expect(transport.show).toHaveBeenCalledTimes(1)
    expect(transport.acknowledge.mock.calls.length).toBeGreaterThan(1)
    drainer.dispose()
  })
  it('renders again for a new lease after a lost acknowledgement and expired toast', async () => {
    const { transport } = setup()
    transport.acknowledge.mockRejectedValueOnce(new Error('offline'))
    const drainer = createDrainer(undefined, transport)
    await flush()
    transport.claim.mockResolvedValue([delivery({ lease: 'replacement' })])
    await drainer.poll()
    expect(transport.show).toHaveBeenCalledTimes(2)
    drainer.dispose()
  })
  it('ignores malformed rows and releases expired deliveries', async () => {
    const { transport } = setup(vi.fn().mockResolvedValue([null, 'bad', {}, delivery({ at: Date.now() - 120001 }), delivery({ leaseExpiresAt: Date.now() - 1 })]))
    const drainer = createDrainer(undefined, transport)
    await flush()
    expect(transport.show).not.toHaveBeenCalled()
    expect(transport.release).toHaveBeenCalledTimes(2)
    drainer.dispose()
  })
  it('recovers from failed fetch and ignores non-array responses', async () => {
    const { transport } = setup(vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({}))
    const drainer = createDrainer(undefined, transport)
    await flush()
    await drainer.poll()
    expect(transport.claim).toHaveBeenCalledTimes(2)
    expect(transport.show).not.toHaveBeenCalled()
    drainer.dispose()
  })
  it('opens the clicked session and closes its notification', () => {
    installNotification('granted')
    const open = vi.fn()
    const handle = showWebNotification({ id: 9, sessionId: 's5', title: 't' }, { open } as never)
    fakeCtors[0].onclick?.()
    expect(open).toHaveBeenCalledWith('s5')
    handle?.close()
  })
})
