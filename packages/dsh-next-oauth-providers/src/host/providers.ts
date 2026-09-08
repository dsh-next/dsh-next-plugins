/**
 * OAuth-only pi-ai providers, plus Grok coding-backend wrapping.
 */
import type { Model, Provider } from '@earendil-works/pi-ai'
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import {
  CHATGPT_OAUTH_FALLBACK_CONTEXT_WINDOW,
  CHATGPT_OAUTH_FALLBACK_MAX_TOKENS,
  chatgptOauthCapacity,
} from '../core/chatgpt-capacity.ts'
import type { NativeId } from '../core/catalog.ts'
import type { ModelDraft } from '../core/settings.ts'
import { UNKNOWN_MODEL_CONTEXT_WINDOW, UNKNOWN_MODEL_MAX_TOKENS } from '../core/ids.ts'
import { RpcError } from '../core/errors.ts'

export const GROK_PROXY_BASE_URL = 'https://cli-chat-proxy.grok.com/v1'

export const GROK_HEADERS: Record<string, string> = {
  'X-XAI-Token-Auth': 'xai-grok-cli',
  'x-grok-client-identifier': 'grok-shell',
  'x-grok-client-version': '0.1.220',
}

export function requireOAuth(provider: Provider): Provider {
  const oauth = provider.auth.oauth
  if (oauth === undefined) throw new RpcError('unsupported', `provider "${provider.id}" has no OAuth method`)
  return { ...provider, auth: { oauth } }
}

function withModelBase(model: Model<string>, baseUrl: string, headers: Record<string, string>): Model<string> {
  return {
    ...model,
    baseUrl,
    headers: { ...model.headers, ...headers },
  }
}

export function grokCodingProvider(base: Provider): Provider {
  const oauthOnly = requireOAuth(base)
  return {
    ...oauthOnly,
    baseUrl: GROK_PROXY_BASE_URL,
    headers: { ...oauthOnly.headers, ...GROK_HEADERS },
    getModels: () => oauthOnly.getModels().map((model) => withModelBase(model, GROK_PROXY_BASE_URL, GROK_HEADERS)),
  }
}

function withChatGptOauthCapacities(provider: Provider): Provider {
  return {
    ...provider,
    getModels: () => provider.getModels().map((model) => {
      const cap = chatgptOauthCapacity(model.id)
      return { ...model, contextWindow: cap.contextWindow, maxTokens: cap.maxTokens }
    }),
  }
}

export function nativeFactory(nativeId: NativeId): Provider {
  switch (nativeId) {
    case 'kimi-coding': return requireOAuth(kimiCodingProvider())
    case 'xai': return grokCodingProvider(xaiProvider())
    case 'openai-codex': return withChatGptOauthCapacities(requireOAuth(openaiCodexProvider()))
    case 'anthropic': return requireOAuth(anthropicProvider())
  }
}

/** Provider used for Models.login — Grok still authenticates against native xAI OAuth. */
export function loginFactory(nativeId: NativeId): Provider {
  switch (nativeId) {
    case 'kimi-coding': return requireOAuth(kimiCodingProvider())
    case 'xai': return requireOAuth(xaiProvider())
    case 'openai-codex': return requireOAuth(openaiCodexProvider())
    case 'anthropic': return requireOAuth(anthropicProvider())
  }
}

export function applyModelCatalog(provider: Provider, drafts: readonly ModelDraft[] | undefined): Provider {
  if (drafts === undefined || drafts.length === 0) return provider
  const catalog = provider.getModels()
  const resolved = drafts.map((draft) => {
    const found = catalog.find((model) => model.id === draft.id)
    if (found !== undefined) {
      return {
        ...found,
        name: draft.name ?? found.name,
        contextWindow: draft.contextWindow ?? found.contextWindow,
        maxTokens: draft.maxTokens ?? found.maxTokens,
      }
    }
    const template = catalog[0]
    if (template === undefined) {
      throw new RpcError('unsupported', `provider "${provider.id}" has no catalog to extend`)
    }
    const unknownContext = provider.id === 'openai-codex'
      ? CHATGPT_OAUTH_FALLBACK_CONTEXT_WINDOW
      : UNKNOWN_MODEL_CONTEXT_WINDOW
    const unknownMax = provider.id === 'openai-codex'
      ? CHATGPT_OAUTH_FALLBACK_MAX_TOKENS
      : UNKNOWN_MODEL_MAX_TOKENS
    return {
      ...template,
      id: draft.id,
      name: draft.name ?? draft.id,
      input: ['text'] as Array<'text' | 'image'>,
      reasoning: false,
      contextWindow: draft.contextWindow ?? unknownContext,
      maxTokens: draft.maxTokens ?? unknownMax,
    }
  })
  return { ...provider, getModels: () => resolved }
}
