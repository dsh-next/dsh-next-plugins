/**
 * Rewrite a request copy so official PiAiAdapter sees native provider ids
 * in history. Never mutates the caller's frozen messages.
 */
import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import { familyByAlias, nativeForAlias } from './catalog.ts'

function rewriteSourceProvider(provider: string): string {
  return familyByAlias(provider) === undefined ? provider : nativeForAlias(provider)
}

/**
 * Map every known subscription alias on assistant `source.provider` to the
 * native pi-ai id. Strip `replayState` from foreign (non-this-route) copies
 * so a decoder cannot mismatch alias vs native envelopes.
 *
 * Takes `RequestMessage`, the type `GenerateOptions.messages` carries since
 * DSH 0.1.7 (a one-shot request may hold identity-free user inputs); those
 * have no assistant source and pass through untouched. Generic over the input
 * so a caller holding narrower messages keeps its own type back.
 */
export function rewriteMessagesForNative<M extends RequestMessage>(
  messages: readonly M[],
  route: string,
): M[] {
  const native = rewriteSourceProvider(route)
  return messages.map((message) => {
    if (message.role !== 'assistant' || message.source.kind !== 'model') return message
    const source = message.source
    const rewrittenProvider = rewriteSourceProvider(source.provider)
    if (rewrittenProvider === native) {
      if (source.provider === native) return message
      return { ...message, source: { ...source, provider: native } }
    }
    if (source.replayState === undefined && source.provider === rewrittenProvider) return message
    const { replayState: _dropped, ...rest } = source
    return { ...message, source: { ...rest, provider: rewrittenProvider } }
  })
}

export function translateGenerateOptions(options: GenerateOptions, native: string): GenerateOptions {
  return {
    ...options,
    provider: native,
    messages: rewriteMessagesForNative(options.messages, options.provider),
  }
}
