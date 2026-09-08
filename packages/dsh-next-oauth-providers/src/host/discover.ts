/**
 * Model discovery for Fetch available models. Grok uses the coding proxy
 * catalog; other families use the signed-in pi-ai provider list.
 */
import type { CredentialStore } from '@earendil-works/pi-ai'
import type { Family } from '../core/catalog.ts'
import type { ModelDraft } from '../core/settings.ts'
import { isOauthGrant } from '../core/records.ts'
import { GROK_HEADERS, GROK_PROXY_BASE_URL, nativeFactory } from './providers.ts'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function rowId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  const row = asRecord(value)
  if (typeof row.id === 'string' && row.id.trim() !== '') return row.id.trim()
  if (typeof row.model === 'string' && row.model.trim() !== '') return row.model.trim()
  return undefined
}

function rowName(value: unknown, fallback: string): string {
  const row = asRecord(value)
  if (typeof row.name === 'string' && row.name.trim() !== '') return row.name.trim()
  if (typeof row.display_name === 'string' && row.display_name.trim() !== '') return row.display_name.trim()
  return fallback
}

export function parseGrokCatalog(payload: unknown): ModelDraft[] {
  let list: unknown[] = []
  if (Array.isArray(payload)) {
    list = payload
  } else {
    const root = asRecord(payload)
    if (Array.isArray(root.data)) list = root.data
    else if (Array.isArray(root.models)) list = root.models
  }
  const drafts: ModelDraft[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const id = rowId(entry)
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    drafts.push({ id, name: rowName(entry, id) })
  }
  return drafts
}

async function fetchGrokModels(access: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<ModelDraft[]> {
  const response = await fetchImpl(`${GROK_PROXY_BASE_URL}/models-v2`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${access}`,
      ...GROK_HEADERS,
    },
    signal,
  })
  if (!response.ok) throw new Error(`Grok catalog HTTP ${response.status}`)
  return parseGrokCatalog(await response.json())
}

export async function discoverModels(
  family: Family,
  store: CredentialStore,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<ModelDraft[]> {
  const native = nativeFactory(family.nativeId).getModels().map((model) => ({
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }))
  if (family.nativeId !== 'xai') return native
  const credential = await store.read(family.nativeId, { signal })
  if (credential === undefined || !isOauthGrant(credential)) return native

  try {
    const remote = await fetchGrokModels(credential.access, fetchImpl, signal)
    if (remote.length === 0) return native
    const byId = new Map(native.map((row) => [row.id, row]))
    return remote.map((draft) => {
      const known = byId.get(draft.id)
      if (known === undefined) return draft
      return {
        ...draft,
        ...draft.contextWindow === undefined && known.contextWindow !== undefined
          ? { contextWindow: known.contextWindow }
          : {},
        ...draft.maxTokens === undefined && known.maxTokens !== undefined
          ? { maxTokens: known.maxTokens }
          : {},
      }
    })
  } catch {
    // Fall back to the last-known static catalog.
    return native
  }
}
