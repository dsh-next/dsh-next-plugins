import { describe, expect, it } from 'vitest'
import { CHATGPT_OAUTH_CAPACITIES, chatgptOauthCapacity } from '../src/core/chatgpt-capacity.ts'
import { applyModelCatalog, nativeFactory } from '../src/host/providers.ts'

describe('chatgptOauthCapacity', () => {
  it('uses official API sizes for current Codex ids', () => {
    expect(chatgptOauthCapacity('gpt-6-sol')).toEqual({ contextWindow: 1_050_000, maxTokens: 128_000 })
    expect(chatgptOauthCapacity('gpt-6-luna')).toEqual({ contextWindow: 1_050_000, maxTokens: 128_000 })
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
})
