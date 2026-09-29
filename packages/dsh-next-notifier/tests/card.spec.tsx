import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ConfigPageForm } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { NotifierCard, NotifierSettings, type CardDeps } from '../src/client/card.tsx'
import { defaultConfig } from '../src/core/config.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('NotifierSettings shared host form subscription', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  const delivery = { preview: vi.fn(async () => true), reportPermission: vi.fn(), testSystem: vi.fn(async () => true), testToast: vi.fn() }
  afterEach(async () => {
    await act(async () => { root?.unmount() })
    root = undefined
    container?.remove()
  })
  function sharedForm(volume = 70) {
    let state: ConfigPageForm['state'] = { mode: 'host', status: 'ready', value: { ...defaultConfig(), volume }, base: {}, user: {}, writable: true, revision: 4 }
    const listeners = new Set<() => void>()
    const cleanups: ReturnType<typeof vi.fn>[] = []
    const getSnapshot = vi.fn(() => state)
    const subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener)
      const cleanup = vi.fn(() => { listeners.delete(listener) })
      cleanups.push(cleanup)
      return cleanup
    })
    const publish = (patch: Partial<ConfigPageForm['state']>) => {
      state = { ...state, ...patch }
      for (const listener of listeners) listener()
    }
    const mutate = vi.fn<ConfigPageForm['mutate']>(async ops => {
      const value = { ...state.value } as Record<string, unknown>
      for (const op of ops) {
        const [field, child] = op.path
        if (child) value[field] = { ...(value[field] as object), [child]: op.op === 'set' ? op.value : undefined }
        else value[field] = op.op === 'set' ? op.value : (state.base as Record<string, unknown> | undefined)?.[field]
      }
      publish({ value, revision: (state.revision ?? 0) + 1 })
      return true
    })
    // Only the public external-store and mutation methods are consumed by this wrapper.
    const form = { getSnapshot, subscribe, mutate } as unknown as ConfigForm<Record<string, unknown>>
    return { form, listeners, cleanups, getSnapshot, subscribe, mutate, publish }
  }
  async function render(form: ConfigForm<Record<string, unknown>>, strict = false) {
    if (!root) {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
    }
    await act(async () => {
      const page = <NotifierSettings {...delivery} form={form} />
      root!.render(strict ? <React.StrictMode>{page}</React.StrictMode> : page)
    })
  }

  it.each([false, true])('subscribes to authoritative snapshots and cleans up every subscription (StrictMode=%s)', async strict => {
    const host = sharedForm(31)
    await render(host.form, strict)
    expect(container.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('31')
    expect(host.listeners.size).toBe(1)
    await act(async () => { host.publish({ value: { ...defaultConfig(), volume: 46 } }) })
    expect(container.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('46')
    // Snapshot updates must not replace the stable subscription callback.
    expect(host.subscribe).toHaveBeenCalledTimes(strict ? 2 : 1)
    await act(async () => { root!.unmount(); root = undefined })
    expect(host.listeners.size).toBe(0)
    for (const cleanup of host.cleanups) expect(cleanup).toHaveBeenCalledOnce()
    const reads = host.getSnapshot.mock.calls.length
    await act(async () => { host.publish({ value: { ...defaultConfig(), volume: 99 } }) })
    expect(host.getSnapshot).toHaveBeenCalledTimes(reads)
    expect(container.childElementCount).toBe(0)
  })

  it('unsubscribes from a replaced form and ignores its subsequent snapshots', async () => {
    const old = sharedForm(25)
    const current = sharedForm(60)
    await render(old.form)
    await render(current.form)
    expect(old.listeners.size).toBe(0)
    expect(old.cleanups[0]).toHaveBeenCalledOnce()
    expect(current.listeners.size).toBe(1)
    await act(async () => { old.publish({ value: { ...defaultConfig(), volume: 5 } }) })
    expect(container.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('60')
    await act(async () => { current.publish({ writable: false }) })
    expect(container.querySelector<HTMLInputElement>('input[type="range"]')!.disabled).toBe(true)
  })

  it('forwards autosave operations to the shared form and displays the accepted snapshot', async () => {
    const host = sharedForm()
    await render(host.form)
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Subagent finished"]')!
    await act(async () => { toggle.click() })
    expect(host.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['finished', 'subagent'], value: true }], undefined)
    expect(host.getSnapshot().value).toMatchObject({ finished: { subagent: true } })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(host.subscribe).toHaveBeenCalledOnce()
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Save')).toBe(false)
  })
})

