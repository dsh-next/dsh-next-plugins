import { describe, expect, it } from 'vitest'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'
import { FAMILIES } from '../src/core/catalog.ts'
import {
  MAX_REQUEST_IMAGE_BYTES,
  REQUEST_IMAGE_MAX_BYTES,
  REQUEST_IMAGE_PIXEL_BUDGET,
  STREAM_IDLE_TIMEOUT_MS,
} from '../src/core/ids.ts'
import { buildProfile } from '../src/host/profiles.ts'
import {
  applyModelCatalog,
  GROK_HEADERS,
  GROK_PROXY_BASE_URL,
  grokCodingProvider,
  loginFactory,
  nativeFactory,
  requireOAuth,
} from '../src/host/providers.ts'

describe('OAuth provider contracts', () => {
  it.each(FAMILIES)('exposes only OAuth for $family login and generation', (family) => {
    for (const factory of [loginFactory, nativeFactory]) {
      const provider = factory(family.nativeId)
      expect(provider.id).toBe(family.nativeId)
      expect(Object.keys(provider.auth)).toEqual(['oauth'])
      expect(provider.auth.oauth).toBeDefined()
      expect(provider.getModels().length).toBeGreaterThan(0)
    }
  })

  it('rejects providers without OAuth instead of retaining API-key authentication', () => {
    const provider = xaiProvider()
    expect(() => requireOAuth({ ...provider, auth: {} })).toThrow(/no OAuth method/)
    expect(() => requireOAuth({ ...provider, auth: {} })).toThrowError(expect.objectContaining({ code: 'unsupported' }))
  })

  it('retains the OAuth method without mutating the original authentication object', () => {
    const provider = xaiProvider()
    const before = provider.auth
    const wrapped = requireOAuth(provider)
    expect(wrapped.auth.oauth).toBe(before.oauth)
    expect(wrapped.auth.apiKey).toBeUndefined()
    expect(provider.auth).toBe(before)
    expect(provider.auth.apiKey).toBeDefined()
  })

  it('uses Grok coding endpoints for generation but native xAI for login', () => {
    expect(loginFactory('xai').baseUrl).toBe('https://api.x.ai/v1')
    expect(nativeFactory('xai').baseUrl).toBe(GROK_PROXY_BASE_URL)
  })

  it('overlays Grok endpoint/headers on every model while preserving unrelated headers', () => {
    const base = xaiProvider()
    const models = base.getModels().map((model) => ({
      ...model,
      headers: { 'model-extra': 'keep', 'X-XAI-Token-Auth': 'old' },
    }))
    const wrapped = grokCodingProvider({
      ...base,
      headers: { 'provider-extra': 'keep', 'X-XAI-Token-Auth': 'old' },
      getModels: () => models,
    })
    expect(wrapped.headers).toEqual({ 'provider-extra': 'keep', ...GROK_HEADERS })
    for (const model of wrapped.getModels()) {
      expect(model.baseUrl).toBe(GROK_PROXY_BASE_URL)
      expect(model.headers).toEqual({ 'model-extra': 'keep', ...GROK_HEADERS })
    }
    expect(models[0]?.headers['X-XAI-Token-Auth']).toBe('old')
  })
})

describe('model catalog contracts', () => {
  it.each([undefined, []])('returns the original provider for an inherited catalog (%j)', (models) => {
    const provider = nativeFactory('xai')
    expect(applyModelCatalog(provider, models)).toBe(provider)
  })

  it('retains known capabilities and uses only supplied descriptor overrides', () => {
    const provider = nativeFactory('anthropic')
    const known = provider.getModels()[0]!
    const [model] = applyModelCatalog(provider, [{ id: known.id, name: 'Custom', maxTokens: 8192 }]).getModels()
    expect(model).toEqual({ ...known, name: 'Custom', maxTokens: 8192 })
    expect(provider.getModels()[0]).toEqual(known)
  })

  it('gives unknown models explicit capacities and conservative modalities', () => {
    const provider = nativeFactory('anthropic')
    const [model] = applyModelCatalog(provider, [{
      id: 'future-model', name: 'Future', contextWindow: 100_000, maxTokens: 4096,
    }]).getModels()
    expect(model).toMatchObject({
      id: 'future-model', name: 'Future', contextWindow: 100_000, maxTokens: 4096,
      input: ['text'], reasoning: false,
      baseUrl: provider.getModels()[0]?.baseUrl,
    })
  })

  it('uses the id as an unknown model name', () => {
    const [model] = applyModelCatalog(nativeFactory('xai'), [{ id: 'future-grok' }]).getModels()
    expect(model?.name).toBe('future-grok')
  })

  it('rejects catalog extension when no model template exists', () => {
    const empty = { ...nativeFactory('xai'), getModels: () => [] }
    expect(() => applyModelCatalog(empty, [{ id: 'new' }])).toThrowError(expect.objectContaining({ code: 'unsupported' }))
  })
})

describe('resolved profile contracts', () => {
  it.each(FAMILIES)('builds $family defaults with provider-owned request limits', (family) => {
    const profile = buildProfile(family, {})
    expect(profile).toMatchObject({
      provider: family.nativeId,
      displayName: family.displayName,
      streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
      maxRequestImageBytes: MAX_REQUEST_IMAGE_BYTES,
      requestImagePixelBudget: REQUEST_IMAGE_PIXEL_BUDGET,
      requestImageMaxBytes: REQUEST_IMAGE_MAX_BYTES,
    })
    expect(profile.retryPolicy).toBeDefined()
    expect(profile.headers).toEqual(family.nativeId === 'xai' ? GROK_HEADERS : undefined)
    // The runtime adapter reads this map on every exact-model lookup; an absent
    // map is a TypeError inside the adapter rather than a cache miss.
    expect(profile.modelErrors).toEqual(new Map())
    expect(profile.piProvider).toBeDefined()
    for (const model of profile.piProvider!.getModels()) {
      expect(profile.configuredMaxTokens.get(model.id)).toBe(model.maxTokens)
    }
  })

  it('uses stored names/catalog/capacities and removes unselected defaults', () => {
    const profile = buildProfile(FAMILIES[1]!, {
      displayName: 'My Grok', models: [{ id: 'custom-grok', contextWindow: 150_000, maxTokens: 2048 }],
    })
    expect(profile.displayName).toBe('My Grok')
    expect([...profile.configuredMaxTokens]).toEqual([['custom-grok', 2048]])
    expect(profile.piProvider!.getModels()).toEqual([expect.objectContaining({
      id: 'custom-grok', contextWindow: 150_000, maxTokens: 2048, baseUrl: GROK_PROXY_BASE_URL,
    })])
  })
})
