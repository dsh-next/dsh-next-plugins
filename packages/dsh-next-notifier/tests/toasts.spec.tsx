/**
 * jsdom render test for the in-page toast layer: polls the Host queue for
 * toast-channel events, renders the capsule cards, opens the session on
 * its native action, dismisses on close, auto-dismisses after the TTL, shows
 * only the latest toast, falls back to a web notification when the
 * user stopped looking, and serves the settings card's test-toast bus.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TimerLike } from '../src/core/timer.ts'
import { ToastLayer, enqueueTestToast, type ToastLayerProps } from '../src/client/toasts.tsx'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Manual timer: intervals and timeouts are collected and fired by the test. */
function fakeTimer(): TimerLike & { fireInterval: () => void; fireTimeouts: () => void } {
  const intervals: (() => void)[] = []
  const timeouts: (() => void)[] = []
  return {
    interval: (cb) => { intervals.push(cb); return () => {} },
    timeout: (cb) => { timeouts.push(cb); return () => {} },
    fireInterval: () => { for (const cb of intervals) cb() },
    fireTimeouts: () => { for (const cb of [...timeouts]) cb() },
  }
}

function mockFocus(focused: boolean): void {
  Object.defineProperty(document, 'hasFocus', { value: () => focused, configurable: true })
}

function installNotification(): { ctor: { title: string; body: string }[] } {
  const ctor: { title: string; body: string }[] = []
  class MockNotification {
    static permission = 'granted'
    onclick: (() => void) | null = null
    onshow: (() => void) | null = null
    close = vi.fn()
    constructor(title: string, opts: { body?: string } = {}) {
      ctor.push({ title, body: opts.body ?? '' })
      queueMicrotask(() => this.onshow?.())
    }
  }
  Object.defineProperty(globalThis, 'Notification', { value: MockNotification, configurable: true, writable: true })
  return { ctor }
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '1',
    lease: 'lease',
    leaseExpiresAt: Date.now() + 10000,
    kind: 'approval',
    title: 'Approval needed',
    body: 'Waiting for your approval: bash',
    sessionId: 's5',
    at: Date.now(),
    channel: 'toast',
    ...overrides,
  }
}

function soundRpc() {
  let accepted = false
  return vi.fn(async (method: string) => {
    if (method === 'getPendingNotifications') return [event()]
    if (method === 'acknowledgeNotifications' && !accepted) {
      accepted = true
      return { ok: true, sound: { id: 'ping', volume: 37 } }
    }
    return { ok: false }
  })
}

function action(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="alert"] button')].find(node => node.textContent === label)
  expect(button, `native action ${label}`).toBeDefined()
  return button!
}

