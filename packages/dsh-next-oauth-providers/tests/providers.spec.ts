import { describe, expect, it } from 'vitest'
import { FAMILIES } from '../src/core/catalog.ts'
import { buildProfile } from '../src/host/profiles.ts'
import { applyModelCatalog, nativeFactory } from '../src/host/providers.ts'

describe('applyModelCatalog', () => {
  it('keeps the built-in catalog when models are omitted or empty', () => {
    const provider = nativeFactory('xai')
    const baseline = provider.getModels()
    expect(baseline.length).toBeGreaterThan(0)
    expect(applyModelCatalog(provider, undefined).getModels()).toEqual(baseline)
    expect(applyModelCatalog(provider, []).getModels()).toEqual(baseline)
  })

  it('replaces the catalog when an explicit list is stored', () => {
    const provider = nativeFactory('openai-codex')
    const models = applyModelCatalog(provider, [{ id: 'gpt-5.4' }]).getModels()
    expect(models.map((row) => row.id)).toEqual(['gpt-5.4'])
  })

  it('uses 256K / 64K when pi-ai has never heard of the id', () => {
    const provider = nativeFactory('xai')
    const [model] = applyModelCatalog(provider, [{ id: 'custom-grok' }]).getModels()
    expect(model).toMatchObject({ id: 'custom-grok', contextWindow: 256_000, maxTokens: 64_000 })
  })
})

describe('buildProfile', () => {
  it('exposes catalog maxTokens as configuredMaxTokens', () => {
    const grok = FAMILIES.find((row) => row.family === 'grok')
    if (grok === undefined) throw new Error('missing grok family')
    const profile = buildProfile(grok, {})
    expect(profile.configuredMaxTokens.get('grok-4.6')).toBe(500_000)
  })
})
