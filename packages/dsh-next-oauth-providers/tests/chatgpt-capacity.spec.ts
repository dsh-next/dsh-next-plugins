import { describe, expect, it } from 'vitest'
import { chatgptOauthCapacity } from '../src/core/chatgpt-capacity.ts'
import { applyModelCatalog, nativeFactory } from '../src/host/providers.ts'

describe('chatgptOauthCapacity', () => {
  it('uses official API sizes for current Codex ids', () => {
    expect(chatgptOauthCapacity('gpt-5.6-luna')).toEqual({ contextWindow: 1_050_000, maxTokens: 128_000 })
    expect(chatgptOauthCapacity('gpt-5.4-mini')).toEqual({ contextWindow: 400_000, maxTokens: 128_000 })
    expect(chatgptOauthCapacity('gpt-5.3-codex-spark')).toEqual({ contextWindow: 128_000, maxTokens: 128_000 })
  })

  it('falls back to 1050K / 128K for an unknown ChatGPT id', () => {
    expect(chatgptOauthCapacity('gpt-7-future')).toEqual({ contextWindow: 1_050_000, maxTokens: 128_000 })
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
})
