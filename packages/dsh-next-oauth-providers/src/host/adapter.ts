/**
 * Public alias routes over an official PiAiAdapter instance.
 */
import {
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type PreparedAdapterCall,
  type ResolvedRetryPolicy,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { familyByAlias, nativeForAlias } from '../core/catalog.ts'
import { translateGenerateOptions } from '../core/alias.ts'

export class AliasLlmAdapter extends LlmAdapter {
  constructor(private readonly inner: LlmAdapter) {
    super()
  }

  private native(route: string): string {
    if (familyByAlias(route) === undefined) {
      throw new LlmError(`OAuth adapter does not own provider "${route}"`, 'NO_ADAPTER')
    }
    return nativeForAlias(route)
  }

  providerInfo(provider: string): LlmProviderInfo {
    const native = this.native(provider)
    const info = this.inner.providerInfo(native)
    const family = familyByAlias(provider)
    return { ...info, id: provider, name: family?.displayName ?? info.name }
  }

  providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.inner.providerRetryPolicy(this.native(provider))
  }

  imageRequestPricing(provider: string, model: string) {
    return this.inner.imageRequestPricing(this.native(provider), model)
  }

  async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const native = this.native(provider)
    return (await this.inner.listModels(native)).map((model) => ({ ...model, provider }))
  }

  async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const native = this.native(provider)
    return { ...(await this.inner.resolveModel(native, model, signal)), provider }
  }

  async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const native = this.native(provider)
    const prepared = await this.inner.prepareCall(native, model, signal)
    return {
      model: { ...prepared.model, provider },
      stream: (options: GenerateOptions) => prepared.stream(translateGenerateOptions(options, native)),
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const native = this.native(options.provider)
    yield* this.inner.stream(translateGenerateOptions(options, native))
  }
}
