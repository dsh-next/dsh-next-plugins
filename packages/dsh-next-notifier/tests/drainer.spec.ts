import { describe, expect, it, vi, afterEach } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { englishTranslate, zh } from '../src/client/dictionaries.ts'
import type { TimerLike } from '../src/core/timer.ts'
import { createDrainer, eventTitle, eventBody, sessionTitleOf, showWebNotification, webPermission } from '../src/client/drainer.ts'

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

afterEach(() => { uninstallNotification(); vi.useRealTimers(); vi.restoreAllMocks() })

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
    expect(n.title).toBe('Hello')
    expect(n.body).toBe('World')
    expect(n.icon).toMatch(/^data:image\/png;base64,/)
    expect(n.tag).toBe('dsh-next-notifier-7')
  })

  it('uses the localized kind title and the session title as the body', () => {
    installNotification('granted')
    const sessions = ({ list: { getSnapshot: () => ({ byId: { s5: { id: 's5', displayTitle: 'Design spec' } } }) } }) as unknown as ISessions
    showWebNotification({ id: 1, kind: 'approval', sessionId: 's5', title: 'Approval needed', body: 'Waiting for approval: bash' }, sessions)
    expect(fakeCtors[0].title).toBe('Approval needed')
    expect(fakeCtors[0].body).toBe('Design spec')
  })

  it.each([
    ['finished', 'event.finished'], ['approval', 'event.approval'], ['question', 'event.question'],
    ['subagent', 'event.subagent'], ['goal-complete', 'event.goalComplete'], ['goal-blocked', 'event.goalBlocked'],
    ['error', 'event.error'], ['blocked', 'event.blocked'], ['max-tokens', 'event.maxTokens'],
  ] as const)('localizes %s rather than using the host title', (kind, key) => {
    installNotification('granted')
    showWebNotification({ kind, title: 'Host title' }, undefined, undefined, k => zh[k])
    expect(fakeCtors[0].title).toBe(zh[key])
    expect(eventTitle({ kind, title: 'Host title' })).toBe(englishTranslate(key))
  })

  it('falls back to the detail body when the session is unknown', () => {
    installNotification('granted')
    const sessions = ({ list: { getSnapshot: () => ({ byId: {} }) } }) as unknown as ISessions
    showWebNotification({ id: 1, kind: 'approval', sessionId: 'ghost', title: 'Approval needed', body: 'Waiting for approval: bash' }, sessions)
    expect(fakeCtors[0].title).toBe('Approval needed')
    expect(fakeCtors[0].body).toBe('Waiting for approval: bash')
  })

  it('preserves the supplied title for an unknown kind', () => {
    installNotification('granted')
    showWebNotification({ id: 1, kind: 'unknown', title: 'Test notification', body: 'Check it' }, undefined)
    expect(fakeCtors[0].title).toBe('Test notification')
  })

  it('falls back to DeepSeek Harness when the type title is empty', () => {
    installNotification('granted')
    showWebNotification({ id: 1, title: '' }, undefined)
    expect(fakeCtors[0].title).toBe('DeepSeek Harness')
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
    const openSession = vi.fn()
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    const handle = showWebNotification({ id: 9, sessionId: 's5', title: 't' }, {} as ISessions, undefined, undefined, { openSession })
    fakeCtors[0].onclick?.()
    expect(openSession).toHaveBeenCalledWith('s5')
    expect(fakeCtors[0].close).toHaveBeenCalledOnce()
    handle?.close()
  })
})


describe('notification presentation fallbacks', () => {
  it.each(['__proto__', 'constructor', 'toString'])('does not treat prototype key %s as an event kind', kind => {
    expect(eventTitle({ kind, title: 'Custom' })).toBe('Custom')
  })
  it.each([['error', 'event.subagentError'], ['blocked', 'event.subagentBlocked'], ['max-tokens', 'event.subagentMaxTokens']] as const)
    ('localizes child failure kind %s without labelling it as the main agent', (kind, key) => {
      expect(eventTitle({ kind, isSubagent: true }, key => zh[key])).toBe(zh[key])
    })
  it('handles missing, malformed, and throwing session titles safely', () => {
    for (const displayTitle of ['', undefined, 42]) {
      const sessions = { list: { getSnapshot: () => ({ byId: { s: { displayTitle } } }) } } as unknown as ISessions
      expect(sessionTitleOf(sessions, 's')).toBe('')
      expect(eventBody({ sessionId: 's', body: 'Detail' }, sessions)).toBe('Detail')
    }
    const sessions = { list: { getSnapshot: () => { throw new Error('unavailable') } } } as unknown as ISessions
    expect(eventBody({ sessionId: 's' }, sessions)).toBe('')
    expect(sessionTitleOf(sessions, null)).toBe('')
    expect(eventTitle({}, key => zh[key])).toBe(zh['event.default'])
  })

  it('returns unsupported for a throwing permission getter and null for constructor failure', () => {
    class Broken {
      static get permission(): string { throw new Error('permission') }
    }
    vi.stubGlobal('Notification', Broken)
    expect(webPermission()).toBe('unsupported')
    class Failed { static permission = 'granted'; constructor() { throw new Error('constructor') } }
    vi.stubGlobal('Notification', Failed)
    expect(showWebNotification({}, undefined)).toBeNull()
    vi.unstubAllGlobals()
  })

  it('navigates without requiring the optional session-list service', () => {
    installNotification('granted')
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    const openSession = vi.fn()
    showWebNotification({ sessionId: 's' }, undefined, undefined, undefined, { openSession })
    fakeCtors[0].onclick?.()
    expect(openSession).toHaveBeenCalledWith('s')
    expect(fakeCtors[0].close).toHaveBeenCalledOnce()
  })

  it('closes safely without optional navigation and never calls the legacy sessions.open', () => {
    installNotification('granted')
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    const open = vi.fn()
    showWebNotification({ sessionId: 's' }, { open } as unknown as ISessions)
    expect(() => fakeCtors[0].onclick?.()).not.toThrow()
    expect(open).not.toHaveBeenCalled()
    expect(fakeCtors[0].close).toHaveBeenCalledOnce()
  })
})
