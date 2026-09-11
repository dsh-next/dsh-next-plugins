import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NotifierCard, type CardDeps } from '../src/client/card.tsx'
import { defaultConfig } from '../src/core/config.ts'
import type { NotifierConfig, NotifierConfigPatch } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function snapshot(config = defaultConfig()) {
  return { config, sounds: ['chime', 'bell'].map(id => ({ id, name: id, group: 'Sounds' })) }
}

function merge(config: NotifierConfig, patch: NotifierConfigPatch): NotifierConfig {
  return { ...config, ...patch, finished: { ...config.finished, ...patch.finished }, approval: { ...config.approval, ...patch.approval }, question: { ...config.question, ...patch.question } }
}

describe('NotifierCard settings lifecycle', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  let props: CardDeps
  afterEach(() => {
    act(() => { root?.unmount() })
    root = undefined
    container?.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function mount(rpc: CardDeps['rpc']) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    props = { rpc, showWebNotification: vi.fn() }
    await act(async () => { root!.render(React.createElement(NotifierCard, props)) })
    await click(container.querySelector('button[aria-expanded]')!)
  }
  async function click(element: Element) {
    await act(async () => { (element as HTMLElement).click() })
  }
  function checkbox(label: string): HTMLInputElement {
    return [...container.querySelectorAll('label')].find(el => el.textContent?.startsWith(label))!.querySelector('input')!
  }
  function slider() { return container.querySelector<HTMLInputElement>('input[type="range"]')! }
  async function volume(value: number) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider(), String(value))
      slider().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function select(value: string) {
    await act(async () => {
      const el = container.querySelector('select')!
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  function server() {
    let config = defaultConfig()
    return vi.fn(async (method: string, args?: unknown) => {
      if (method === 'setConfig') config = merge(config, args as NotifierConfigPatch)
      return snapshot(config)
    })
  }

  it('debounces rapid slider inputs across renders to one save and preview', async () => {
    vi.useFakeTimers()
    const rpc = server()
    await mount(rpc)
    await volume(20)
    await act(async () => { vi.advanceTimersByTime(400) })
    await act(async () => { root!.render(React.createElement(NotifierCard, { ...props })) })
    await volume(40)
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(rpc.mock.calls.filter(([method]) => method === 'setConfig')).toHaveLength(0)
    expect(slider().value).toBe('40')
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(rpc.mock.calls.filter(([method]) => method === 'setConfig')).toEqual([['setConfig', { volume: 40 }]])
    expect(rpc.mock.calls.filter(([method]) => method === 'preview')).toHaveLength(1)
  })

  it('cancels pending volume persistence on unmount', async () => {
    vi.useFakeTimers()
    const rpc = server()
    await mount(rpc)
    await volume(30)
    act(() => { root!.unmount(); root = undefined })
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(rpc.mock.calls.filter(([method]) => ['setConfig', 'preview'].includes(method))).toEqual([])
  })

  it('serializes saves and preserves newer optimistic nested fields during delayed responses', async () => {
    const first = deferred<ReturnType<typeof snapshot>>()
    const second = deferred<ReturnType<typeof snapshot>>()
    const rpc = vi.fn(async (method: string) => {
      if (method === 'setConfig') return rpc.mock.calls.filter(([m]) => m === 'setConfig').length === 1 ? first.promise : second.promise
      return snapshot()
    })
    await mount(rpc)
    await click(checkbox('Subagent finished'))
    await click(checkbox('Only notify when the goal completes'))
    expect(checkbox('Subagent finished').checked).toBe(true)
    expect(checkbox('Only notify when the goal completes').checked).toBe(false)
    expect(container.querySelector('select')!.disabled).toBe(false)
    expect(rpc.mock.calls.filter(([m]) => m === 'setConfig')).toEqual([['setConfig', { finished: { subagent: true } }]])
    const saved = merge(defaultConfig(), { finished: { subagent: true } })
    await act(async () => { first.resolve(snapshot(saved)) })
    expect(checkbox('Only notify when the goal completes').checked).toBe(false)
    expect(rpc.mock.calls.filter(([m]) => m === 'setConfig')).toEqual([['setConfig', { finished: { subagent: true } }], ['setConfig', { finished: { goalOnly: false } }]])
    await act(async () => { second.resolve(snapshot(merge(saved, { finished: { goalOnly: false } }))) })
    expect(checkbox('Subagent finished').checked).toBe(true)
    expect(checkbox('Mute while viewing the session').checked).toBe(true)
  })

  it('keeps a volume draft visible when another save resolves during debounce', async () => {
    vi.useFakeTimers()
    const save = deferred<ReturnType<typeof snapshot>>()
    const rpc = vi.fn(async (method: string) => method === 'setConfig' ? save.promise : snapshot())
    await mount(rpc)
    await click(checkbox('Subagent finished'))
    await volume(35)
    await act(async () => { save.resolve(snapshot(merge(defaultConfig(), { finished: { subagent: true } }))) })
    expect(slider().value).toBe('35')
  })

  it('flushes a pending volume draft before saving and previewing a sound selection', async () => {
    vi.useFakeTimers()
    const rpc = server()
    await mount(rpc)
    await volume(25)
    await select('bell')
    expect(rpc.mock.calls.filter(([m]) => ['setConfig', 'preview'].includes(m))).toEqual([
      ['setConfig', { volume: 25, finished: { soundName: 'bell' } }],
      ['preview', { id: 'bell' }],
    ])
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(rpc.mock.calls.filter(([m]) => m === 'preview')).toHaveLength(1)
    expect(slider().value).toBe('25')
  })

  it('waits for saved sound state before previewing', async () => {
    const save = deferred<ReturnType<typeof snapshot>>()
    const rpc = vi.fn(async (method: string) => method === 'setConfig' ? save.promise : snapshot())
    await mount(rpc)
    await select('bell')
    expect(rpc.mock.calls.filter(([m]) => m === 'preview')).toEqual([])
    await act(async () => { save.resolve(snapshot(merge(defaultConfig(), { finished: { soundName: 'bell' } }))) })
    expect(rpc.mock.calls.filter(([m]) => m === 'preview')).toEqual([['preview', { id: 'bell' }]])
  })

  it.each(['resolve', 'reject'] as const)('does not preview, recover, or start queued saves after unmount (%s)', async (outcome) => {
    vi.useFakeTimers()
    const save = deferred<ReturnType<typeof snapshot>>()
    const rpc = vi.fn(async (method: string) => method === 'setConfig' ? save.promise : snapshot())
    await mount(rpc)
    await volume(45)
    await act(async () => { vi.advanceTimersByTime(600) })
    await click(checkbox('Subagent finished'))
    const calls = rpc.mock.calls.length
    act(() => { root!.unmount(); root = undefined })
    await act(async () => { outcome === 'resolve' ? save.resolve(snapshot()) : save.reject(new Error('save failed')) })
    expect(rpc.mock.calls).toHaveLength(calls)
  })

  it('surfaces save errors, recovers before queued edits, and clears errors on later success', async () => {
    const save = deferred<ReturnType<typeof snapshot>>()
    const recovery = deferred<ReturnType<typeof snapshot>>()
    let saves = 0
    let reads = 0
    const rpc = vi.fn(async (method: string, args?: unknown) => {
      if (method === 'getState') return ++reads === 1 ? snapshot() : recovery.promise
      if (method === 'setConfig') return ++saves === 1 ? save.promise : snapshot(merge(defaultConfig(), args as NotifierConfigPatch))
      return {}
    })
    await mount(rpc)
    await select('bell')
    await click(checkbox('Subagent finished'))
    await act(async () => { save.reject(new Error('save failed')) })
    expect(container.textContent).toContain('save failed')
    expect(saves).toBe(1)
    expect(rpc.mock.calls.filter(([m]) => m === 'preview')).toEqual([])
    await act(async () => { recovery.resolve(snapshot()) })
    expect(saves).toBe(2)
    expect(checkbox('Subagent finished').checked).toBe(true)
    expect(container.querySelector('select')!.value).toBe('chime')
    expect(container.textContent).not.toContain('save failed')
  })

  it('suppresses stale volume previews while preserving the newest in-flight draft', async () => {
    vi.useFakeTimers()
    const first = deferred<ReturnType<typeof snapshot>>()
    let saves = 0
    const rpc = vi.fn(async (method: string, args?: unknown) => {
      if (method === 'setConfig') return ++saves === 1 ? first.promise : snapshot(merge(defaultConfig(), args as NotifierConfigPatch))
      return snapshot()
    })
    await mount(rpc)
    await volume(20)
    await act(async () => { vi.advanceTimersByTime(600) })
    await volume(80)
    await act(async () => { first.resolve(snapshot(merge(defaultConfig(), { volume: 20 }))) })
    expect(slider().value).toBe('80')
    expect(rpc.mock.calls.filter(([m]) => m === 'preview')).toEqual([])
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(slider().value).toBe('80')
    expect(rpc.mock.calls.filter(([m]) => m === 'preview')).toHaveLength(1)
  })

  it('recovers from failed recovery reads without dropping unrelated queued edits', async () => {
    const first = deferred<ReturnType<typeof snapshot>>()
    let saves = 0
    let reads = 0
    const rpc = vi.fn(async (method: string, args?: unknown) => {
      if (method === 'getState' && ++reads > 1) throw new Error('read failed')
      if (method === 'setConfig') return ++saves === 1 ? first.promise : snapshot(merge(defaultConfig(), args as NotifierConfigPatch))
      return snapshot()
    })
    await mount(rpc)
    await click(checkbox('Subagent finished'))
    await click(checkbox('Mute while viewing the session'))
    await act(async () => { first.reject(new Error('save failed')) })
    expect(checkbox('Subagent finished').checked).toBe(false)
    expect(checkbox('Mute while viewing the session').checked).toBe(false)
    expect(container.textContent).not.toContain('save failed')
    expect(saves).toBe(2)
  })

  it('surfaces preview errors without rolling back saved settings and continues saving', async () => {
    const rpc = server()
    rpc.mockImplementationOnce(async () => snapshot())
    await mount(rpc)
    const original = rpc.getMockImplementation()!
    rpc.mockImplementation(async (method, args) => {
      if (method === 'preview') throw new Error('preview failed')
      return original(method, args)
    })
    await select('bell')
    expect(container.textContent).toContain('preview failed')
    expect(container.querySelector('select')!.value).toBe('bell')
    expect(rpc.mock.calls.filter(([m]) => m === 'getState')).toHaveLength(1)
    await click(checkbox('Subagent finished'))
    expect(container.textContent).not.toContain('preview failed')
    expect(container.querySelector('select')!.value).toBe('bell')
  })

  it('ignores old saves and cancels debounce when the RPC lifecycle is replaced', async () => {
    vi.useFakeTimers()
    const save = deferred<ReturnType<typeof snapshot>>()
    const rpc = vi.fn(async (method: string) => method === 'setConfig' ? save.promise : snapshot())
    await mount(rpc)
    await select('bell')
    await volume(20)
    const replacement = server()
    await act(async () => { root!.render(React.createElement(NotifierCard, { ...props, rpc: replacement })) })
    await act(async () => { save.resolve(snapshot(merge(defaultConfig(), { volume: 20, finished: { soundName: 'bell' } }))); vi.advanceTimersByTime(1000) })
    expect(slider().value).toBe('70')
    expect(container.querySelector('select')!.value).toBe('chime')
    expect(rpc.mock.calls.filter(([m]) => m === 'preview')).toEqual([])
    expect(replacement.mock.calls.filter(([m]) => m === 'setConfig')).toEqual([])
  })

  it('shows initial load errors and clears them after a successful reload', async () => {
    await mount(vi.fn(async () => { throw new Error('load failed') }))
    expect(container.textContent).toContain('load failed')
    await act(async () => { root!.render(React.createElement(NotifierCard, { ...props, rpc: server() })) })
    expect(container.textContent).not.toContain('load failed')
    expect(slider().value).toBe('70')
  })

  it('deduplicates permission prompts and permits retry after rejection', async () => {
    const permission = deferred<NotificationPermission>()
    const request = vi.fn(() => permission.promise)
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: request })
    const rpc = server()
    await mount(rpc)
    const enable = [...container.querySelectorAll('button')].find(el => el.textContent === 'Enable')!
    await click(enable)
    await click(enable)
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => { permission.reject(new Error('permission failed')) })
    expect(container.textContent).toContain('permission failed')
    request.mockResolvedValue('granted')
    await click(enable)
    expect(request).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls.filter(([m]) => m === 'reportWebPermission')).toEqual([['reportWebPermission', { status: 'granted' }]])
    expect(container.textContent).not.toContain('permission failed')
  })

  it('does not report a permission request that resolves after unmount', async () => {
    const permission = deferred<NotificationPermission>()
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(() => permission.promise) })
    const rpc = server()
    await mount(rpc)
    await click([...container.querySelectorAll('button')].find(el => el.textContent === 'Enable')!)
    act(() => { root!.unmount(); root = undefined })
    await act(async () => { permission.resolve('granted') })
    expect(rpc.mock.calls.filter(([m]) => m === 'reportWebPermission')).toEqual([])
  })
})