describe('NotifierCard device delivery controls', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  let props: CardDeps
  afterEach(() => {
    act(() => { root?.unmount() })
    root = undefined
    container?.remove()
    vi.unstubAllGlobals()
  })
  async function mount(extra: Partial<CardDeps> = {}, strict = false) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    props = {
      form: { state: { mode: 'host', status: 'ready', value: { ...defaultConfig() }, base: {}, user: {}, writable: true, revision: 4 }, mutate: vi.fn(async () => true) },
      preview: vi.fn(async () => true), reportPermission: vi.fn(), testSystem: vi.fn(async () => true), testToast: vi.fn(), ...extra,
    }
    await act(async () => { root!.render(strict ? <React.StrictMode><NotifierCard {...props} /></React.StrictMode> : <NotifierCard {...props} />) })
  }
  const button = (label: string) => [...container.querySelectorAll('button')].find(el => el.textContent === label)!
  async function click(el: HTMLElement) { await act(async () => { el.click() }) }
  function permission(value: NotificationPermission) {
    const api = { permission: value, requestPermission: vi.fn(async () => 'granted' as NotificationPermission) }
    vi.stubGlobal('Notification', api)
    return api
  }

  it('tests a granted system notification and an in-page toast without settings writes', async () => {
    const api = permission('granted')
    await mount()
    expect(container.querySelector('section[aria-label="Delivery on this device"]')).not.toBeNull()
    await click(button('Test'))
    await click(button('Show'))
    expect(props.testSystem).toHaveBeenCalledExactlyOnceWith()
    expect(props.testToast).toHaveBeenCalledOnce()
    expect(api.requestPermission).not.toHaveBeenCalled()
    expect(props.form!.mutate).not.toHaveBeenCalled()
    expect(props.preview).not.toHaveBeenCalled()
  })

  it.each(['granted', 'default', 'denied'] as const)('requests default permission and reflects a %s result without testing delivery', async result => {
    const api = permission('default')
    api.requestPermission.mockResolvedValue(result)
    await mount()
    await click(button('Enable'))
    expect(api.requestPermission).toHaveBeenCalledOnce()
    expect(props.reportPermission).toHaveBeenCalledOnce()
    expect(props.testSystem).not.toHaveBeenCalled()
    expect(props.form!.mutate).not.toHaveBeenCalled()
    const control = button(result === 'granted' ? 'Test' : 'Enable')
    expect(control.disabled).toBe(result === 'denied')
  })

  it.each(['denied', 'unsupported'] as const)('disables system delivery for %s but allows the in-page toast', async status => {
    const request = status === 'denied' ? permission('denied').requestPermission : vi.fn()
    if (status === 'unsupported') vi.stubGlobal('Notification', undefined)
    await mount()
    expect(container.textContent).toContain(status === 'denied' ? 'Allow notifications in your browser or system settings' : 'In-app alerts still work')
    expect(button('Enable').disabled).toBe(true)
    await click(button('Enable'))
    await click(button('Show'))
    expect(request).not.toHaveBeenCalled()
    expect(props.testSystem).not.toHaveBeenCalled()
    expect(props.testToast).toHaveBeenCalledOnce()
  })

  it('deduplicates same-turn permission requests and allows retry after rejection', async () => {
    const api = permission('default')
    const pending = deferred<NotificationPermission>()
    api.requestPermission.mockReturnValueOnce(pending.promise)
    await mount()
    const enable = button('Enable')
    await act(async () => { enable.click(); enable.click() })
    expect(api.requestPermission).toHaveBeenCalledOnce()
    expect(enable.disabled).toBe(true)
    await act(async () => { pending.reject(new Error('permission failed')) })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('The system did not confirm')
    expect(enable.disabled).toBe(false)
    await click(enable)
    expect(api.requestPermission).toHaveBeenCalledTimes(2)
    expect(props.reportPermission).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it.each(['false', 'reject'] as const)('reports %s system delivery and clears the error on retry', async outcome => {
    permission('granted')
    const testSystem = vi.fn(async () => true)
    if (outcome === 'false') testSystem.mockResolvedValueOnce(false)
    else testSystem.mockRejectedValueOnce(new Error('delivery failed'))
    await mount({ testSystem })
    await click(button('Test'))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('The system did not confirm')
    await click(button('Test'))
    expect(testSystem).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(props.form!.mutate).not.toHaveBeenCalled()
  })

  it('deduplicates pending system tests without blocking toast delivery', async () => {
    permission('granted')
    const pending = deferred<boolean>()
    await mount({ testSystem: vi.fn(() => pending.promise) })
    const test = button('Test')
    await act(async () => { test.click(); test.click() })
    expect(props.testSystem).toHaveBeenCalledOnce()
    expect(test.disabled).toBe(true)
    await click(button('Show'))
    expect(props.testToast).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(true) })
    expect(test.disabled).toBe(false)
  })

  it('refreshes permission on focus and removes its listener on unmount under StrictMode', async () => {
    const api = permission('denied')
    await mount({}, true)
    expect(button('Enable').disabled).toBe(true)
    api.permission = 'granted'
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(button('Test').disabled).toBe(false)
    expect(props.reportPermission).toHaveBeenCalledOnce()
    api.permission = 'denied'
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(button('Enable').disabled).toBe(true)
    expect(props.reportPermission).toHaveBeenCalledTimes(2)
    act(() => { root!.unmount(); root = undefined })
    window.dispatchEvent(new Event('focus'))
    expect(props.reportPermission).toHaveBeenCalledTimes(2)
  })

  it('does not leave permission controls busy when the reporting callback changes during a request', async () => {
    const api = permission('default')
    const pending = deferred<NotificationPermission>()
    api.requestPermission.mockReturnValueOnce(pending.promise)
    await mount()
    await click(button('Enable'))
    const originalReport = props.reportPermission
    props = { ...props, reportPermission: vi.fn() }
    await act(async () => { root!.render(<NotifierCard {...props} />) })
    await act(async () => { pending.resolve('default') })
    expect(button('Enable').disabled).toBe(false)
    await click(button('Enable'))
    expect(api.requestPermission).toHaveBeenCalledTimes(2)
    expect(originalReport).not.toHaveBeenCalled()
    expect(props.reportPermission).toHaveBeenCalledOnce()
  })

  it.each(['resolve', 'reject'] as const)('ignores a permission result after StrictMode unmount (%s)', async outcome => {
    const api = permission('default')
    const pending = deferred<NotificationPermission>()
    api.requestPermission.mockReturnValue(pending.promise)
    await mount({}, true)
    await click(button('Enable'))
    act(() => { root!.unmount(); root = undefined })
    await act(async () => { outcome === 'resolve' ? pending.resolve('granted') : pending.reject(new Error('late')) })
    expect(props.reportPermission).not.toHaveBeenCalled()
    expect(props.testSystem).not.toHaveBeenCalled()
    expect(container.childElementCount).toBe(0)
  })

  it.each(['resolve', 'reject'] as const)('ignores a pending system test after StrictMode unmount (%s)', async outcome => {
    permission('granted')
    const pending = deferred<boolean>()
    await mount({ testSystem: vi.fn(() => pending.promise) }, true)
    await click(button('Test'))
    act(() => { root!.unmount(); root = undefined })
    await act(async () => { outcome === 'resolve' ? pending.resolve(false) : pending.reject(new Error('late')) })
    expect(props.testSystem).toHaveBeenCalledOnce()
    expect(container.childElementCount).toBe(0)
  })

  it('uses button keyboard semantics for device controls, never an implicit form submit', async () => {
    permission('granted')
    await mount()
    for (const label of ['Test', 'Show']) {
      const control = button(label)
      expect(control.type).toBe('button')
      control.focus()
      await act(async () => {
        control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        // Supply the native activation that jsdom does not implement.
        control.click()
        control.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
      })
      expect(document.activeElement).toBe(control)
    }
    expect(props.testSystem).toHaveBeenCalledOnce()
    expect(props.testToast).toHaveBeenCalledOnce()
    expect(props.form!.mutate).not.toHaveBeenCalled()
  })
})
