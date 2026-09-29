import { describe, expect, it } from 'vitest'
import { CHATGPT_OAUTH_CAPACITIES, chatgptOauthCapacity } from '../src/core/chatgpt-capacity.ts'
import { applyModelCatalog, nativeFactory } from '../src/host/providers.ts'

describe('chatgptOauthCapacity', () => {
  it('uses official API sizes for current Codex ids', () => {
    expect(chatgptOauthCapacity('gpt-5.4')).toEqual({ contextWindow: 1_050_000, maxTokens: 128_000 })
    expect(chatgptOauthCapacity('gpt-5.4-mini')).toEqual({ contextWindow: 400_000, maxTokens: 128_000 })
    expect(chatgptOauthCapacity('gpt-5.6-luna')).toEqual({ contextWindow: 1_050_000, maxTokens: 128_000 })
    expect(chatgptOauthCapacity('gpt-5.3-codex-spark')).toEqual({ contextWindow: 128_000, maxTokens: 128_000 })
  })

  it('falls back to 1050K / 128K for an unknown ChatGPT id', () => {
    expect(chatgptOauthCapacity('gpt-7-future')).toEqual({ contextWindow: 1_050_000, maxTokens: 128_000 })
  })
})

describe('openai-codex capacity map', () => {
  it('covers every id the pinned pi-ai catalog ships', () => {
    const missing = nativeFactory('openai-codex').getModels()
      .map((model) => model.id)
      .filter((id) => CHATGPT_OAUTH_CAPACITIES[id] === undefined)
    expect(missing).toEqual([])
  })

  it('carries no entry for an id the pinned pi-ai catalog dropped', () => {
    const shipped = new Set(nativeFactory('openai-codex').getModels().map((model) => model.id))
    const stale = Object.keys(CHATGPT_OAUTH_CAPACITIES).filter((id) => !shipped.has(id))
    expect(stale).toEqual([])
  })
})

describe('openai-codex native catalog', () => {
  it('overlays official sizes on pi-ai models', () => {
    const luna = nativeFactory('openai-codex').getModels().find((model) => model.id === 'gpt-5.6-luna')
    expect(luna).toMatchObject({ contextWindow: 1_050_000, maxTokens: 128_000 })
  })

  it('keeps a stored Customized-settings override', () => {
    const [model] = applyModelCatalog(nativeFactory('openai-codex'), [{
      id: 'gpt-5.6-luna',
      contextWindow: 272_000,
      maxTokens: 64_000,
    }]).getModels()
    expect(model).toMatchObject({ id: 'gpt-5.6-luna', contextWindow: 272_000, maxTokens: 64_000 })
  })

  it('uses 1050K / 128K for an unlisted ChatGPT id', () => {
    const [model] = applyModelCatalog(nativeFactory('openai-codex'), [{ id: 'gpt-7-future' }]).getModels()
    expect(model).toMatchObject({ id: 'gpt-7-future', contextWindow: 1_050_000, maxTokens: 128_000 })
  })

  it('adds images to a text-only Codex id the row declares them for', () => {
    const spark = nativeFactory('openai-codex').getModels().find((model) => model.id === 'gpt-5.3-codex-spark')
    expect(spark?.input).toEqual(['text'])
    const [model] = applyModelCatalog(nativeFactory('openai-codex'), [{
      id: 'gpt-5.3-codex-spark',
      input: ['text', 'image'],
      reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    }]).getModels()
    expect(model).toMatchObject({
      id: 'gpt-5.3-codex-spark',
      contextWindow: 128_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
      reasoning: true,
    })
    expect(model?.thinkingLevelMap).toEqual({
      off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null,
    })
  })

  it('keeps the Codex fallback capacities on a declared unlisted id', () => {
    const [model] = applyModelCatalog(nativeFactory('openai-codex'), [{
      id: 'gpt-7-vision',
      input: ['text', 'image'],
      reasoningEfforts: { low: 'low' },
    }]).getModels()
    expect(model).toMatchObject({
      id: 'gpt-7-vision',
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
    })
  })

  it('turns Codex reasoning off without keeping the shipped level map', () => {
    const base = nativeFactory('openai-codex').getModels().find((model) => model.id === 'gpt-6-astra')
    expect(base?.thinkingLevelMap).toBeDefined()
    const [model] = applyModelCatalog(nativeFactory('openai-codex'), [{
      id: 'gpt-6-astra',
      reasoningEfforts: false,
    }]).getModels()
    expect(model).toMatchObject({ id: 'gpt-6-astra', reasoning: false })
    expect(model?.thinkingLevelMap).toBeUndefined()
  })
})
