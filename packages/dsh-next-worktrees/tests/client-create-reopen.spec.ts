/** Disposable browser call-site repro: stale Create suggestions after close/reopen. */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBridge } from '../src/client/bridge.ts'
import { ModalHost } from '../src/client/modal-host.tsx'
import { modalState, openCreate, resetModalStore } from '../src/client/create-store.ts'
import { englishTranslate, type MessageKey } from '../src/client/dictionaries.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLElement | undefined
let uninstall: (() => void) | undefined

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => resetModalStore())
afterEach(async () => {
  if (root !== undefined) await act(async () => root!.unmount())
  root = undefined
  container?.remove()
  container = undefined
  uninstall?.()
  uninstall = undefined
  resetModalStore()
})

async function mount(rpc: (method: string, args?: unknown) => Promise<unknown>) {
  uninstall = installBridge({
    createLabel: (label) => label,
    requestCreate: (cwd, label) => openCreate(cwd, label, rpc),
    menuLabel: (key) => key,
    worktreeFacts: () => [],
    requestMenu: () => {},
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(React.createElement(ModalHost, {
    t: (key, values) => englishTranslate(key as MessageKey, values),
    workspaces: { create: vi.fn(), delete: vi.fn(), archiveSession: vi.fn() },
    sessions: { create: vi.fn(), open: vi.fn() },
  })))
}

async function open(cwd = '/diagnostic/repo') {
  await act(async () => window.__dshNextWorktreesBridge!.requestCreate(cwd, 'repo'))
}

async function typeName(value: string) {
  const input = container!.querySelector<HTMLInputElement>('[data-dshx-create-name]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('diagnostic Create bridge and modal lifecycle', () => {
  it('does not replace the user-entered name with a response from the previous closed modal', async () => {
    const old = deferred<string>()
    const rpc = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue('fresh-suggestion')
    await mount(rpc)
    await open()
    expect(modalState().create?.busy).toBe(true)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(container!.querySelector('[data-dshx-modal="create"]')).toBeNull()
    await open()
    await typeName('my-intended-name')
    expect(container!.querySelector<HTMLInputElement>('[data-dshx-create-name]')!.value).toBe('my-intended-name')
    await act(async () => old.resolve('obsolete-suggestion'))
    expect(container!.querySelector<HTMLInputElement>('[data-dshx-create-name]')!.value).toBe('my-intended-name')
  })

  it('negative control: a response for another repo does not change the reopened input', async () => {
    const old = deferred<string>()
    await mount(vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue('fresh-suggestion'))
    await open()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await open('/diagnostic/other-repo')
    await typeName('my-intended-name')
    await act(async () => old.resolve('obsolete-suggestion'))
    expect(container!.querySelector<HTMLInputElement>('[data-dshx-create-name]')!.value).toBe('my-intended-name')
  })

  it('negative control: a typed name is stable without a previous modal response', async () => {
    await mount(vi.fn().mockResolvedValue('fresh-suggestion'))
    await open()
    await typeName('my-intended-name')
    await act(async () => {})
    expect(container!.querySelector<HTMLInputElement>('[data-dshx-create-name]')!.value).toBe('my-intended-name')
    expect(modalState().create?.name).toBe('my-intended-name')
  })

  it('negative control: closing without reopening does not resurrect the Create modal', async () => {
    const old = deferred<string>()
    await mount(() => old.promise)
    await open()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await act(async () => old.resolve('obsolete-suggestion'))
    expect(modalState().kind).toBe('closed')
    expect(container!.querySelector('[data-dshx-modal="create"]')).toBeNull()
  })
})
