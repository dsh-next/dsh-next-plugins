import { describe, expect, it, vi } from 'vitest'
import {
  LlmAdapter,
  resolveRetryPolicy,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { FAMILIES } from '../src/core/catalog.ts'
import { AliasLlmAdapter } from '../src/host/adapter.ts'

class Inner extends LlmAdapter {
  readonly calls: GenerateOptions[] = []

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('alias adapter delegation contracts', () => {
  it.each(FAMILIES)('advertises $family using its alias and native display family', (family) => {
    const inner = new Inner()
    const info = vi.spyOn(inner, 'providerInfo').mockReturnValue({ id: family.nativeId, name: 'Native' })
    const adapter = new AliasLlmAdapter(inner)
    expect(adapter.providerInfo(family.alias)).toEqual({ id: family.alias, name: family.displayName })
    expect(info).toHaveBeenCalledWith(family.nativeId)
  })

  it('forwards retry policy and image-pricing values without changing their identity', () => {
    const inner = new Inner()
    const policy = resolveRetryPolicy(undefined, 'test')
    const pricing = { priceImages: () => [] }
    const retry = vi.spyOn(inner, 'providerRetryPolicy').mockReturnValue(policy)
    const image = vi.spyOn(inner, 'imageRequestPricing').mockReturnValue(pricing)
    const adapter = new AliasLlmAdapter(inner)
    expect(adapter.providerRetryPolicy('anthropic-oauth')).toBe(policy)
    expect(adapter.imageRequestPricing('anthropic-oauth', 'model')).toBe(pricing)
    expect(retry).toHaveBeenCalledWith('anthropic')
    expect(image).toHaveBeenCalledWith('anthropic', 'model')
  })

  it('preserves absent optional retry and image pricing', () => {
    const adapter = new AliasLlmAdapter(new Inner())
    expect(adapter.providerRetryPolicy('xai-oauth')).toBeUndefined()
    expect(adapter.imageRequestPricing('xai-oauth', 'model')).toBeUndefined()
  })

  it('rewrites catalog metadata without mutating native descriptors', async () => {
    const inner = new Inner()
    const native = Object.freeze({ provider: 'anthropic', id: 'model', name: 'Model', inputModalities: ['text'] as const })
    const list = vi.spyOn(inner, 'listModels').mockResolvedValue([native])
    const adapter = new AliasLlmAdapter(inner)
    expect(await adapter.listModels('anthropic-oauth')).toEqual([{ ...native, provider: 'anthropic-oauth' }])
    expect(native.provider).toBe('anthropic')
    expect(list).toHaveBeenCalledWith('anthropic')
  })

  it('forwards resolution cancellation and preserves all resolved metadata', async () => {
    const inner = new Inner()
    const native: LlmResolvedModelInfo = Object.freeze({
      provider: 'anthropic', id: 'model', name: 'Model', context: { contextWindow: 200_000 }, defaultMaxTokens: 8192,
    })
    const resolve = vi.spyOn(inner, 'resolveModel').mockResolvedValue(native)
    const adapter = new AliasLlmAdapter(inner)
    const signal = new AbortController().signal
    expect(await adapter.resolveModel('anthropic-oauth', 'model', signal)).toEqual({ ...native, provider: 'anthropic-oauth' })
    expect(resolve).toHaveBeenCalledWith('anthropic', 'model', signal)
    expect(native.provider).toBe('anthropic')
  })

  it('retains the captured prepared stream and signal rather than dispatching a new lookup', async () => {
    const inner = new Inner()
    const captured = vi.fn((options: GenerateOptions) => inner.stream(options))
    const prepare = vi.spyOn(inner, 'prepareCall').mockResolvedValue({
      model: { provider: 'xai', id: 'model', name: 'Model' }, stream: captured,
    })
    const adapter = new AliasLlmAdapter(inner)
    const signal = new AbortController().signal
    const prepared = await adapter.prepareCall('xai-oauth', 'model', signal)
    expect(prepare).toHaveBeenCalledWith('xai', 'model', signal)
    expect(prepared.model.provider).toBe('xai-oauth')
    await collect(prepared.stream({ provider: 'xai-oauth', model: 'model', messages: [], signal }))
    expect(captured).toHaveBeenCalledWith({ provider: 'xai', model: 'model', messages: [], signal })
    expect(prepare).toHaveBeenCalledOnce()
  })

  it('translates direct-stream history without mutating caller messages or dropping call options', async () => {
    const inner = new Inner()
    const adapter = new AliasLlmAdapter(inner)
    const signal = new AbortController().signal
    const options: GenerateOptions = {
      provider: 'xai-oauth', model: 'model', signal, maxTokens: 64,
      messages: [{
        id: 'message' as GenerateOptions['messages'][number]['id'], role: 'assistant', content: [],
        source: { kind: 'model', provider: 'xai-oauth', model: 'model' },
      }],
    }
    expect(await collect(adapter.stream(options))).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
    expect(inner.calls[0]).toMatchObject({ provider: 'xai', signal, maxTokens: 64 })
    expect(inner.calls[0]?.messages[0]?.source).toMatchObject({ provider: 'xai' })
    expect(options.messages[0]?.source).toMatchObject({ provider: 'xai-oauth' })
  })

  it('rejects unowned aliases at every synchronous and asynchronous entry point', async () => {
    const adapter = new AliasLlmAdapter(new Inner())
    for (const call of [
      () => adapter.providerInfo('anthropic'),
      () => adapter.providerRetryPolicy('anthropic'),
      () => adapter.imageRequestPricing('anthropic', 'model'),
    ]) expect(call).toThrowError(expect.objectContaining({ code: 'NO_ADAPTER' }))
    await expect(adapter.listModels('anthropic')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(adapter.resolveModel('anthropic', 'model')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(adapter.prepareCall('anthropic', 'model')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(collect(adapter.stream({ provider: 'anthropic', model: 'model', messages: [] })))
      .rejects.toMatchObject({ code: 'NO_ADAPTER' })
  })

  it('propagates native resolution failures without remapping them', async () => {
    const inner = new Inner()
    const error = new Error('native resolution failed')
    vi.spyOn(inner, 'resolveModel').mockRejectedValue(error)
    await expect(new AliasLlmAdapter(inner).resolveModel('xai-oauth', 'model')).rejects.toBe(error)
  })
})
