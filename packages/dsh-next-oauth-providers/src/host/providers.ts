/**
 * OAuth-only pi-ai providers, plus Grok coding-backend wrapping.
 */
import type { Model, Provider, ThinkingLevelMap } from '@earendil-works/pi-ai'
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
import { THINKING_LEVELS, type ModelDraft, type ModelInput, type ReasoningEfforts } from '../core/settings.ts'
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

/**
 * A row's modality list, or `undefined` when it states no answer. Absent and
 * empty mean the same thing — `[]` describes a model that accepts nothing and
 * could serve no request — which is what keeps a row that names a catalog
 * model without declaring modalities on the catalog's list.
 */
function declaredInput(configured: readonly ModelInput[] | undefined): ModelInput[] | undefined {
  return configured === undefined || configured.length === 0 ? undefined : [...configured]
}

function declaredEffort(efforts: ReasoningEfforts, level: string): string | null | undefined {
  return (efforts as Record<string, string | null | undefined>)[level]
}

function invalid(provider: Provider, detail: string): never {
  throw new RpcError('bad-request', `provider "${provider.id}" ${detail}`)
}

/**
 * Resolve one row's reasoning capability from its declared efforts, mirroring
 * official llm-pi-ai `resolveModelReasoning`.
 *
 * A declared dict translates to pi-ai's `thinkingLevelMap` with every level
 * decided explicitly: declared levels carry their wire spelling, undeclared
 * levels are pinned to `null` (unsupported). Pinning matters because pi-ai's
 * own defaulting is asymmetric — an absent key means "supported" for the five
 * base levels but "unsupported" for `xhigh`/`max` — and a settings author
 * should not need to know that. A declared `off` with no value is the one
 * exception: it stays absent from the map, which pi-ai reads as "supported,
 * send nothing", the correct dispatch where not thinking is the parameter's
 * absence. Omitting the field keeps whatever the base already had, and `false`
 * states a non-reasoning model outright.
 * @returns the reasoning flag, plus the level map when the row declares one.
 */
function resolveModelReasoning(
  provider: Provider,
  draft: ModelDraft,
  base: Model<string> | undefined,
): { reasoning: boolean; thinkingLevelMap?: ThinkingLevelMap } {
  const efforts = draft.reasoningEfforts
  if (efforts === undefined) return { reasoning: base?.reasoning ?? false, thinkingLevelMap: base?.thinkingLevelMap }
  if (efforts === false) return { reasoning: false }
  if (Object.keys(efforts).length === 0) {
    invalid(provider, `model "${draft.id}" has an empty reasoningEfforts; declare the offered levels, set false for a non-reasoning model, or omit the field to keep the installed catalog's capability`)
  }
  const declared = THINKING_LEVELS.flatMap((level) => {
    const wire = declaredEffort(efforts, level)
    return wire === undefined ? [] : [[level, wire] as const]
  })
  for (const [level, wire] of declared) {
    if (wire === null) {
      if (level !== 'off') invalid(provider, `model "${draft.id}" reasoningEfforts.${level} needs the wire value dispatch should send; only "off" may leave it empty`)
    } else if (wire.length === 0) {
      invalid(provider, `model "${draft.id}" reasoningEfforts.${level} must not be an empty string`)
    }
  }
  if (!declared.some(([level]) => level !== 'off')) {
    invalid(provider, `model "${draft.id}" reasoningEfforts offers no level beyond "off"; declare a thinking level, or set reasoningEfforts to false for a non-reasoning model`)
  }
  const thinkingLevelMap: ThinkingLevelMap = {}
  for (const level of THINKING_LEVELS) {
    const wire = declaredEffort(efforts, level)
    if (wire === undefined) thinkingLevelMap[level] = null
    else if (wire !== null) thinkingLevelMap[level] = wire
  }
  return { reasoning: true, thinkingLevelMap }
}

export function applyModelCatalog(provider: Provider, drafts: readonly ModelDraft[] | undefined): Provider {
  if (drafts === undefined || drafts.length === 0) return provider
  const catalog = provider.getModels()
  const resolved = drafts.map((draft) => {
    const found = catalog.find((model) => model.id === draft.id)
    if (found !== undefined) {
      const reasoning = resolveModelReasoning(provider, draft, found)
      const model = {
        ...found,
        name: draft.name ?? found.name,
        contextWindow: draft.contextWindow ?? found.contextWindow,
        maxTokens: draft.maxTokens ?? found.maxTokens,
        input: declaredInput(draft.input) ?? found.input,
        reasoning: reasoning.reasoning,
      }
      // A row that declares no map must not keep the catalog's: those levels
      // describe the model the row used to be.
      if (reasoning.thinkingLevelMap === undefined) delete model.thinkingLevelMap
      else model.thinkingLevelMap = reasoning.thinkingLevelMap
      return model
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
    const reasoning = resolveModelReasoning(provider, draft, undefined)
    const clone = {
      ...template,
      id: draft.id,
      name: draft.name ?? draft.id,
      input: declaredInput(draft.input) ?? ['text'],
      contextWindow: draft.contextWindow ?? unknownContext,
      maxTokens: draft.maxTokens ?? unknownMax,
      reasoning: reasoning.reasoning,
    }
    // The template's map describes the template: an id the catalog does not
    // know has no base to inherit levels from, so a row that declares none
    // must not carry them.
    if (reasoning.thinkingLevelMap === undefined) delete clone.thinkingLevelMap
    else clone.thinkingLevelMap = reasoning.thinkingLevelMap
    return clone
  })
  return { ...provider, getModels: () => resolved }
}
