import { describe, expect, it } from 'vitest'
import type { CredentialStore } from '@earendil-works/pi-ai'
import { FAMILIES } from '../src/core/catalog.ts'
import { discoverModels, parseGrokCatalog } from '../src/host/discover.ts'

describe('parseGrokCatalog', () => {
  it('reads ids from data, models, or a bare array', () => {
    expect(parseGrokCatalog({ data: [{ id: 'grok-4' }, { model: 'grok-4' }] }).map((row) => row.id)).toEqual(['grok-4'])
    expect(parseGrokCatalog({ models: [{ id: 'a', name: 'A' }] })).toEqual([{ id: 'a', name: 'A' }])
    expect(parseGrokCatalog(['bare'])).toEqual([{ id: 'bare', name: 'bare' }])
  })

  it('returns an empty list for unknown shapes', () => {
    expect(parseGrokCatalog(null)).toEqual([])
    expect(parseGrokCatalog({ ok: true })).toEqual([])
  })
})

describe('discoverModels', () => {
  it('fills Grok remote rows with catalog capacities when the listing omits them', async () => {
    const grok = FAMILIES.find((row) => row.family === 'grok')
    if (grok === undefined) throw new Error('missing grok family')
    const store = {
      read: async () => ({ type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() + 60_000 }),
    } as unknown as CredentialStore
    const models = await discoverModels(grok, store, async () => new Response(JSON.stringify({
      data: [{ id: 'grok-4.6', name: 'Grok 4.6' }],
    })))
    expect(models).toEqual([expect.objectContaining({
      id: 'grok-4.6',
      contextWindow: 500_000,
      maxTokens: 500_000,
    })])
  })
})
