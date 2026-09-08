import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionsFooter } from '../src/client/SubscriptionsFooter.tsx'
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
      status: 'disconnected',
      models: [],
      defaultModels: [{ id: 'kimi-k2.5', name: 'Kimi K2.5' }],
      modelsOverridden: false,
      usingDefaults: true,
    },
  ],
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

describe('SubscriptionsFooter', () => {
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
    await act(async () => {
      root.render(<SubscriptionsFooter rpc={rpc} t={(key) => key} />)
    })
    expect(host.querySelector('[data-testid="dsh-next-oauth-providers"]')).not.toBeNull()
    expect(host.textContent).toContain('Subscriptions')
    expect(host.textContent).toContain('Add provider')
    expect(host.textContent).not.toContain('Kimi Code')
    const add = host.querySelector('[data-testid="oauth-add-provider"]') as HTMLButtonElement
    await act(async () => { add.click() })
    expect(host.querySelector('[data-testid="oauth-provider-select"]')).not.toBeNull()
    expect(host.textContent).toContain('Kimi Code')
    expect(host.textContent).toContain('Sign in')
    expect(host.textContent).not.toContain('action.signIn')
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

  it('edits a listed row and fetches models into the picker', async () => {
    const connected: PluginState = {
      ...kimi,
      providers: [{ ...kimi.providers[0]!, status: 'connected', models: kimi.providers[0]!.defaultModels }],
    }
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return connected
      if (method === 'listModels') return [{ id: 'kimi-k2.5', name: 'Kimi K2.5' }, { id: 'kimi-k2', name: 'K2' }]
      return null
    })
    await act(async () => {
      root.render(<SubscriptionsFooter rpc={rpc} />)
    })
    const edit = host.querySelector('[aria-label="Edit Kimi Code"]') as HTMLButtonElement
    await act(async () => { edit.click() })
    const summary = host.querySelector('summary') as HTMLElement
    await act(async () => { summary.click() })
    const fetch = host.querySelector('[data-testid="oauth-fetch-models"]') as HTMLButtonElement
    expect(fetch.disabled).toBe(false)
    await act(async () => { fetch.click() })
    expect(rpc).toHaveBeenCalledWith('listModels', { family: 'kimi' })
    expect(document.querySelector('[data-testid="oauth-fetch-dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Choose models to add')
  })

  it('closes the add card once the selected family is connected', async () => {
    let snapshot: PluginState = empty
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return snapshot
      if (method === 'startLogin') {
        return { id: 'a1', family: 'kimi', status: 'running', expiresAt: Date.now() + 1000 }
      }
      if (method === 'getAttempt') {
        snapshot = {
          writable: true,
          providers: [{ ...kimi.providers[0]!, status: 'connected', models: kimi.providers[0]!.defaultModels }],
        }
        return { id: 'a1', family: 'kimi', status: 'authorized', expiresAt: Date.now() + 1000 }
      }
      return null
    })
    await act(async () => {
      root.render(<SubscriptionsFooter rpc={rpc} />)
    })
    await act(async () => {
      (host.querySelector('[data-testid="oauth-add-provider"]') as HTMLButtonElement).click()
    })
    await act(async () => {
      (host.querySelector('[data-testid="oauth-sign-in"]') as HTMLButtonElement).click()
    })
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="dsh-next-oauth-providers-kimi"]')).not.toBeNull()
      expect(host.querySelector('[data-testid="oauth-provider-select"]')).toBeNull()
      expect(host.querySelector('[data-testid="oauth-add-provider"]')).not.toBeNull()
      expect(host.textContent).not.toContain('Reconnect')
    })
  })
})
