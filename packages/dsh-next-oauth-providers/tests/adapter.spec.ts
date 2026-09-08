import { describe, expect, it } from 'vitest'
import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { AliasLlmAdapter } from '../src/host/adapter.ts'

class FakeInner extends LlmAdapter {
  lastProvider: string | undefined
  lastMessages: GenerateOptions['messages'] | undefined

  providerInfo(provider: string) {
    return { id: provider, name: provider }
  }

  async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return [{ provider, id: 'm1', name: 'M1' }]
  }

  async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }

  async prepareCall(provider: string, model: string) {
    return {
      model: { provider, id: model, name: model },
      stream: (options: GenerateOptions) => this.stream(options),
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastProvider = options.provider
    this.lastMessages = options.messages
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('AliasLlmAdapter', () => {
  it('exposes alias ids and dispatches native ids to the inner adapter', async () => {
    const inner = new FakeInner()
    const adapter = new AliasLlmAdapter(inner)
    expect(adapter.providerInfo('kimi-coding-oauth')).toEqual({ id: 'kimi-coding-oauth', name: 'Kimi Code' })
    const models = await adapter.listModels('kimi-coding-oauth')
    expect(models[0]?.provider).toBe('kimi-coding-oauth')
    const prepared = await adapter.prepareCall('kimi-coding-oauth', 'k2')
    expect(prepared.model.provider).toBe('kimi-coding-oauth')
    const chunks: StreamChunk[] = []
    for await (const chunk of prepared.stream({
      provider: 'kimi-coding-oauth',
      model: 'k2',
      messages: [{
        id: 'm' as GenerateOptions['messages'][number]['id'],
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'kimi-coding-oauth', model: 'k2' },
      }],
    })) chunks.push(chunk)
    expect(inner.lastProvider).toBe('kimi-coding')
    expect(inner.lastMessages?.[0]?.source).toMatchObject({ provider: 'kimi-coding' })
    expect(chunks.at(-1)?.type).toBe('finish')
  })

  it('rejects routes it does not own', () => {
    const adapter = new AliasLlmAdapter(new FakeInner())
    expect(() => adapter.providerInfo('anthropic')).toThrow(/does not own/)
  })
})
