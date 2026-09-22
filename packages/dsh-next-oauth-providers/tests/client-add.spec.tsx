/**
 * The Models footer seat: the Add entry, the draft family switch, and the
 * "everything is configured" state. Configured families live on their native
 * provider rows, so this seat never renders a row list.
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddSubscription } from '../src/client/AddSubscription.tsx'
import type { PluginState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const empty: PluginState = { writable: true, providers: [] }

const kimi: PluginState = {
  writable: true,
  providers: [
    {
      family: 'kimi',
      alias: 'kimi-coding-oauth',
      nativeId: 'kimi-coding',
      displayName: 'Kimi Code',
      listed: true,
      status: 'disconnected',
      models: [],
      defaultModels: [{ id: 'kimi-k2.5', name: 'Kimi K2.5' }],
      modelsOverridden: false,
      usingDefaults: true,
    },
  ],
}

const allFamilies: PluginState = {
  writable: true,
  providers: (['kimi', 'grok', 'codex', 'claude'] as const).map((family) => ({
    family,
    alias: `${family}-oauth` as never,
    nativeId: family as never,
    displayName: family,
    listed: true,
    status: 'disconnected' as const,
    models: [],
    defaultModels: [],
    modelsOverridden: false,
    usingDefaults: true,
  })),
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

async function render(rpc: (method: string, args?: unknown) => Promise<unknown>): Promise<void> {
  await act(async () => { root.render(<AddSubscription rpc={rpc} t={(key) => key} />) })
}

describe('AddSubscription', () => {
  it('opens the stock Add provider card and starts sign-in', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return empty
      if (method === 'startLogin') {
        return { id: 'a1', family: 'kimi', status: 'running', expiresAt: Date.now() + 1000 }
      }
      if (method === 'getAttempt') {
        return {
          id: 'a1',
          family: 'kimi',
          status: 'running',
          expiresAt: Date.now() + 1000,
          notice: { message: 'Open Grok to continue.', url: 'https://accounts.x.ai/device' },
        }
      }
      return null
    })
    await render(rpc)
    expect(host.querySelector('[data-testid="dsh-next-oauth-providers"]')).not.toBeNull()
    expect(host.textContent).toContain('Subscriptions')
    expect(host.textContent).toContain('Add provider')
    expect(host.textContent).not.toContain('Kimi Code')
    const add = host.querySelector('[data-testid="oauth-add-provider"]') as HTMLButtonElement
    await act(async () => { add.click() })
    expect(host.querySelector('[data-testid="oauth-provider-select"]')).not.toBeNull()
    expect(host.textContent).toContain('Kimi Code')
    expect(host.textContent).toContain('Sign in')
    const signIn = host.querySelector('[data-testid="oauth-sign-in"]') as HTMLButtonElement
    await act(async () => { signIn.click() })
    expect(rpc).toHaveBeenCalledWith('startLogin', { family: 'kimi' })
    expect(host.querySelector('[data-testid="oauth-attempt"]')).not.toBeNull()
    await vi.waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('getAttempt', { attemptId: 'a1' })
      expect(host.textContent).toContain('Open Grok to continue.')
      expect(host.querySelector('a[href="https://accounts.x.ai/device"]')).not.toBeNull()
    })
  })

  it('closes the add card once the selected family is listed', async () => {
    let snapshot: PluginState = empty
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return snapshot
      if (method === 'startLogin') {
        return { id: 'a1', family: 'kimi', status: 'running', expiresAt: Date.now() + 1000 }
      }
      if (method === 'getAttempt') {
        snapshot = { writable: true, providers: [{ ...kimi.providers[0]!, status: 'connected' }] }
        return { id: 'a1', family: 'kimi', status: 'authorized', expiresAt: Date.now() + 1000 }
      }
      return null
    })
    await render(rpc)
    await act(async () => {
      (host.querySelector('[data-testid="oauth-add-provider"]') as HTMLButtonElement).click()
    })
    await act(async () => {
      (host.querySelector('[data-testid="oauth-sign-in"]') as HTMLButtonElement).click()
    })
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="oauth-provider-select"]')).toBeNull()
      expect(host.querySelector('[data-testid="oauth-add-provider"]')).not.toBeNull()
    })
  })

  it('announces that every subscription is already configured', async () => {
    await render(async (method: string) => method === 'getState' ? allFamilies : null)
    const add = host.querySelector('[data-testid="oauth-add-provider"]') as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(host.textContent).toContain('Every subscription is already added')
    expect(host.querySelector('[data-testid="dsh-next-oauth-providers"]')).not.toBeNull()
  })

  it('does not carry a customized draft into another family', async () => {
    const rpc = vi.fn(async (method: string) => method === 'getState' ? empty : null)
    await render(rpc)
    await act(async () => {
      (host.querySelector('[data-testid="oauth-add-provider"]') as HTMLButtonElement).click()
    })
    await act(async () => {
      (host.querySelector('[data-testid="oauth-add-model"]') as HTMLButtonElement).click()
    })
    const id = host.querySelector('[aria-label="Model ID 1"]') as HTMLInputElement
    await act(async () => { id.value = 'kimi-only'; id.dispatchEvent(new Event('input', { bubbles: true })) })
    const select = host.querySelector('[data-testid="oauth-provider-select"]') as HTMLSelectElement
    await act(async () => {
      select.value = 'grok'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(host.querySelector('[aria-label="Model ID 1"]')).toBeNull()
    await act(async () => {
      (host.querySelector('[data-testid="oauth-apply"]') as HTMLButtonElement).click()
    })
    expect(rpc).toHaveBeenCalledWith('addProvider', { family: 'grok' })
    expect(rpc.mock.calls.some(([method]) => method === 'setModels')).toBe(false)
  })
})

describe('AddSubscription with a grant but no config row', () => {
  it('keeps the family addable so its row can be recreated', async () => {
    const grantedOnly: PluginState = {
      writable: true,
      providers: [{ ...kimi.providers[0]!, listed: false, status: 'connected' }],
    }
    await render(async (method: string) => method === 'getState' ? grantedOnly : null)
    const add = host.querySelector('[data-testid="oauth-add-provider"]') as HTMLButtonElement
    expect(add.disabled).toBe(false)
    await act(async () => { add.click() })
    const select = host.querySelector('[data-testid="oauth-provider-select"]') as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value)).toContain('kimi')
  })
})
