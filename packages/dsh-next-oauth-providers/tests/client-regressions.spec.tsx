/**
 * Client regressions: model-editor buffer identity, restore-defaults, and
 * login-action ownership. The editor lives in the native provider card now, and
 * the Add draft lives in the Models footer seat.
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddSubscription } from '../src/client/AddSubscription.tsx'
import { SubscriptionCard } from '../src/client/SubscriptionCard.tsx'
import { ClientRpcError } from '../src/client/api.ts'
import type { AttemptView, PluginState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const empty: PluginState = { writable: true, providers: [] }
const connected: PluginState = {
  writable: true,
  providers: [{
    family: 'kimi', alias: 'kimi-coding-oauth', nativeId: 'kimi-coding', displayName: 'Kimi Code', listed: true,
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

/** Render the native provider card for the seeded Kimi row. */
async function render(rpc: (method: string, args?: unknown) => Promise<unknown>): Promise<void> {
  await act(async () => {
    root!.render(
      <SubscriptionCard
        provider={{
          provider: 'kimi-coding-oauth',
          displayName: 'Kimi Code',
          settingsNs: 'dsh-next-oauth-providers',
          settingsPath: ['providers', 'kimi-coding'],
          active: true,
        }}
        configured
        keyConfigured
        rpc={rpc}
        t={(key) => key}
      />,
    )
  })
}

/** Render the footer Add seat and start a Kimi sign-in. */
async function openLogin(rpc: (method: string, args?: unknown) => Promise<unknown>): Promise<void> {
  await act(async () => { root!.render(<AddSubscription rpc={rpc} t={(key) => key} />) })
  await click('[data-testid="oauth-add-provider"]')
  await click('[data-testid="oauth-sign-in"]')
}

function stateRpc(state: PluginState = connected) {
  return vi.fn(async (_method: string, _args?: unknown) => state)
}
/** Open the seat's editor, which is collapsed on a configured row, and its fold. */
async function openEditor(): Promise<void> {
  const toggle = element('[data-testid="oauth-card-toggle"]')
  if (toggle.getAttribute('aria-expanded') === 'false') await click('[data-testid="oauth-card-toggle"]')
  await click('summary')
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
})

describe('provider editor actions', () => {
  it('closes the Add-provider editor when Cancel is clicked', async () => {
    await act(async () => { root!.render(<AddSubscription rpc={stateRpc(empty)} t={(key) => key} />) })
    await click('[data-testid="oauth-add-provider"]')
    const cancel = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!
    await act(async () => cancel.click())
    expect(host.querySelector('[data-testid="oauth-provider-select"]')).toBeNull()
    expect(host.querySelector('[data-testid="oauth-add-provider"]')).not.toBeNull()
  })

  it('discards customized drafts and closes the editor when Cancel is clicked', async () => {
    await render(stateRpc())
    await openEditor()
    await change('[aria-label="Model ID 1"]', 'unsaved-change')
    const cancel = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel' && button.dataset.testid !== 'oauth-cancel')!
    await act(async () => cancel.click())
    // Cancel closes the seat's editor; reopening starts from the stored catalog.
    expect(host.querySelector('[data-testid="oauth-apply"]')).toBeNull()
    await openEditor()
    expect(element<HTMLInputElement>('[aria-label="Model ID 1"]').value).toBe('first')
  })

  it('shows a saved confirmation after Apply closes the Add-provider editor', async () => {
    await act(async () => { root!.render(<AddSubscription rpc={stateRpc(empty)} t={(key) => key} />) })
    await click('[data-testid="oauth-add-provider"]')
    await click('[data-testid="oauth-apply"]')
    expect(host.querySelector('[data-testid="oauth-provider-select"]')).toBeNull()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Saved Kimi Code.')
  })

  it('shows confirmation after model changes apply and preserves the model list after reload', async () => {
    let stored: PluginState = connected
    const rpc = vi.fn(async (method: string, args?: unknown) => {
      if (method === 'getState') return stored
      if (method === 'setModels') {
        const { models } = args as { models: PluginState['providers'][number]['models'] }
        stored = { ...connected, providers: connected.providers.map((provider) => ({ ...provider, models, modelsOverridden: true, usingDefaults: false })) }
        return stored
      }
      return stored
    })
    await render(rpc)
    await openEditor()
    await click('[data-testid="oauth-add-model"]')
    await change('[aria-label="Model ID 3"]', 'custom-model')
    await click('[data-testid="oauth-apply"]')
    expect(host.textContent).toContain('Saved Kimi Code.')
    // Apply closes the seat's editor and announces the save on the row.
    expect(host.querySelector('[data-testid="oauth-apply"]')).toBeNull()
    await openEditor()
    expect(element<HTMLInputElement>('[aria-label="Model ID 3"]').value).toBe('custom-model')
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

  it('closes the Add editor and attempts cancellation when Cancel is clicked', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return empty
      if (method === 'cancelLogin') throw new ClientRpcError('network', 'offline')
      return running
    })
    await openLogin(rpc)
    const cancel = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel' && button.dataset.testid !== 'oauth-cancel')!
    await act(async () => cancel.click())
    expect(rpc).toHaveBeenCalledWith('cancelLogin', { attemptId: 'attempt' })
    expect(host.querySelector('[data-testid="oauth-provider-select"]')).toBeNull()
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
