/**
 * jsdom render test for the in-page toast layer: polls the Host queue for
 * toast-channel events, renders the capsule cards, opens the session on
 * click, dismisses on close, auto-dismisses after the TTL, replaces toasts
 * per session, caps the stack, falls back to a web notification when the
 * user stopped looking, and serves the settings card's test-toast bus.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { TimerLike } from '../src/core/timer.ts'
import { ToastLayer, enqueueTestToast } from '../src/client/toasts.tsx'

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
    close = vi.fn()
    constructor(title: string, opts: { body?: string } = {}) {
      ctor.push({ title, body: opts.body ?? '' })
    }
  }
  Object.defineProperty(globalThis, 'Notification', { value: MockNotification, configurable: true, writable: true })
  return { ctor }
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    kind: 'approval',
    title: 'Approval needed',
    body: 'Waiting for your approval: bash',
    sessionId: 's5',
    at: Date.now(),
    channel: 'toast',
    ...overrides,
  }
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

  function renderLayer(rpc: (method: string) => Promise<unknown>, sessions?: ISessions, timer?: TimerLike): void {
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(React.createElement(ToastLayer, { rpc, sessions, timer }))
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
    expect(container.querySelector('[data-testid="dsh-next-notifier-toasts"]')).toBeNull()
  })

  it('renders a toast-channel event with the shared headline and session title', async () => {
    mockFocus(true)
    const rpc = vi.fn(async () => [event()])
    const sessions = ({ list: { getSnapshot: () => ({ byId: { s5: { id: 's5', displayTitle: 'Design spec' } } }) } }) as unknown as ISessions
    renderLayer(rpc, sessions, fakeTimer())
    await flush()
    const toast = container.querySelector('[data-testid="dsh-next-notifier-toast"]')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('\u26a0\ufe0f Approval needed')
    expect(toast!.textContent).toContain('Design spec')
  })

  it('falls back to the event body when the session is unknown', async () => {
    mockFocus(true)
    const rpc = vi.fn(async () => [event({ sessionId: 'ghost' })])
    renderLayer(rpc)
    await flush()
    expect(container.querySelector('[data-testid="dsh-next-notifier-toast"]')!.textContent)
      .toContain('Waiting for your approval: bash')
  })

  it('ignores web-channel and legacy events (the web drainer owns them)', async () => {
    mockFocus(true)
    const rpc = vi.fn(async () => [
      event({ channel: 'web', title: 'web-bound' }),
      event({ channel: undefined, title: 'legacy' }),
    ])
    renderLayer(rpc)
    await flush()
    expect(container.querySelector('[data-testid="dsh-next-notifier-toast"]')).toBeNull()
  })

  it('opens the session when the toast is clicked', async () => {
    mockFocus(true)
    const open = vi.fn()
    const rpc = vi.fn(async () => [event()])
    const sessions = { open } as unknown as ISessions
    renderLayer(rpc, sessions, fakeTimer())
    await flush()
    const toast = container.querySelector('[data-testid="dsh-next-notifier-toast"]') as HTMLElement
    act(() => { toast.click() })
    expect(open).toHaveBeenCalledWith('s5')
    expect(container.querySelector('[data-testid="dsh-next-notifier-toast"]')).toBeNull()
  })

  it('opens the session from the keyboard without dismissing on other keys', async () => {
    mockFocus(true)
    const open = vi.fn()
    const rpc = vi.fn(async () => [event()])
    const sessions = { open } as unknown as ISessions
    renderLayer(rpc, sessions, fakeTimer())
    await flush()
    const toast = container.querySelector('[data-testid="dsh-next-notifier-toast"]') as HTMLElement
    act(() => { toast.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(open).not.toHaveBeenCalled()
    act(() => { toast.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(open).toHaveBeenCalledWith('s5')
  })

  it('dismisses on close without opening the session', async () => {
    mockFocus(true)
    const open = vi.fn()
    const rpc = vi.fn(async () => [event()])
    const sessions = { open } as unknown as ISessions
    renderLayer(rpc, sessions, fakeTimer())
    await flush()
    const close = container.querySelector('[data-testid="dsh-next-notifier-toast-close"]') as HTMLButtonElement
    act(() => { close.click() })
    expect(open).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="dsh-next-notifier-toast"]')).toBeNull()
  })

  it('auto-dismisses after the 12s TTL', async () => {
    mockFocus(true)
    const timer = fakeTimer()
    const rpc = vi.fn(async () => [event()])
    renderLayer(rpc, undefined, timer)
    await flush()
    expect(container.querySelector('[data-testid="dsh-next-notifier-toast"]')).not.toBeNull()
    act(() => { timer.fireTimeouts() })
    expect(container.querySelector('[data-testid="dsh-next-notifier-toast"]')).toBeNull()
  })

  it('keeps one toast per session: a newer event replaces its predecessor', async () => {
    mockFocus(true)
    const queue = [
      event({ kind: 'approval', title: 'Approval needed' }),
      event({ kind: 'question', title: 'Question asked' }),
    ]
    const rpc = vi.fn(async () => queue)
    renderLayer(rpc, undefined, fakeTimer())
    await flush()
    const toasts = container.querySelectorAll('[data-testid="dsh-next-notifier-toast"]')
    expect(toasts).toHaveLength(1)
    expect(toasts[0].textContent).toContain('Question asked')
  })

  it('caps the stack at five, dropping the oldest', async () => {
    mockFocus(true)
    const queue = ['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) => event({ id: i, sessionId: 's-' + s, title: 'Event ' + s }))
    const rpc = vi.fn(async () => queue)
    renderLayer(rpc, undefined, fakeTimer())
    await flush()
    const toasts = container.querySelectorAll('[data-testid="dsh-next-notifier-toast"]')
    expect(toasts).toHaveLength(5)
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
    expect(container.querySelector('[data-testid="dsh-next-notifier-toast"]')).toBeNull()
    expect(ctor).toHaveLength(1)
    expect(ctor[0].title).toBe('\u26a0\ufe0f Approval needed')
  })

  it('serves the settings card test-toast bus', async () => {
    mockFocus(true)
    const rpc = vi.fn(async () => [])
    renderLayer(rpc, undefined, fakeTimer())
    await flush()
    act(() => { enqueueTestToast({ id: 9, title: 'Test toast', body: 'In-page toasts work', sessionId: 's5' }) })
    const toast = container.querySelector('[data-testid="dsh-next-notifier-toast"]')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('\ud83d\udd14 Test toast')
  })
})
