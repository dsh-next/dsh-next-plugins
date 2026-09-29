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

describe('applyModelCatalog declared modalities', () => {
  it('keeps the catalog list when the row declares none', () => {
    const [model] = applyModelCatalog(nativeFactory('xai'), [{ id: 'grok-4.6' }]).getModels()
    expect(model?.input).toEqual(['text', 'image'])
  })

  it('replaces the catalog list in both directions', () => {
    const [narrowed] = applyModelCatalog(nativeFactory('xai'), [{ id: 'grok-4.6', input: ['text'] }]).getModels()
    expect(narrowed?.input).toEqual(['text'])
    const spark = nativeFactory('openai-codex').getModels().find((row) => row.id === 'gpt-5.3-codex-spark')
    expect(spark?.input).toEqual(['text'])
    const [widened] = applyModelCatalog(nativeFactory('openai-codex'), [{ id: 'gpt-5.3-codex-spark', input: ['text', 'image'] }]).getModels()
    expect(widened?.input).toEqual(['text', 'image'])
  })

  it('reads an empty declared list as no answer, exactly like the official resolver', () => {
    const [known] = applyModelCatalog(nativeFactory('xai'), [{ id: 'grok-4.6', input: [] }]).getModels()
    expect(known?.input).toEqual(['text', 'image'])
    const [unknown] = applyModelCatalog(nativeFactory('xai'), [{ id: 'custom-grok', input: [] }]).getModels()
    expect(unknown?.input).toEqual(['text'])
  })

  it('gives a hand-mapped id the modalities the row declares', () => {
    const [model] = applyModelCatalog(nativeFactory('xai'), [{ id: 'custom-grok', input: ['text', 'image'] }]).getModels()
    expect(model).toMatchObject({ id: 'custom-grok', input: ['text', 'image'] })
  })

  it('leaves a hand-mapped id text-only when the row declares nothing', () => {
    const [model] = applyModelCatalog(nativeFactory('xai'), [{ id: 'custom-grok' }]).getModels()
    expect(model?.input).toEqual(['text'])
  })
})

describe('applyModelCatalog declared reasoning', () => {
  const grok = () => nativeFactory('xai')

  it('keeps the catalog reasoning and level map when the row declares none', () => {
    const base = grok().getModels().find((row) => row.id === 'grok-4.6')
    expect(base?.reasoning).toBe(true)
    const [model] = applyModelCatalog(grok(), [{ id: 'grok-4.6' }]).getModels()
    expect(model?.reasoning).toBe(true)
    expect(model?.thinkingLevelMap).toEqual(base?.thinkingLevelMap)
  })

  it('states a non-reasoning model with false, dropping the catalog map', () => {
    const [model] = applyModelCatalog(grok(), [{ id: 'grok-4.6', reasoningEfforts: false }]).getModels()
    expect(model?.reasoning).toBe(false)
    expect(model?.thinkingLevelMap).toBeUndefined()
  })

  it('translates a declared dict into a fully decided level map', () => {
    const [model] = applyModelCatalog(grok(), [{
      id: 'grok-4.6',
      reasoningEfforts: { low: 'low', high: 'HIGH', xhigh: 'x-high' },
    }]).getModels()
    expect(model?.reasoning).toBe(true)
    expect(model?.thinkingLevelMap).toEqual({
      off: null, minimal: null, low: 'low', medium: null, high: 'HIGH', xhigh: 'x-high', max: null,
    })
  })

  it('leaves a declared off with no value out of the map', () => {
    const [model] = applyModelCatalog(grok(), [{ id: 'grok-4.6', reasoningEfforts: { off: null, low: 'low' } }]).getModels()
    expect(model?.thinkingLevelMap).toEqual({
      minimal: null, low: 'low', medium: null, high: null, xhigh: null, max: null,
    })
    expect(Object.hasOwn(model?.thinkingLevelMap ?? {}, 'off')).toBe(false)
  })

  it('sends a declared off value when the row spells one', () => {
    const [model] = applyModelCatalog(grok(), [{
      id: 'grok-4.6',
      reasoningEfforts: { off: 'none', low: 'low' },
    }]).getModels()
    expect(model?.thinkingLevelMap).toEqual({
      off: 'none', minimal: null, low: 'low', medium: null, high: null, xhigh: null, max: null,
    })
    expect(model?.reasoning).toBe(true)
  })

  it('applies the same rules to a hand-mapped id', () => {
    const [declared] = applyModelCatalog(grok(), [{ id: 'custom-grok', reasoningEfforts: { low: 'low' } }]).getModels()
    expect(declared?.reasoning).toBe(true)
    expect(declared?.thinkingLevelMap).toEqual({
      off: null, minimal: null, low: 'low', medium: null, high: null, xhigh: null, max: null,
    })
    // The template carries its own map; an id the catalog does not know has
    // no base to inherit levels from.
    const [inherited] = applyModelCatalog(grok(), [{ id: 'custom-grok' }]).getModels()
    expect(inherited?.reasoning).toBe(false)
    expect(inherited?.thinkingLevelMap).toBeUndefined()
    const [off] = applyModelCatalog(grok(), [{ id: 'custom-grok', reasoningEfforts: false }]).getModels()
    expect(off?.reasoning).toBe(false)
    expect(off?.thinkingLevelMap).toBeUndefined()
  })

  it.each([
    [{}, /empty reasoningEfforts/],
    [{ off: null }, /no level beyond "off"/],
    [{ off: '' }, /must not be an empty string/],
    [{ low: '' }, /must not be an empty string/],
    [{ low: null }, /needs the wire value dispatch should send/],
    [{ bogus: 'x' }, /no level beyond "off"/],
  ])('rejects the invalid declaration %j on known and hand-mapped ids', (reasoningEfforts, message) => {
    for (const id of ['grok-4.6', 'custom-grok']) {
      expect(() => applyModelCatalog(grok(), [{ id, reasoningEfforts }])).toThrowError(message)
    }
  })

  it('reports an invalid declaration as a bad request naming the provider and model', () => {
    expect(() => applyModelCatalog(grok(), [{ id: 'grok-4.6', reasoningEfforts: { low: '' } }]))
      .toThrowError(expect.objectContaining({ code: 'bad-request' }))
    expect(() => applyModelCatalog(grok(), [{ id: 'grok-4.6', reasoningEfforts: {} }]))
      .toThrow(/provider "xai" model "grok-4\.6"/)
  })
})

describe('buildProfile capabilities', () => {
  it('materializes the declared modalities and levels in the resolved profile', () => {
    const grok = FAMILIES.find((row) => row.family === 'grok')
    if (grok === undefined) throw new Error('missing grok family')
    const profile = buildProfile(grok, {
      models: [{ id: 'custom-grok', input: ['text', 'image'], reasoningEfforts: { off: null, low: 'low' } }],
    })
    const [model] = profile.piProvider!.getModels()
    expect(model).toMatchObject({ id: 'custom-grok', input: ['text', 'image'], reasoning: true })
    expect(model?.thinkingLevelMap).toEqual({
      minimal: null, low: 'low', medium: null, high: null, xhigh: null, max: null,
    })
  })

  it('exposes catalog maxTokens as configuredMaxTokens', () => {
    const grok = FAMILIES.find((row) => row.family === 'grok')
    if (grok === undefined) throw new Error('missing grok family')
    const profile = buildProfile(grok, {})
    expect(profile.configuredMaxTokens.get('grok-4.6')).toBe(500_000)
  })
})
