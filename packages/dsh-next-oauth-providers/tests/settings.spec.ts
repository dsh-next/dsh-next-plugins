import { describe, expect, it } from 'vitest'
import { configForStorage, isListed, normalizeConfig, withModels, withProvider, withoutProvider } from '../src/core/settings.ts'

describe('settings', () => {
  it('stores official llm-pi-ai catalog ids and migrates legacy aliases', () => {
    const config = normalizeConfig({
      providers: {
        'subscription-kimi': { displayName: 'Legacy', models: [{ id: 'old' }] },
        'kimi-coding': { displayName: 'Kimi', models: [{ id: ' k2 ' }, { id: '' }] },
        'subscription-claude': { displayName: 'from-alias' },
      },
    })
    expect(config.providers['kimi-coding']?.displayName).toBe('Kimi')
    expect(config.providers['kimi-coding']?.models).toEqual([{ id: 'k2' }])
    expect(config.providers['anthropic']?.displayName).toBe('from-alias')
    expect(config.providers['subscription-kimi' as never]).toBeUndefined()
  })

  it('keeps an added empty profile so the row survives Apply', () => {
    const added = withProvider({ providers: {} }, 'kimi-coding')
    expect(isListed(added, 'kimi-coding')).toBe(true)
    expect(configForStorage(added).providers).toEqual([{ id: 'kimi-coding', displayName: 'Kimi Code' }])
    expect(isListed(withoutProvider(added, 'kimi-coding'), 'kimi-coding')).toBe(false)
  })

  it('can restore defaults after an explicit catalog', () => {
    const withList = withModels({ providers: {} }, 'openai-codex', [{ id: 'gpt-5' }])
    expect(configForStorage(withList).providers).toEqual([
      { id: 'openai-codex', displayName: 'ChatGPT', models: [{ id: 'gpt-5' }] },
    ])
    const restored = withModels(withList, 'openai-codex', undefined)
    expect(restored.providers['openai-codex']?.models).toBeUndefined()
  })

  it('reads a block list of provider rows', () => {
    const config = normalizeConfig({
      providers: [
        { id: 'xai', displayName: 'Grok', models: [{ id: 'grok-4.6' }] },
      ],
    })
    expect(config.providers.xai).toEqual({ displayName: 'Grok', models: [{ id: 'grok-4.6' }] })
  })

  it('treats an empty models list as inherit defaults', () => {
    const config = normalizeConfig({ providers: { xai: { models: [] } } })
    expect(config.providers.xai).toEqual({})
    expect(withModels({ providers: { xai: { models: [{ id: 'grok-4.6' }] } } }, 'xai', []).providers.xai?.models).toBeUndefined()
  })
})
