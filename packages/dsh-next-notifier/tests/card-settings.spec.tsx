import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ConfigPageForm } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { NotifierCard, type CardDeps } from '../src/client/card.tsx'
import { defaultConfig } from '../src/core/config.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
type MockForm = Omit<ConfigPageForm, 'state'> & { state: ConfigPageForm['state']; publish?: () => void }
function form(overrides: Partial<ConfigPageForm['state']> = {}): MockForm {
  const settings: MockForm = {
    state: { mode: 'host', status: 'ready', value: { ...defaultConfig() }, base: {}, user: {}, writable: true, revision: 7, ...overrides },
    mutate: vi.fn<ConfigPageForm['mutate']>(async ops => {
      // The native host publishes its accepted snapshot before resolving mutate.
      const value = { ...settings.state.value } as Record<string, unknown>
      for (const op of ops) {
        const [field, child] = op.path
        if (child) value[field] = { ...(value[field] as object), [child]: op.op === 'set' ? op.value : undefined }
        else value[field] = op.op === 'set' ? op.value : (settings.state.base as Record<string, unknown> | undefined)?.[field]
      }
      settings.state = { ...settings.state, value, revision: (settings.state.revision ?? 0) + 1 }
      settings.publish?.()
      return true
    }),
  }
  return settings
}

