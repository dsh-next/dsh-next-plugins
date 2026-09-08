/**
 * The four subscription families this plugin owns. Public DSH routes are
 * official catalog ids with an `-oauth` suffix so they never collide with
 * API-key rows (`anthropic`, `xai`, `kimi-coding`, `openai-codex`).
 */

export type FamilyId = 'kimi' | 'grok' | 'codex' | 'claude'

export type AliasRoute =
  | 'kimi-coding-oauth'
  | 'xai-oauth'
  | 'openai-codex-oauth'
  | 'anthropic-oauth'

export type NativeId = 'kimi-coding' | 'xai' | 'openai-codex' | 'anthropic'

export interface Family {
  readonly family: FamilyId
  readonly alias: AliasRoute
  readonly nativeId: NativeId
  readonly displayName: string
}

export const FAMILIES: readonly Family[] = [
  { family: 'kimi', alias: 'kimi-coding-oauth', nativeId: 'kimi-coding', displayName: 'Kimi Code' },
  { family: 'grok', alias: 'xai-oauth', nativeId: 'xai', displayName: 'Grok' },
  { family: 'codex', alias: 'openai-codex-oauth', nativeId: 'openai-codex', displayName: 'ChatGPT' },
  { family: 'claude', alias: 'anthropic-oauth', nativeId: 'anthropic', displayName: 'Claude' },
]

/** Unpublished YAML keys from earlier local builds; read once, then rewritten. */
export const LEGACY_YAML_KEYS: Readonly<Record<string, NativeId>> = {
  'subscription-kimi': 'kimi-coding',
  'subscription-grok': 'xai',
  'subscription-codex': 'openai-codex',
  'subscription-claude': 'anthropic',
}

const BY_FAMILY = new Map(FAMILIES.map((row) => [row.family, row]))
const BY_ALIAS = new Map(FAMILIES.map((row) => [row.alias, row]))
const BY_NATIVE = new Map(FAMILIES.map((row) => [row.nativeId, row]))

export function familyById(id: string): Family | undefined {
  return BY_FAMILY.get(id as FamilyId)
}

export function familyByAlias(alias: string): Family | undefined {
  return BY_ALIAS.get(alias as AliasRoute)
}

export function familyByNative(nativeId: string): Family | undefined {
  return BY_NATIVE.get(nativeId as NativeId)
}

export function isAliasRoute(value: string): value is AliasRoute {
  return BY_ALIAS.has(value as AliasRoute)
}

export function isNativeId(value: string): value is NativeId {
  return BY_NATIVE.has(value as NativeId)
}

/** Native provider id the inner PiAiAdapter uses for one public route. */
export function nativeForAlias(alias: string): NativeId {
  const row = familyByAlias(alias)
  if (row === undefined) throw new Error(`unknown subscription route "${alias}"`)
  return row.nativeId
}

/** Public DSH route for a native pi-ai provider id. */
export function aliasForNative(nativeId: string): AliasRoute {
  const row = familyByNative(nativeId)
  if (row === undefined) throw new Error(`unknown native provider "${nativeId}"`)
  return row.alias
}

export const ALL_ALIASES: readonly AliasRoute[] = FAMILIES.map((row) => row.alias)

export const ALL_NATIVES: readonly NativeId[] = FAMILIES.map((row) => row.nativeId)

/** Settings.yaml key: official catalog id, public -oauth route, or a local-dev leftover. */
export function nativeForSettingsKey(key: string): NativeId | undefined {
  return familyByNative(key)?.nativeId ?? familyByAlias(key)?.nativeId ?? LEGACY_YAML_KEYS[key]
}
