import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GitSettingsCard } from '../src/client/settings/GitSettingsCard.tsx'
import { englishTranslate } from '../src/client/dictionaries.ts'
import type { GitApi } from '../src/client/api.ts'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function mount(call: ReturnType<typeof vi.fn>) {
  await act(async () => root.render(<GitSettingsCard api={{ call } as GitApi} t={englishTranslate} />))
}
function rpc() {
  let config = { draftingProvider: '', draftingModel: '', draftingInstructions: '' }
  return vi.fn(async (method: string, args: unknown) => {
    if (method === 'draftingModelCatalog') return { models: [{ provider: 'p', model: 'm', label: 'Model' }] }
    if (method === 'setConfig') config = { ...config, ...args as Partial<typeof config> }
    return config
  })
}
async function typeInstructions(value: string) {
  await act(async () => {
    const node = container.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const save = () => [...container.querySelectorAll('button')].find(node => node.textContent === 'Save')!
it('saves writing preferences explicitly, preserves unsaved text on model change, and resets to default', async () => {
  const call = rpc(); await mount(call)
  expect(save().disabled).toBe(true)
  expect(container.querySelector('textarea')!.maxLength).toBe(4000)
  await typeInstructions('Use Conventional Commits.')
  expect(call.mock.calls.some(([method]) => method === 'setConfig')).toBe(false)
  await select(JSON.stringify(['p', 'm']))
  expect(container.querySelector('textarea')!.value).toBe('Use Conventional Commits.')
  await act(async () => save().click())
  expect(call).toHaveBeenLastCalledWith('setConfig', { draftingInstructions: 'Use Conventional Commits.' })
  expect(save().disabled).toBe(true)
  expect(container.querySelector('select')!.value).toBe(JSON.stringify(['p', 'm']))
  await typeInstructions(''); await act(async () => save().click())
  expect(call).toHaveBeenLastCalledWith('setConfig', { draftingInstructions: '' })
})
it('preserves writing preferences after a failed save and lets the user retry', async () => {
  const call = rpc(); await mount(call)
  await typeInstructions('Short subjects only.')
  call.mockRejectedValueOnce(new Error('network'))
  await act(async () => save().click())
  expect(container.querySelector('textarea')!.value).toBe('Short subjects only.')
  expect(save().disabled).toBe(false)
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  await act(async () => save().click())
  expect(save().disabled).toBe(true)
})
async function select(value: string) {
  await act(async () => { const node = container.querySelector('select')!; node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })) })
}
it('loads catalog and saves override then default as complete pairs', async () => {
  const call = rpc(); await mount(call)
  expect(container.querySelector('select')!.value).toBe('')
  await select(JSON.stringify(['p', 'm']))
  expect(call).toHaveBeenLastCalledWith('setConfig', { draftingProvider: 'p', draftingModel: 'm' })
  await select('')
  expect(call).toHaveBeenLastCalledWith('setConfig', { draftingProvider: '', draftingModel: '' })
})
it('preserves saved value and shows localized error on save failure', async () => {
  const call = rpc(); await mount(call); call.mockRejectedValueOnce(new Error('secret transport detail'))
  await select(JSON.stringify(['p', 'm']))
  expect(container.querySelector('select')!.value).toBe('')
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('Try again')
  expect(container.textContent).not.toContain('secret transport detail')
})
it('offers retry when initial load fails', async () => {
  const call = rpc(); call.mockRejectedValueOnce(new Error('offline')); await mount(call)
  expect(container.querySelector('select')!.disabled).toBe(true)
  await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
  expect(container.querySelector('select')!.disabled).toBe(false)
})
it('retains a configured model missing from catalog', async () => {
  const call = rpc(); call.mockImplementationOnce(async () => ({ draftingProvider: 'old', draftingModel: 'missing', draftingInstructions: '' }))
  await mount(call)
  expect(container.querySelector('select')!.value).toBe(JSON.stringify(['old', 'missing']))
  expect(container.textContent).toContain('old / missing')
})
