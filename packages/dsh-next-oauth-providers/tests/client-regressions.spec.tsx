import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionsFooter } from '../src/client/SubscriptionsFooter.tsx'
import { ClientRpcError } from '../src/client/api.ts'
import type { AttemptView, PluginState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const empty: PluginState = { writable: true, providers: [] }
const connected: PluginState = {
  writable: true,
  providers: [{
    family: 'kimi', alias: 'kimi-coding-oauth', nativeId: 'kimi-coding', displayName: 'Kimi Code',
    status: 'connected', models: [], modelsOverridden: false, usingDefaults: true,
    defaultModels: [
      { id: 'first', name: 'First', contextWindow: 128_000 },
      { id: 'second', name: 'Second', contextWindow: 256_000 },
    ],
  }],
}
const running: AttemptView = {
  id: 'attempt', family: 'kimi', status: 'running', expiresAt: Date.now() + 60_000,
  prompt: { id: 'prompt', kind: 'text', message: 'Paste code' },
}

let root: Root | undefined
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root?.unmount())
  host.remove()
  vi.useRealTimers()
})

function element<T extends HTMLElement = HTMLButtonElement>(selector: string): T {
  const found = host.querySelector<T>(selector)
  expect(found).not.toBeNull()
  return found!
}
async function click(selector: string): Promise<void> {
  await act(async () => element(selector).click())
}
async function change(selector: string, value: string): Promise<void> {
  await act(async () => Simulate.change(element(selector), { target: { value } } as never))
}
async function render(rpc: (method: string, args?: unknown) => Promise<unknown>): Promise<void> {
  await act(async () => root!.render(<SubscriptionsFooter rpc={rpc} />))
}
function stateRpc(state: PluginState = connected) {
  return vi.fn(async (_method: string, _args?: unknown) => state)
}
async function openEditor(): Promise<void> {
  await click('[aria-label="Edit Kimi Code"]')
}
async function openLogin(rpc: (method: string, args?: unknown) => Promise<unknown>): Promise<void> {
  await render(rpc)
  await click('[data-testid="oauth-add-provider"]')
  await click('[data-testid="oauth-sign-in"]')
}

describe('model editor regressions', () => {
  it('retains the same focused input throughout multi-character ID editing', async () => {
    await render(stateRpc())
    await openEditor()
    const input = element<HTMLInputElement>('[aria-label="Model ID 1"]')
    input.focus()
    for (const value of ['m', 'mo', 'model']) {
      await change('[aria-label="Model ID 1"]', value)
      expect(element('[aria-label="Model ID 1"]')).toBe(input)
      expect(document.activeElement).toBe(input)
    }
  })

  it('preserves the surviving row capacity buffer and identity when deleting an earlier row', async () => {
    const rpc = stateRpc()
    await render(rpc)
    await openEditor()
    await click('[aria-label="Capacities 1"]')
    await click('[aria-label="Capacities 2"]')
    await change('[aria-label="Context window 1"]', '130k')
    await change('[aria-label="Context window 2"]', '257k')
    const survivor = element('[aria-label="Model ID 2"]')
    await click('[aria-label="Delete model 1"]')
    expect(element('[aria-label="Model ID 1"]')).toBe(survivor)
    expect(element<HTMLInputElement>('[aria-label="Context window 1"]').value).toBe('257k')
    await click('[data-testid="oauth-apply"]')
    expect(rpc).toHaveBeenCalledWith('setModels', {
      alias: 'kimi-coding-oauth', models: [{ id: 'second', name: 'Second', contextWindow: 257_000 }],
    })
  })

  it('clears invalid and edited capacity text when restoring defaults', async () => {
    const rpc = stateRpc()
    await render(rpc)
    await openEditor()
    await click('[aria-label="Capacities 1"]')
    await change('[aria-label="Context window 1"]', 'invalid')
    expect(element<HTMLButtonElement>('[data-testid="oauth-apply"]').disabled).toBe(true)
    const reset = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Restore defaults')!
    await act(async () => reset.click())
    if (element('[aria-label="Capacities 1"]').getAttribute('aria-expanded') === 'false') {
      await click('[aria-label="Capacities 1"]')
    }
    expect(element<HTMLInputElement>('[aria-label="Context window 1"]').value).toBe('128K')
    expect(element<HTMLButtonElement>('[data-testid="oauth-apply"]').disabled).toBe(false)
    await change('[aria-label="Context window 1"]', '129k')
    await click('[data-testid="oauth-apply"]')
    expect(rpc).toHaveBeenCalledWith('setModels', expect.objectContaining({
      models: expect.arrayContaining([expect.objectContaining({ id: 'first', contextWindow: 129_000 })]),
    }))
  })

  it('does not carry a customized Add-provider draft into another family', async () => {
    const rpc = stateRpc(empty)
    await render(rpc)
    await click('[data-testid="oauth-add-provider"]')
    await click('[data-testid="oauth-add-model"]')
    await change('[aria-label="Model ID 1"]', 'kimi-only')
    await change('[data-testid="oauth-provider-select"]', 'grok')
    expect(host.querySelector('[aria-label="Model ID 1"]')).toBeNull()
    await click('[data-testid="oauth-apply"]')
    expect(rpc).toHaveBeenCalledWith('addProvider', { family: 'grok' })
    expect(rpc.mock.calls.some(([method]) => method === 'setModels')).toBe(false)
  })
})