describe('ToastLayer', () => {
  const container = document.createElement('div')
  let root: Root | undefined

  afterEach(() => {
    act(() => { root?.unmount() })
    container.remove()
    delete (globalThis as Record<string, unknown>).Notification
    mockFocus(false)
  })

  function renderLayer(rpc: (method: string) => Promise<unknown>, sessions?: ISessions, timer?: TimerLike, extra: Partial<ToastLayerProps> = {}): void {
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(React.createElement(ToastLayer, { rpc, sessions, timer, ...extra }))
    })
  }

  async function flush(): Promise<void> {
    await act(async () => { await Promise.resolve() })
  }

  it('renders nothing until a toast-channel event arrives', async () => {
    mockFocus(true)
    const rpc = vi.fn(async () => [])
    renderLayer(rpc)
    await flush()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('renders a toast-channel event with the shared headline and session title', async () => {
    mockFocus(true)
    const rpc = vi.fn(async () => [event()])
    const sessions = ({ list: { getSnapshot: () => ({ byId: { s5: { id: 's5', displayTitle: 'Design spec' } } }) } }) as unknown as ISessions
    renderLayer(rpc, sessions, fakeTimer())
    await flush()
    const toast = document.querySelector('[role="alert"]')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('Approval needed')
    expect(toast!.textContent).toContain('Design spec')
  })

  it('falls back to the event body when the session is unknown', async () => {
    mockFocus(true)
    const rpc = vi.fn(async () => [event({ sessionId: 'ghost' })])
    renderLayer(rpc)
    await flush()
    expect(document.querySelector('[role="alert"]')!.textContent)
      .toContain('Waiting for your approval: bash')
  })

  it('ignores malformed events without a valid delivery lease', async () => {
    mockFocus(true)
    const rpc = vi.fn(async () => [
      event({ lease: undefined, title: 'unleased' }),
      event({ id: undefined, title: 'unidentified' }),
    ])
    renderLayer(rpc)
    await flush()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('opens the session only through the native Open session action', async () => {
    mockFocus(true)
    const openSession = vi.fn()
    const rpc = vi.fn(async () => [event()])
    const sessions = {} as ISessions
    renderLayer(rpc, sessions, fakeTimer(), { navigation: { openSession } })
    await flush()
    const toast = document.querySelector('[role="alert"]') as HTMLElement
    act(() => { toast.click() })
    expect(openSession).not.toHaveBeenCalled()
    act(() => { action('Open session').click() })
    expect(openSession).toHaveBeenCalledWith('s5')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('uses a native button for keyboard activation without making the toast a clickable container', async () => {
    mockFocus(true)
    const openSession = vi.fn()
    const rpc = vi.fn(async () => [event()])
    const sessions = {} as ISessions
    renderLayer(rpc, sessions, fakeTimer(), { navigation: { openSession } })
    await flush()
    const toast = document.querySelector('[role="alert"]') as HTMLElement
    act(() => { toast.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(openSession).not.toHaveBeenCalled()
    const button = action('Open session')
    expect(button.tagName).toBe('BUTTON')
    expect(button.type).toBe('button')
    act(() => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(openSession).not.toHaveBeenCalled()
    // jsdom does not synthesize native keyboard click activation.
    act(() => button.click())
    expect(openSession).toHaveBeenCalledWith('s5')
  })

  it('dismisses on close without opening the session', async () => {
    mockFocus(true)
    const openSession = vi.fn()
    const rpc = vi.fn(async () => [event()])
    const sessions = {} as ISessions
    renderLayer(rpc, sessions, fakeTimer(), { navigation: { openSession } })
    await flush()
    const close = action('Dismiss') as HTMLButtonElement
    act(() => { close.click() })
    expect(openSession).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('lets the native toast finish its twelve-second hold and one-second fade', async () => {
    vi.useFakeTimers()
    try {
      mockFocus(true)
      renderLayer(vi.fn(async () => [event()]), undefined, fakeTimer())
      await flush()
      await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
      expect(document.querySelector('[role="alert"]')).not.toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(999) })
      expect(document.querySelector('[role="alert"]')).not.toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(document.querySelector('[role="alert"]')).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('keeps one toast per session: a newer event replaces its predecessor', async () => {
    mockFocus(true)
    const queue = [
      event({ kind: 'approval', title: 'Approval needed' }),
      event({ id: '2', kind: 'question', title: 'Question asked' }),
    ]
    const rpc = vi.fn(async () => queue)
    renderLayer(rpc, undefined, fakeTimer())
    await flush()
    const toasts = document.querySelectorAll('[role="alert"]')
    expect(toasts).toHaveLength(1)
    expect(toasts[0].textContent).toContain('Question asked')
  })

  it('keeps only the latest toast even across different sessions', async () => {
    mockFocus(true)
    const queue = ['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) => event({ id: String(i), sessionId: 's-' + s, kind: 'custom', title: 'Event ' + s }))
    const rpc = vi.fn(async () => queue)
    renderLayer(rpc, undefined, fakeTimer())
    await flush()
    const toasts = document.querySelectorAll('[role="alert"]')
    expect(toasts).toHaveLength(1)
    const titles = [...toasts].map((t) => t.textContent ?? '')
    expect(titles.join()).not.toContain('Event a')
    expect(titles.join()).toContain('Event f')
  })

  it('falls back to a web notification when the user stopped looking', async () => {
    mockFocus(false)
    const { ctor } = installNotification()
    const rpc = vi.fn(async () => [event()])
    renderLayer(rpc)
    await flush()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(ctor).toHaveLength(1)
    expect(ctor[0].title).toBe('Approval needed')
  })

  it('releases a focus-loss fallback when web permission is denied without acknowledging', async () => {
    mockFocus(false)
    class Denied { static permission = 'denied' }
    Object.defineProperty(globalThis, 'Notification', { value: Denied, configurable: true })
    const rpc = vi.fn(async (method: string) => method === 'getPendingNotifications' ? [event()] : {})
    renderLayer(rpc)
    await flush()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(rpc.mock.calls.some(([method]) => method === 'releaseNotification')).toBe(true)
    expect(rpc.mock.calls.some(([method]) => method === 'acknowledgeNotifications')).toBe(false)
  })

  it('acknowledges only after a visible toast commits', async () => {
    mockFocus(true)
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getPendingNotifications') return [event()]
      if (method === 'acknowledgeNotifications') expect(document.querySelector('[role="alert"]')).not.toBeNull()
      return {}
    })
    renderLayer(rpc)
    await flush()
    expect(rpc.mock.calls.some(([method]) => method === 'acknowledgeNotifications')).toBe(true)
  })

  it('does not navigate when the close button receives Enter or Space', async () => {
    mockFocus(true)
    const openSession = vi.fn()
    renderLayer(vi.fn(async () => [event()]), {} as ISessions, undefined, { navigation: { openSession } })
    await flush()
    const close = action('Dismiss') as HTMLButtonElement
    for (const key of ['Enter', ' ']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      act(() => { close.dispatchEvent(e) })
      expect(e.defaultPrevented).toBe(false)
    }
    act(() => close.click())
    expect(openSession).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('serves the settings card test-toast bus', async () => {
    mockFocus(true)
    const rpc = vi.fn(async () => [])
    renderLayer(rpc, undefined, fakeTimer())
    await flush()
    act(() => { enqueueTestToast({ id: 9, title: 'Test toast', body: 'In-page toasts work', sessionId: 's5' }) })
    const toast = document.querySelector('[role="alert"]')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('Test toast')
  })
  it('plays delivery sound once only after the visible toast commits, not for synthetic tests', async () => {
    mockFocus(true)
    const playSound = vi.fn(async () => {
      expect(document.querySelector('[role="alert"]')).not.toBeNull()
      return true
    })
    const rpc = soundRpc()
    const timer = fakeTimer()
    renderLayer(rpc, undefined, timer, { playSound })
    expect(playSound).not.toHaveBeenCalled()
    await flush()
    expect(playSound).toHaveBeenCalledExactlyOnceWith('ping', 37)
    act(() => timer.fireInterval())
    await flush()
    expect(playSound).toHaveBeenCalledOnce()
    act(() => enqueueTestToast({ title: 'Test' }))
    expect(playSound).toHaveBeenCalledOnce()
  })

  it('acknowledges visible delivery even when sound playback rejects', async () => {
    mockFocus(true)
    const rpc = soundRpc()
    const playSound = vi.fn().mockRejectedValue(new Error('audio blocked'))
    renderLayer(rpc, undefined, undefined, { playSound })
    await flush()
    expect(playSound).toHaveBeenCalledOnce()
    expect(rpc.mock.calls.some(([method]) => method === 'acknowledgeNotifications')).toBe(true)
    expect(rpc.mock.calls.some(([method]) => method === 'releaseNotification')).toBe(false)
  })

  it('does not play sound for denied browser fallback', async () => {
    mockFocus(false)
    class Denied { static permission = 'denied' }
    Object.defineProperty(globalThis, 'Notification', { value: Denied, configurable: true })
    const playSound = vi.fn().mockResolvedValue(true)
    const rpc = soundRpc()
    renderLayer(rpc, undefined, undefined, { playSound })
    await flush()
    expect(playSound).not.toHaveBeenCalled()
    expect(rpc.mock.calls.some(([method]) => method === 'releaseNotification')).toBe(true)
  })

  it('releases without sound when focus is lost before the toast commits', async () => {
    let checks = 0
    Object.defineProperty(document, 'hasFocus', { value: () => ++checks === 1, configurable: true })
    const playSound = vi.fn().mockResolvedValue(true)
    const rpc = soundRpc()
    renderLayer(rpc, undefined, undefined, { playSound })
    await flush()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(playSound).not.toHaveBeenCalled()
    expect(rpc.mock.calls.some(([method]) => method === 'releaseNotification')).toBe(true)
    expect(rpc.mock.calls.some(([method]) => method === 'acknowledgeNotifications')).toBe(false)
  })

  it('does not replay sound for a claim resolving after unmount', async () => {
    mockFocus(true)
    let resolve!: (events: unknown[]) => void
    const pending = new Promise<unknown[]>(done => { resolve = done })
    const rpc = vi.fn(async (method: string) => method === 'getPendingNotifications' ? pending : {})
    const playSound = vi.fn().mockResolvedValue(true)
    renderLayer(rpc, undefined, undefined, { playSound })
    act(() => root!.unmount())
    root = undefined
    resolve([event({ sound: { id: 'ping', volume: 37 } })])
    await flush()
    expect(playSound).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(rpc.mock.calls.some(([method]) => method === 'releaseNotification')).toBe(true)
  })

  it('opens through optional navigation without needing a session-list service', async () => {
    mockFocus(true)
    const openSession = vi.fn()
    renderLayer(vi.fn(async () => [event()]), undefined, undefined, { navigation: { openSession } })
    await flush()
    act(() => action('Open session').click())
    expect(openSession).toHaveBeenCalledWith('s5')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('omits the Open session action when optional navigation is unavailable', async () => {
    mockFocus(true)
    renderLayer(vi.fn(async () => [event()]), {} as ISessions)
    await flush()
    expect([...document.querySelectorAll('[role="alert"] button')].map(button => button.textContent)).toEqual(['Dismiss'])
  })

  it('removes its synthetic-toast subscription on unmount', async () => {
    renderLayer(vi.fn(async () => []))
    await flush()
    act(() => root!.unmount())
    root = undefined
    act(() => enqueueTestToast({ title: 'After disposal' }))
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

})
