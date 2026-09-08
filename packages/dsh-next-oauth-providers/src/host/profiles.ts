/**
 * Build official ResolvedPiAiProviderProfile values without calling the
 * unexported resolveProfiles helper.
 */
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { Family } from '../core/catalog.ts'
import {
  MAX_REQUEST_IMAGE_BYTES,
  REQUEST_IMAGE_MAX_BYTES,
  REQUEST_IMAGE_PIXEL_BUDGET,
  STREAM_IDLE_TIMEOUT_MS,
} from '../core/ids.ts'
import type { ProviderProfile } from '../core/settings.ts'
import { applyModelCatalog, GROK_HEADERS, nativeFactory } from './providers.ts'

export function buildProfile(family: Family, stored: ProviderProfile): ResolvedPiAiProviderProfile {
  const piProvider = applyModelCatalog(nativeFactory(family.nativeId), stored.models)
  const headers = family.nativeId === 'xai' ? GROK_HEADERS : undefined
  const configuredMaxTokens = new Map<string, number>()
  for (const model of piProvider.getModels()) {
    if (typeof model.maxTokens === 'number' && model.maxTokens > 0) {
      configuredMaxTokens.set(model.id, model.maxTokens)
    }
  }
  return {
    provider: family.nativeId,
    displayName: stored.displayName ?? family.displayName,
    piProvider,
    streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
    maxRequestImageBytes: MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: REQUEST_IMAGE_MAX_BYTES,
    retryPolicy: resolveRetryPolicy(undefined, `dsh-next-oauth-providers.${family.nativeId}`),
    configuredMaxTokens,
    ...headers === undefined ? {} : { headers },
  }
}
