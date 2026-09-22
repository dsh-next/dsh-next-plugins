/**
 * The native provider card's adapter seat: account state, Sign out, and the
 * model catalog editor for one declared family. The stock page owns the row,
 * Edit, and Delete; this seat must ignore directory routes that are not ours.
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionCard, type SubscriptionCardProps } from '../src/client/SubscriptionCard.tsx'
import type { PluginState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const connected: PluginState = {
  writable: true,
  providers: [{
    family: 'kimi',
    alias: 'kimi-coding-oauth',
    nativeId: 'kimi-coding',
    displayName: 'Kimi Code',
    listed: true,
    status: 'connected',
    accountLabel: 'kimi@example.com',
    models: [],
    modelsOverridden: false,
    usingDefaults: true,
    defaultModels: [
      { id: 'first', name: 'First', contextWindow: 128_000 },
      { id: 'second', name: 'Second', contextWindow: 256_000 },
    ],
  }],
}

const disconnected: PluginState = {
  writable: true,
  providers: [{ ...connected.providers[0]!, status: 'disconnected', accountLabel: undefined }],
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function owner(provider = 'kimi-coding-oauth'): SubscriptionCardProps {
  return {
    provider: {
      provider,
      displayName: 'Kimi Code',
      settingsNs: 'dsh-next-oauth-providers',
      settingsPath: ['providers', 'kimi-coding'],
      active: true,
    },
    configured: true,
    keyConfigured: true,
    rpc: async () => null,
    t: (key) => key,
  }
}

async function render(rpc: (method: string, args?: unknown) => Promise<unknown>, props = owner()): Promise<void> {
  await act(async () => {
    root.render(<SubscriptionCard {...props} rpc={rpc} t={(key) => key} />)
  })
}

describe('SubscriptionCard', () => {
  it('renders nothing for a directory route this plugin does not own', async () => {
    await render(async () => connected, owner('deepseek-official'))
    expect(host.innerHTML).toBe('')
  })

  it('shows the account state and signs out through the host', async () => {
    let snapshot = connected
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return snapshot
      if (method === 'disconnect') {
        snapshot = disconnected
        return snapshot
      }
      return null
    })
    await render(rpc)
    const card = host.querySelector('[data-testid="dsh-next-oauth-providers-card-kimi"]')
    expect(card).not.toBeNull()
    expect(host.textContent).toContain('kimi@example.com')
    const signOut = host.querySelector('[data-testid="oauth-sign-out"]') as HTMLButtonElement
    await act(async () => { signOut.click() })
    expect(rpc).toHaveBeenCalledWith('disconnect', { family: 'kimi' })
    expect(host.textContent).toContain('Not signed in yet')
    expect(host.querySelector('[data-testid="oauth-sign-out"]')).toBeNull()
  })

  it('edits a listed family and fetches models into the picker', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return connected
      if (method === 'listModels') return [{ id: 'kimi-k2.5', name: 'Kimi K2.5' }, { id: 'kimi-k2', name: 'K2' }]
      return null
    })
    await render(rpc)
    const summary = host.querySelector('summary') as HTMLElement
    await act(async () => { summary.click() })
    const fetch = host.querySelector('[data-testid="oauth-fetch-models"]') as HTMLButtonElement
    expect(fetch.disabled).toBe(false)
    await act(async () => { fetch.click() })
    expect(rpc).toHaveBeenCalledWith('listModels', { family: 'kimi' })
    expect(document.querySelector('[data-testid="oauth-fetch-dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Choose models to add')
  })

  it('offers sign-in for a declared family that has no grant yet', async () => {
    await render(async () => disconnected)
    expect(host.textContent).toContain('Not signed in yet')
    expect(host.querySelector('[data-testid="oauth-sign-in"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="oauth-sign-out"]')).toBeNull()
  })
})

describe('SubscriptionCard with a late-arriving row', () => {
  it('restores defaults through the card when the state resolves after mount', async () => {
    // The e2e shape: the stored profile overrides the catalog, and the state
    // (with that fact) resolves only after the card has mounted.
    const overriddenState: PluginState = {
      writable: true,
      providers: [{
        ...connected.providers[0]!,
        models: [{ id: 'oauth-smoke-second', name: 'oauth-smoke-second', contextWindow: 222_000 }],
        modelsOverridden: true,
        usingDefaults: false,
      }],
    }
    let resolveState!: (value: PluginState) => void
    const first = new Promise<PluginState>((resolve) => { resolveState = resolve })
    let calls = 0
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') {
        calls += 1
        return calls === 1 ? first : overriddenState
      }
      if (method === 'addProvider') return overriddenState
      if (method === 'restoreModels') return overriddenState
      return null
    })
    await render(rpc)
    await act(async () => { resolveState(overriddenState) })
    await act(async () => {
      (host.querySelector('summary') as HTMLElement).click()
    })
    await act(async () => {
      (host.querySelector('[aria-label="Capacities 1"]') as HTMLButtonElement).click()
    })
    const window1 = host.querySelector('[aria-label="Context window 1"]') as HTMLInputElement
    await act(async () => {
      Simulate.change(window1, { target: { value: 'invalid' } } as never)
    })
    expect((host.querySelector('[data-testid="oauth-apply"]') as HTMLButtonElement).disabled).toBe(true)
    const reset = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Restore defaults')!
    await act(async () => reset.click())
    await act(async () => {
      (host.querySelector('[data-testid="oauth-apply"]') as HTMLButtonElement).click()
    })
    expect(rpc.mock.calls.map(([method]) => method)).toContain('restoreModels')
  })
})
