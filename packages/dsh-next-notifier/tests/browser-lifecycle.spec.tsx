import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { TimerLike } from '../src/core/timer.ts'
import type { Delivery } from '../src/core/notifications.ts'
import type { CardDeps } from '../src/client/card.tsx'
import { showWebNotification } from '../src/client/drainer.ts'
import { ToastLayer } from '../src/client/toasts.tsx'
import { apply } from '../src/client/index.ts'
import { englishTranslate } from '../src/client/dictionaries.ts'

class BrowserNotification {
  static permission = 'granted'
  static instances: BrowserNotification[] = []
  onclick: (() => void) | null = null
  onshow: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()
  constructor(readonly title: string, readonly options: NotificationOptions) {
    BrowserNotification.instances.push(this)
  }
}

const roots = new Map<Root, HTMLElement>()
const timer: TimerLike = {
  interval: (callback, ms) => { const id = setInterval(callback, ms); return () => clearInterval(id) },
  timeout: (callback, ms) => { const id = setTimeout(callback, ms); return () => clearTimeout(id) },
}
const delivery = (): Delivery => ({
  id: 'notification', lease: 'lease', leaseExpiresAt: Date.now() + 10000, at: Date.now(),
  kind: 'finished', title: 'Agent finished', body: 'Done', sessionId: 'agent',
})
async function flush(): Promise<void> {
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
}
function render(element: React.ReactElement): Root {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.set(root, container)
  act(() => root.render(element))
  return root
}
function unmount(root: Root): void {
  const container = roots.get(root)
  if (!container) return
  act(() => root.unmount())
  container.remove()
  roots.delete(root)
}
function expectDetached(notification: BrowserNotification): void {
  expect(notification.onclick).toBeNull()
  expect(notification.onshow).toBeNull()
  expect(notification.onerror).toBeNull()
  expect(notification.onclose).toBeNull()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Notification', BrowserNotification)
  BrowserNotification.instances = []
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
})
afterEach(async () => {
  for (const root of roots.keys()) unmount(root)
  await flush()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('browser acceptance and handle lifetime', () => {
  it('waits for onshow, then keeps the notification open until twelve seconds', async () => {
    const onClose = vi.fn()
    const handle = showWebNotification(delivery(), undefined, onClose)!
    const notification = BrowserNotification.instances[0]
    const settled = vi.fn()
    void handle.shown.then(settled)
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).not.toHaveBeenCalled()
    expect(notification.close).not.toHaveBeenCalled()
    notification.onshow!()
    await expect(handle.shown).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(10999)
    expect(notification.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(notification.close).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expectDetached(notification)
    expect(vi.getTimerCount()).toBe(0)
    handle.close()
    expect(notification.close).toHaveBeenCalledOnce()
    await expect(handle.shown).resolves.toBe(true)
  })

  it.each(['error', 'browser-close', 'explicit-close', 'no-show'] as const)('settles false and disposes every callback/timer on %s before acceptance', async failure => {
    const onClose = vi.fn()
    const handle = showWebNotification(delivery(), undefined, onClose)!
    const notification = BrowserNotification.instances[0]
    if (failure === 'error') notification.onerror!()
    if (failure === 'browser-close') notification.onclose!()
    if (failure === 'explicit-close') handle.close()
    if (failure === 'no-show') {
      const settled = vi.fn()
      void handle.shown.then(settled)
      await vi.advanceTimersByTimeAsync(1999)
      expect(settled).not.toHaveBeenCalled()
      expect(notification.close).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
    }
    await expect(handle.shown).resolves.toBe(false)
    handle.close()
    expect(notification.close).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expectDetached(notification)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(12000)
    expect(notification.close).toHaveBeenCalledOnce()
  })

  it('preserves successful acceptance if an error arrives after onshow', async () => {
    const handle = showWebNotification(delivery(), undefined)!
    const notification = BrowserNotification.instances[0]
    notification.onshow!()
    notification.onerror!()
    await expect(handle.shown).resolves.toBe(true)
    expect(notification.close).toHaveBeenCalledOnce()
    expectDetached(notification)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('overlay browser confirmation wiring', () => {
  function mount() {
    let claimed = false
    const event = delivery()
    const rpc = vi.fn(async (method: string, _args?: unknown) => {
      if (method === 'getPendingNotifications') {
        if (claimed) return []
        claimed = true
        return [event]
      }
      return { ok: true }
    })
    const root = render(React.createElement(ToastLayer, { rpc, timer }))
    const called = (method: string) => rpc.mock.calls.filter(([name]) => name === method)
    return { root, rpc, event, called }
  }

  it('never ACKs a constructor or elapsed time, only a delayed browser onshow', async () => {
    const { root, called, event } = mount()
    await flush()
    expect(BrowserNotification.instances).toHaveLength(1)
    expect(called('acknowledgeNotifications')).toHaveLength(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(called('acknowledgeNotifications')).toHaveLength(0)
    BrowserNotification.instances[0].onshow!()
    await flush()
    expect(called('acknowledgeNotifications')).toEqual([['acknowledgeNotifications', { id: event.id, lease: event.lease }]])
    expect(called('releaseNotification')).toHaveLength(0)
    unmount(root)
    expect(BrowserNotification.instances[0].close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['error', 'no-show'] as const)('releases an unaccepted %s without an ACK', async failure => {
    const { root, called, event } = mount()
    await flush()
    if (failure === 'error') BrowserNotification.instances[0].onerror!()
    else await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await flush()
    expect(called('acknowledgeNotifications')).toHaveLength(0)
    expect(called('releaseNotification')).toEqual([['releaseNotification', { id: event.id, lease: event.lease }]])
    expect(BrowserNotification.instances[0].close).toHaveBeenCalledOnce()
    unmount(root)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unmounts a pending browser handle and prevents late acceptance or polling', async () => {
    const { root, rpc, called } = mount()
    await flush()
    const notification = BrowserNotification.instances[0]
    const lateShow = notification.onshow!
    unmount(root)
    lateShow()
    await flush()
    expect(called('acknowledgeNotifications')).toHaveLength(0)
    expect(called('releaseNotification')).toHaveLength(1)
    expect(notification.close).toHaveBeenCalledOnce()
    expectDetached(notification)
    const count = rpc.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(20000)
    expect(rpc).toHaveBeenCalledTimes(count)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('client entrypoint effect ownership', () => {
  it('closes presence and notifications, aborts RPCs, and disposes slots across replacement', async () => {
    const clientIds: string[] = []
    for (let generation = 0; generation < 2; generation++) {
      const effects: (() => void)[] = []
      const registered = new Map<string, () => React.ReactElement>()
      const slotOffs: ReturnType<typeof vi.fn>[] = []
      const unsubscribe = vi.fn()
      const unregisterLocale = vi.fn()
      const slots = {
        inject: (_name: string, setup: () => () => void) => { effects.push(setup()) },
        register: (spec: { name: string }, factory: () => React.ReactElement) => {
          registered.set(spec.name, factory)
          const off = vi.fn(() => {
            registered.delete(spec.name)
            if (spec.name === 'shell.overlay' && overlay) unmount(overlay)
          })
          slotOffs.push(off)
          return off
        },
      }
      const sessions = { list: { getSnapshot: () => ({ current: 'other' }), subscribe: () => unsubscribe } }
      const locale = { register: vi.fn(() => unregisterLocale), bind: vi.fn(() => englishTranslate) }
      const services: Record<string, unknown> = { slots, sessions, timer, locale }
      const ctx = { get: (name: string) => services[name], effect: (setup: () => () => void) => { effects.push(setup()) } }
      const requests: { method: string; args: Record<string, unknown>; signal: AbortSignal; keepalive: boolean | undefined }[] = []
      const fetcher = vi.fn((_path: unknown, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { method: string; args: Record<string, unknown> }
        const signal = init.signal as AbortSignal
        requests.push({ ...body, signal, keepalive: init.keepalive })
        if (body.method === 'getState') return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
        const result = body.method === 'getPendingNotifications' ? [delivery()] : { ok: true }
        return Promise.resolve({ ok: true, json: async () => result } as Response)
      })
      vi.stubGlobal('fetch', fetcher)
      let overlay: Root | undefined
      apply(ctx as unknown as Context)
      const card = registered.get('settings.plugin.item')!() as React.ReactElement<CardDeps>
      overlay = render(registered.get('shell.overlay')!())
      await flush()
      const overlayNotification = BrowserNotification.instances.at(-1)!
      card.props.showWebNotification({ title: 'Test notification' })
      const testNotification = BrowserNotification.instances.at(-1)!
      const pending = card.props.rpc('getState').catch(error => error)
      const stateRequest = requests.find(request => request.method === 'getState')!
      expect(stateRequest.signal.aborted).toBe(false)
      expect(overlayNotification.close).not.toHaveBeenCalled()
      expect(testNotification.close).not.toHaveBeenCalled()
      for (const dispose of effects.reverse()) dispose()
      await flush()
      expect(stateRequest.signal.aborted).toBe(true)
      expect(await pending).toBeInstanceOf(Error)
      const closed = requests.filter(request => request.method === 'reportPresence' && request.args.open === false)
      expect(closed).toHaveLength(1)
      expect(closed[0].keepalive).toBe(true)
      expect(closed[0].signal.aborted).toBe(false)
      expect(closed[0].args).toMatchObject({ focused: false, visible: false, sessionId: null })
      clientIds.push(closed[0].args.clientId as string)
      expect(overlayNotification.close).toHaveBeenCalledOnce()
      expect(testNotification.close).toHaveBeenCalledOnce()
      expectDetached(overlayNotification)
      expectDetached(testNotification)
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(unregisterLocale).toHaveBeenCalledOnce()
      expect(registered.size).toBe(0)
      for (const off of slotOffs) expect(off).toHaveBeenCalledOnce()
      const count = requests.length
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('pagehide'))
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(20000)
      expect(requests).toHaveLength(count)
      expect(vi.getTimerCount()).toBe(0)
    }
    expect(new Set(clientIds).size).toBe(2)
  })
})
