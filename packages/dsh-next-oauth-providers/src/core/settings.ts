/**
 * User-layer configuration for subscription catalogs. Lives in settings.yaml
 * under `dsh-next-oauth-providers:`, keyed by official llm-pi-ai catalog ids
 * (`xai`, `kimi-coding`, `openai-codex`, `anthropic`). An omitted `models`
 * list means "use the adapter defaults"; an explicit list replaces the
 * catalog (same rule as llm-pi-ai).
 */

import { FAMILIES, LEGACY_YAML_KEYS, type NativeId } from './catalog.ts'

/** Request modalities a row may accept, matching pi-ai's model `input`. */
export const MODALITIES = ['text', 'image'] as const

/** pi-ai's thinking levels in escalation order — the keys `reasoningEfforts` may declare. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ModelInput = typeof MODALITIES[number]

export type ThinkingLevel = typeof THINKING_LEVELS[number]

/**
 * Level to wire spelling. A declared level carries the value dispatch sends;
 * `null` marks the level unsupported, except on `off` where it means
 * "supported, send nothing" (pi-ai reads an absent `off` key the same way).
 */
export type ReasoningEfforts = Readonly<Record<string, string | null>>

export interface ModelDraft {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  /** Request modalities; omitted inherits the catalog's, or text-only. */
  readonly input?: readonly ModelInput[]
  /** Declared thinking levels, or `false` for a non-reasoning model. */
  readonly reasoningEfforts?: ReasoningEfforts | false
}

export interface ProviderProfile {
  readonly displayName?: string
  readonly models?: readonly ModelDraft[]
}

export interface PluginConfig {
  readonly providers: Readonly<Partial<Record<NativeId, ProviderProfile>>>
}

/** On-disk row: a dict so the native Models page can address `providers.<nativeId>`. */
export interface StoredConfig {
  readonly providers: Readonly<Partial<Record<NativeId, ProviderProfile>>>
}

export const EMPTY_CONFIG: PluginConfig = { providers: {} }

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * A declared modality list, or `undefined` when the row states no answer.
 * Absent and empty mean the same thing — `[]` describes a model that accepts
 * nothing and could serve no request — which is also how the official
 * resolver reads a `models` entry.
 */
function modalityList(value: unknown): ModelInput[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list: ModelInput[] = []
  for (const entry of value) {
    if (entry !== 'text' && entry !== 'image') return undefined
    list.push(entry)
  }
  return list.length === 0 ? undefined : list
}

/**
 * A declared `reasoningEfforts`. `false` is a decision (not a reasoning
 * model); a dict keeps only the pi-ai levels, so a key the route cannot serve
 * never reaches the thinking-level map. Semantic shapes the editor must report
 * — an empty dict, `off` alone, an empty wire spelling, `null` above `off` —
 * survive normalization on purpose, so the card can name them instead of
 * silently keeping the catalog's capability.
 */
function reasoningEffortsField(value: unknown): ReasoningEfforts | false | undefined {
  if (value === false) return false
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const efforts: Record<string, string | null> = {}
  for (const level of THINKING_LEVELS) {
    const wire = source[level]
    if (wire === undefined) continue
    if (wire !== null && typeof wire !== 'string') return undefined
    efforts[level] = wire
  }
  return efforts
}

export function normalizeModelDraft(value: unknown): ModelDraft | undefined {
  const row = asRecord(value)
  if (typeof row.id !== 'string' || row.id.trim() === '') return undefined
  const id = row.id.trim()
  const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name.trim() : undefined
  const contextWindow = positiveInt(row.contextWindow)
  const maxTokens = positiveInt(row.maxTokens)
  const input = modalityList(row.input)
  const reasoningEfforts = reasoningEffortsField(row.reasoningEfforts)
  return {
    id,
    ...name === undefined ? {} : { name },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...input === undefined ? {} : { input },
    ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
  }
}

export function normalizeProfile(value: unknown): ProviderProfile {
  const row = asRecord(value)
  const displayName = typeof row.displayName === 'string' && row.displayName.trim() !== ''
    ? row.displayName.trim()
    : undefined
  const drafts = Array.isArray(row.models)
    ? row.models.map(normalizeModelDraft).filter((entry): entry is ModelDraft => entry !== undefined)
    : undefined
  const models = drafts !== undefined && drafts.length > 0 ? drafts : undefined
  return {
    ...displayName === undefined ? {} : { displayName },
    ...models === undefined ? {} : { models },
  }
}

function nativeIdOfRow(value: unknown): NativeId | undefined {
  const id = asRecord(value).id
  if (typeof id !== 'string') return undefined
  const family = FAMILIES.find((row) => row.nativeId === id || row.alias === id)
  return family?.nativeId
}

export function normalizeConfig(value: unknown): PluginConfig {
  const root = asRecord(value)
  const raw = root.providers
  const providers: Partial<Record<NativeId, ProviderProfile>> = {}
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const native = nativeIdOfRow(entry)
      if (native === undefined) continue
      providers[native] = normalizeProfile(entry)
    }
    return { providers }
  }
  const dict = asRecord(raw)
  for (const family of FAMILIES) {
    const legacy = Object.entries(LEGACY_YAML_KEYS).find(([, native]) => native === family.nativeId)?.[0]
    const source = dict[family.nativeId] ?? dict[family.alias] ?? (legacy === undefined ? undefined : dict[legacy])
    if (source === undefined) continue
    providers[family.nativeId] = normalizeProfile(source)
  }
  return { providers }
}

export function profileOf(config: PluginConfig, nativeId: NativeId): ProviderProfile {
  return config.providers[nativeId] ?? {}
}

/** User-section payload for the plugin config: the profile dict, keyed by native id. */
export function configForStorage(config: PluginConfig): StoredConfig {
  const providers: Partial<Record<NativeId, ProviderProfile>> = {}
  for (const family of FAMILIES) {
    const profile = config.providers[family.nativeId]
    if (profile === undefined) continue
    providers[family.nativeId] = {
      displayName: profile.displayName ?? family.displayName,
      ...profile.models === undefined ? {} : { models: profile.models },
    }
  }
  return { providers }
}

export function isListed(config: PluginConfig, nativeId: NativeId): boolean {
  return config.providers[nativeId] !== undefined
}

export function withProvider(config: PluginConfig, nativeId: NativeId, profile?: ProviderProfile): PluginConfig {
  return {
    providers: {
      ...config.providers,
      [nativeId]: profile ?? profileOf(config, nativeId),
    },
  }
}

export function withoutProvider(config: PluginConfig, nativeId: NativeId): PluginConfig {
  const providers = { ...config.providers }
  delete providers[nativeId]
  return { providers }
}

export function withModels(config: PluginConfig, nativeId: NativeId, models: readonly ModelDraft[] | undefined): PluginConfig {
  const current = profileOf(config, nativeId)
  const explicit = models !== undefined && models.length > 0 ? models : undefined
  const next: ProviderProfile = {
    ...current.displayName === undefined ? {} : { displayName: current.displayName },
    ...explicit === undefined ? {} : { models: explicit },
  }
  return withProvider(config, nativeId, next)
}