describe('login action ownership', () => {
  it.each(['submitPrompt', 'cancelLogin'])('renders a rejected %s RPC instead of leaking its rejection', async (rejected) => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return empty
      if (method === rejected) throw new ClientRpcError('network', 'offline')
      return running
    })
    await openLogin(rpc)
    if (rejected === 'submitPrompt') await change('#oauth-prompt-prompt', 'answer')
    await click(`[data-testid="${rejected === 'submitPrompt' ? 'oauth-submit-prompt' : 'oauth-cancel'}"]`)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be reached')
  })

  it('stops polling and cancels a running login when unmounted, handling cancellation failure', async () => {
    vi.useFakeTimers()
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return empty
      if (method === 'cancelLogin') throw new ClientRpcError('network', 'offline')
      return running
    })
    await openLogin(rpc)
    await act(async () => { root!.unmount(); root = undefined })
    expect(rpc).toHaveBeenCalledWith('cancelLogin', { attemptId: 'attempt' })
    const count = rpc.mock.calls.filter(([method]) => method === 'getAttempt').length
    await act(async () => vi.advanceTimersByTime(2_000))
    expect(rpc.mock.calls.filter(([method]) => method === 'getAttempt')).toHaveLength(count)
  })

  it('cancels a login whose start response arrives after unmount', async () => {
    let resolveStart!: (value: AttemptView) => void
    const started = new Promise<AttemptView>((resolve) => { resolveStart = resolve })
    const rpc = vi.fn(async (method: string) => method === 'getState' ? empty : method === 'startLogin' ? started : running)
    await openLogin(rpc)
    await act(async () => { root!.unmount(); root = undefined })
    await act(async () => resolveStart(running))
    expect(rpc).toHaveBeenCalledWith('cancelLogin', { attemptId: 'attempt' })
  })

  it('reports cancellation failure when closing the editor', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return empty
      if (method === 'cancelLogin') throw new ClientRpcError('network', 'offline')
      return running
    })
    await openLogin(rpc)
    const cancel = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel' && button.dataset.testid !== 'oauth-cancel')!
    await act(async () => cancel.click())
    expect(host.querySelector('[data-testid="oauth-provider-select"]')).toBeNull()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be reached')
  })

  it('ignores a prompt response arriving after its editor closes', async () => {
    let resolvePrompt!: (value: AttemptView) => void
    const submitted = new Promise<AttemptView>((resolve) => { resolvePrompt = resolve })
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return empty
      if (method === 'submitPrompt') return submitted
      return running
    })
    await openLogin(rpc)
    await change('#oauth-prompt-prompt', 'answer')
    await click('[data-testid="oauth-submit-prompt"]')
    await change('[data-testid="oauth-provider-select"]', 'grok')
    await act(async () => resolvePrompt(running))
    expect(host.querySelector('[data-testid="oauth-attempt"]')).toBeNull()
    expect(element<HTMLSelectElement>('[data-testid="oauth-provider-select"]').value).toBe('grok')
  })

  it('cancels the owned attempt when switching Add-provider family', async () => {
    const rpc = vi.fn(async (method: string) => method === 'getState' ? empty : running)
    await openLogin(rpc)
    await change('[data-testid="oauth-provider-select"]', 'grok')
    expect(rpc).toHaveBeenCalledWith('cancelLogin', { attemptId: 'attempt' })
    expect(host.querySelector('[data-testid="oauth-attempt"]')).toBeNull()
  })
})
