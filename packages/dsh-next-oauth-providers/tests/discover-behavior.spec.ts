import { describe, expect, it, vi } from 'vitest'
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import { FAMILIES } from '../src/core/catalog.ts'
import { discoverModels, parseGrokCatalog } from '../src/host/discover.ts'
import { GROK_HEADERS, GROK_PROXY_BASE_URL, nativeFactory } from '../src/host/providers.ts'

const grok = FAMILIES.find((family) => family.nativeId === 'xai')!
const grant: Credential = { type: 'oauth', access: 'test-access', refresh: 'test-refresh', expires: 1_900_000_000_000 }

function storeWith(credential?: Credential): CredentialStore {
  return {
    read: vi.fn(async () => credential),
    list: vi.fn(async () => []),
    modify: vi.fn(async () => { throw new Error('discovery must not write credentials') }),
    delete: vi.fn(async () => { throw new Error('discovery must not delete credentials') }),
  }
}

function defaults(family: typeof grok) {
  return nativeFactory(family.nativeId).getModels().map((model) => ({
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }))
}

describe('catalog parsing behavior', () => {
  it('prefers data over models, including an empty data array', () => {
    expect(parseGrokCatalog({ data: [], models: ['ignored'] })).toEqual([])
    expect(parseGrokCatalog({ data: ['first'], models: ['ignored'] })).toEqual([{ id: 'first', name: 'first' }])
    expect(parseGrokCatalog({ data: {}, models: ['fallback'] })).toEqual([{ id: 'fallback', name: 'fallback' }])
  })

  it('normalizes ids and names, skips invalid rows, and keeps the first duplicate', () => {
    expect(parseGrokCatalog([
      null, false, 5, [], {}, '', '  ',
      { id: ' a ', model: 'ignored', name: ' A ', display_name: 'ignored' },
      { id: 'a', name: 'duplicate' },
      { id: ' ', model: ' b ', name: ' ', display_name: ' B ' },
      { id: 'c', name: 3 },
    ])).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'c' }])
  })
})

describe('model discovery behavior', () => {
  it.each(FAMILIES.filter((family) => family.nativeId !== 'xai'))(
    'returns static $nativeId models without reading credentials or fetching',
    async (family) => {
      const store = storeWith(grant)
      const fetch = vi.fn()
      expect(await discoverModels(family, store, fetch)).toEqual(defaults(family))
      expect(store.read).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, { type: 'api_key', key: 'test-key' } as Credential])(
    'returns Grok defaults without fetching when no OAuth grant is stored (%j)',
    async (credential) => {
      const store = storeWith(credential)
      const fetch = vi.fn()
      expect(await discoverModels(grok, store, fetch)).toEqual(defaults(grok))
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('forwards authentication and signal, enriching only known remote ids', async () => {
    const signal = new AbortController().signal
    const store = storeWith(grant)
    const known = defaults(grok)[0]!
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: known.id, name: 'Remote name' }, { id: 'unknown-model' },
    ] })))
    expect(await discoverModels(grok, store, fetch, signal)).toEqual([
      { ...known, name: 'Remote name' }, { id: 'unknown-model', name: 'unknown-model' },
    ])
    expect(store.read).toHaveBeenCalledWith('xai', { signal })
    expect(fetch).toHaveBeenCalledWith(`${GROK_PROXY_BASE_URL}/models-v2`, {
      method: 'GET', headers: { authorization: 'Bearer test-access', ...GROK_HEADERS }, signal,
    })
  })

  it.each([
    ['empty catalog', () => new Response('{"data":[]}')],
    ['invalid catalog', () => new Response('{"unexpected":true}')],
    ['HTTP failure', () => new Response('', { status: 401 })],
    ['invalid JSON', () => new Response('not json')],
    ['network failure', () => { throw new Error('offline') }],
    ['aborted fetch', () => { throw new DOMException('aborted', 'AbortError') }],
  ] as const)('falls back to static models on %s', async (_label, response) => {
    expect(await discoverModels(grok, storeWith(grant), async () => response())).toEqual(defaults(grok))
  })

  it('propagates credential-store failures rather than hiding them as catalog failures', async () => {
    const store = storeWith()
    const failure = new Error('credential store unavailable')
    store.read = vi.fn(async () => { throw failure })
    const fetch = vi.fn()
    await expect(discoverModels(grok, store, fetch)).rejects.toBe(failure)
    expect(fetch).not.toHaveBeenCalled()
  })
})