describe('NotifierCard automatic settings', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  let props: CardDeps
  let strict = false
  let pageMounted = false
  afterEach(async () => {
    pageMounted = false
    await act(async () => { root?.unmount() })
    root = undefined
    container?.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  async function mount(settings = form(), extra: Partial<CardDeps> = {}, strictMode = false) {
    strict = strictMode
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    props = { form: settings, preview: vi.fn(async () => true), reportPermission: vi.fn(), testSystem: vi.fn(async () => true), testToast: vi.fn(), ...extra }
    settings.publish = () => {
      props = { ...props, form: { state: settings.state, mutate: settings.mutate } }
      if (pageMounted) paint()
    }
    await render()
    return settings
  }
  function paint() { root!.render(strict ? <React.StrictMode><NotifierCard {...props} /></React.StrictMode> : <NotifierCard {...props} />) }
  async function render() { pageMounted = true; await act(async () => { paint() }) }
  async function unmountPage() { pageMounted = false; await act(async () => { root!.render(null) }) }
  async function snapshot(settings: MockForm, state: Partial<ConfigPageForm['state']>) {
    await act(async () => { settings.state = { ...settings.state, ...state }; settings.publish!() })
  }
  const button = (label: string) => [...container.querySelectorAll('button')].find(el => el.textContent === label)!
  const toggle = (label: string) => container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!
  const slider = () => container.querySelector<HTMLInputElement>('input[type="range"]')!
  const group = (label = 'Agent finished') => container.querySelector<HTMLElement>(`section[aria-label="${label}"]`)!
  async function click(el: HTMLElement) { await act(async () => { el.click() }) }
  async function volume(value: number) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider(), String(value))
      slider().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function sound(value: string, label = 'Agent finished') {
    await act(async () => {
      const select = group(label).querySelector('select')!
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms) }) }

  it('renders settings directly without a disclosure or Save button', async () => {
    await mount()
    expect(container.querySelector('[data-testid="dsh-next-notifier-settings"]')).not.toBeNull()
    expect(container.querySelector('button[aria-expanded]')).toBeNull()
    expect(toggle('Enable notifications').getAttribute('aria-checked')).toBe('true')
    expect(button('Save')).toBeUndefined()
    expect(container.querySelectorAll('select')).toHaveLength(3)
  })

  it('immediately persists switches and selects as leaf operations without automatic previews', async () => {
    const settings = await mount()
    await click(toggle('Subagent finished'))
    await click(toggle('Only notify when the goal completes'))
    await click(toggle('Mute while viewing the session'))
    await sound('bell')
    await sound('ping', 'Approval needed')
    await sound('chime', 'Question asked')
    expect(vi.mocked(settings.mutate).mock.calls).toEqual([
      [[{ op: 'set', path: ['finished', 'subagent'], value: true }]],
      [[{ op: 'set', path: ['finished', 'goalOnly'], value: false }]],
      [[{ op: 'set', path: ['suppressFocused'], value: false }]],
      [[{ op: 'set', path: ['finished', 'soundName'], value: 'bell' }]],
      [[{ op: 'set', path: ['approval', 'soundName'], value: 'ping' }]],
      [[{ op: 'set', path: ['question', 'soundName'], value: 'chime' }]],
    ])
    expect(settings.state.value).toMatchObject({ finished: { subagent: true, goalOnly: false, soundName: 'bell' }, suppressFocused: false })
    expect(props.preview).not.toHaveBeenCalled()
  })

  it('optimistically coalesces slider changes for 250ms after the latest edit', async () => {
    vi.useFakeTimers()
    const settings = await mount()
    await volume(20)
    expect(slider().value).toBe('20')
    await advance(200)
    await volume(40)
    await advance(249)
    expect(settings.mutate).not.toHaveBeenCalled()
    expect(slider().value).toBe('40')
    await advance(1)
    expect(settings.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['volume'], value: 40 }])
    expect(settings.state.value).toMatchObject({ volume: 40 })
  })

  it('serializes in-flight writes while coalescing pending edits in their latest order', async () => {
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    const settings = form()
    vi.mocked(settings.mutate).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await mount(settings)
    await click(toggle('Subagent finished'))
    await sound('bell')
    await click(toggle('Only notify when the goal completes'))
    await sound('ping')
    expect(settings.mutate).toHaveBeenCalledTimes(1)
    expect(slider().disabled).toBe(false)
    expect(toggle('Enable notifications').disabled).toBe(false)
    expect(button('Restore inherited settings').disabled).toBe(false)
    expect(group().querySelector('select')!.value).toBe('ping')
    await snapshot(settings, { revision: 8, value: { ...defaultConfig(), volume: 42, finished: { ...defaultConfig().finished, subagent: true } } })
    expect(slider().value).toBe('42')
    expect(group().querySelector('select')!.value).toBe('ping')
    await act(async () => { first.resolve(true) })
    expect(settings.mutate).toHaveBeenNthCalledWith(2, [
      { op: 'set', path: ['finished', 'goalOnly'], value: false },
      { op: 'set', path: ['finished', 'soundName'], value: 'ping' },
    ])
    await snapshot(settings, { revision: 9, value: { ...settings.state.value, finished: { ...defaultConfig().finished, subagent: true, goalOnly: false, soundName: 'ping' } } })
    await act(async () => { second.resolve(true) })
    expect(toggle('Subagent finished').getAttribute('aria-checked')).toBe('true')
    expect(group().querySelector('select')!.value).toBe('ping')
  })

  it.each(['before', 'after'] as const)('drains pending volume when the in-flight write settles %s the debounce deadline', async timing => {
    vi.useFakeTimers()
    const pending = deferred<boolean>()
    const settings = form()
    vi.mocked(settings.mutate).mockReturnValueOnce(pending.promise)
    await mount(settings)
    await sound('bell')
    await volume(20)
    await volume(38)
    await advance(249)
    expect(settings.mutate).toHaveBeenCalledOnce()
    if (timing === 'before') {
      await act(async () => { pending.resolve(true) })
      expect(settings.mutate).toHaveBeenCalledOnce()
      await advance(1)
    } else {
      await advance(1)
      expect(settings.mutate).toHaveBeenCalledOnce()
      await act(async () => { pending.resolve(true) })
    }
    expect(settings.mutate).toHaveBeenNthCalledWith(2, [{ op: 'set', path: ['volume'], value: 38 }])
    expect(slider().value).toBe('38')
  })

  it.each(['refused', 'rejected'] as const)('rolls back to the latest authoritative snapshot on %s and recovers on the next edit', async outcome => {
    const pending = deferred<boolean>()
    const settings = form()
    vi.mocked(settings.mutate).mockReturnValueOnce(pending.promise)
    await mount(settings)
    await sound('bell')
    expect(group().querySelector('select')!.value).toBe('bell')
    await snapshot(settings, { revision: 12, value: { ...defaultConfig(), volume: 33, finished: { ...defaultConfig().finished, soundName: 'chime' } } })
    await act(async () => { outcome === 'refused' ? pending.resolve(false) : pending.reject(new Error('offline')) })
    expect(container.textContent).toContain('The change was not saved')
    expect(group().querySelector('select')!.value).toBe('chime')
    expect(slider().value).toBe('33')
    await sound('ping')
    expect(settings.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['finished', 'soundName'], value: 'ping' }])
    expect(group().querySelector('select')!.value).toBe('ping')
    expect(container.textContent).not.toContain('The change was not saved')
  })

  it.each(['loading', 'unavailable'] as const)('renders %s without editable settings but keeps device tests', async status => {
    const settings = await mount(form({ status }))
    expect(container.textContent).toContain(status === 'loading' ? 'Loading notification settings' : 'Notification settings are unavailable')
    expect(container.querySelector('[role="switch"]')).toBeNull()
    expect(button('Save')).toBeUndefined()
    await click(button('Show'))
    expect(props.testToast).toHaveBeenCalledOnce()
    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it('handles an absent form and a later ready snapshot', async () => {
    await mount(form(), { form: undefined })
    expect(container.textContent).toContain('Notification settings are unavailable')
    props = { ...props, form: form() }
    await render()
    expect(slider().value).toBe('70')
  })

  it('renders readonly values and disables settings without disabling device tests', async () => {
    const settings = await mount(form({ writable: false }))
    expect(container.textContent).toContain('Settings are read-only')
    for (const el of container.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('[role="switch"], input, select')) expect(el.disabled).toBe(true)
    expect(button('Restore inherited settings').disabled).toBe(true)
    expect(button('Save')).toBeUndefined()
    await click(button('Show'))
    expect(props.testToast).toHaveBeenCalledOnce()
    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it('automatically restores inherited fields rather than hardcoded defaults', async () => {
    vi.useFakeTimers()
    const base = { ...defaultConfig(), volume: 33, finished: { ...defaultConfig().finished, soundName: 'bell', subagent: true } }
    const settings = await mount(form({ base }))
    await volume(22)
    await click(button('Restore inherited settings'))
    expect(slider().value).toBe('33')
    expect(group().querySelector('select')!.value).toBe('bell')
    expect(toggle('Subagent finished').getAttribute('aria-checked')).toBe('true')
    expect(settings.mutate).toHaveBeenCalledExactlyOnceWith(Object.keys(defaultConfig()).map(field => ({ op: 'unset', path: [field] })))
    await advance(250)
    expect(settings.mutate).toHaveBeenCalledOnce()
  })

  it('orders queued reset before a later leaf override and preserves inherited siblings', async () => {
    const pending = deferred<boolean>()
    const settings = form({ base: { finished: { ...defaultConfig().finished, subagent: true } } })
    vi.mocked(settings.mutate).mockReturnValueOnce(pending.promise)
    await mount(settings)
    await click(toggle('Mute while viewing the session'))
    await sound('ping')
    await click(button('Restore inherited settings'))
    await sound('bell')
    expect(toggle('Subagent finished').getAttribute('aria-checked')).toBe('true')
    expect(settings.mutate).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(true) })
    expect(settings.mutate).toHaveBeenNthCalledWith(2, [
      ...Object.keys(defaultConfig()).map(field => ({ op: 'unset', path: [field] })),
      { op: 'set', path: ['finished', 'soundName'], value: 'bell' },
    ])
    expect(group().querySelector('select')!.value).toBe('bell')
    expect(toggle('Subagent finished').getAttribute('aria-checked')).toBe('true')
  })

  it('disables dependent controls for the master, group, sound, and zero-volume states', async () => {
    await mount()
    await click(toggle('Agent finished'))
    expect(group().querySelector('select')!.disabled).toBe(true)
    expect(toggle('Subagent finished').disabled).toBe(true)
    expect(group('Approval needed').querySelector('select')!.disabled).toBe(false)
    await click(toggle('Agent finished'))
    await click(group().querySelector<HTMLButtonElement>('[aria-label="Play sound"]')!)
    expect(group().querySelector('select')!.disabled).toBe(true)
    await click(group().querySelector<HTMLButtonElement>('[aria-label="Play sound"]')!)
    await volume(0)
    expect(button('Preview').disabled).toBe(true)
    await click(toggle('Enable notifications'))
    expect(slider().disabled).toBe(true)
    expect(toggle('Mute while viewing the session').disabled).toBe(true)
    expect(toggle('Approval needed').disabled).toBe(true)
    expect(toggle('Enable notifications').disabled).toBe(false)
  })

  it('previews optimistic sound and volume without an extra settings write', async () => {
    vi.useFakeTimers()
    const pending = deferred<boolean>()
    const settings = form()
    vi.mocked(settings.mutate).mockReturnValueOnce(pending.promise)
    await mount(settings)
    await sound('bell')
    await volume(29)
    await click(button('Preview'))
    expect(props.preview).toHaveBeenCalledExactlyOnceWith('bell', 29)
    expect(settings.mutate).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(true) })
  })

  it.each(['false', 'reject'] as const)('shows audio failure on %s and clears it on successful retry', async outcome => {
    const preview = vi.fn(async () => true)
    if (outcome === 'false') preview.mockResolvedValueOnce(false)
    else preview.mockRejectedValueOnce(new Error('blocked'))
    const settings = await mount(form(), { preview })
    await click(button('Preview'))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Sound could not play')
    await click(button('Preview'))
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it.each([true, false])('only the latest preview result controls the error (latest=%s)', async latest => {
    const old = deferred<boolean>()
    const current = deferred<boolean>()
    const preview = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await mount(form(), { preview })
    await click(button('Preview'))
    await click(button('Preview'))
    await act(async () => { current.resolve(latest) })
    await act(async () => { old.resolve(!latest) })
    expect(container.textContent!.includes('Sound could not play')).toBe(!latest)
  })

  it('ignores an older rejected preview after a newer preview succeeds', async () => {
    const old = deferred<boolean>()
    const preview = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(true)
    await mount(form(), { preview })
    await click(button('Preview'))
    await click(button('Preview'))
    await act(async () => { old.reject(new Error('stale audio failure')) })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it.each(['readonly', 'unavailable'] as const)('does not flush pending volume after the host becomes %s', async state => {
    vi.useFakeTimers()
    const settings = await mount()
    await volume(24)
    await snapshot(settings, state === 'readonly' ? { writable: false } : { status: 'unavailable' })
    await advance(250)
    expect(settings.mutate).not.toHaveBeenCalled()
    if (state === 'readonly') {
      expect(slider().disabled).toBe(true)
      expect(slider().value).toBe('70')
    } else expect(container.querySelector('[role="switch"]')).toBeNull()
  })

  it.each(['resolve', 'reject'] as const)('ignores late save and preview results after StrictMode remount (%s)', async outcome => {
    vi.useFakeTimers()
    const save = deferred<boolean>()
    const audio = deferred<boolean>()
    const settings = form()
    vi.mocked(settings.mutate).mockReturnValue(save.promise)
    await mount(settings, { preview: vi.fn(() => audio.promise) }, true)
    await sound('bell')
    await click(button('Preview'))
    await unmountPage()
    props = { ...props, form: form(), preview: vi.fn(async () => true) }
    await render()
    await volume(45)
    await act(async () => {
      if (outcome === 'resolve') { save.resolve(false); audio.resolve(false) }
      else { save.reject(new Error('late')); audio.reject(new Error('late')) }
    })
    expect(slider().value).toBe('45')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).not.toContain('The change was not saved')
    expect(settings.mutate).toHaveBeenCalledOnce()
    expect(props.form!.mutate).not.toHaveBeenCalled()
  })

  it('flushes pending volume exactly once on unmount, including StrictMode', async () => {
    vi.useFakeTimers()
    const settings = await mount(form(), {}, true)
    expect(settings.mutate).not.toHaveBeenCalled()
    await volume(18)
    await unmountPage()
    expect(settings.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['volume'], value: 18 }])
    await advance(1000)
    expect(settings.mutate).toHaveBeenCalledOnce()
    await render()
    expect(slider().value).toBe('18')
  })

  it('flushes queued volume after the in-flight write finishes even after unmount', async () => {
    vi.useFakeTimers()
    const pending = deferred<boolean>()
    const settings = form()
    vi.mocked(settings.mutate).mockReturnValueOnce(pending.promise)
    await mount(settings)
    await sound('bell')
    await volume(18)
    await unmountPage()
    expect(settings.mutate).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(true) })
    expect(settings.mutate).toHaveBeenNthCalledWith(2, [{ op: 'set', path: ['volume'], value: 18 }])
  })

  it('uses button keyboard semantics without implicit submit or extra device-test writes', async () => {
    const settings = await mount()
    for (const el of [toggle('Subagent finished'), button('Preview'), button('Restore inherited settings'), button('Show')]) {
      expect(el.type).toBe('button')
      el.focus()
      await act(async () => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        // Supply the browser activation that jsdom does not implement.
        el.click()
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
      })
    }
    expect(settings.mutate).toHaveBeenCalledTimes(2)
    expect(props.preview).toHaveBeenCalledOnce()
    expect(props.testToast).toHaveBeenCalledOnce()
    expect(button('Save')).toBeUndefined()
  })
})
