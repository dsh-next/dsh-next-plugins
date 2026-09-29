import { DecisionError, ERROR_CODES, RPC_PATH, type ChoiceResult, type ProviderChange, type ProvidersState } from '../core/types.ts'
import { parseProvider, record } from '../core/validation.ts'

export interface DecisionApi {
  state(signal?: AbortSignal): Promise<ProvidersState>
  save(change: ProviderChange, signal?: AbortSignal): Promise<ProvidersState>
  remove(id: string, revision: string, signal?: AbortSignal): Promise<ProvidersState>
  test(providerId: string, modelId: string, signal?: AbortSignal): Promise<ChoiceResult>
}
function stateResponse(value: unknown): ProvidersState {
  if (!record(value) || typeof value.writable !== 'boolean' || typeof value.revision !== 'string' || !Array.isArray(value.providers)) throw new DecisionError('failed')
  const providers = value.providers.map(item => {
    if (!record(item) || typeof item.keyConfigured !== 'boolean') throw new DecisionError('failed')
    const { keyConfigured, ...provider } = item
    return { ...parseProvider(provider), keyConfigured }
  })
  return { providers, writable: value.writable, revision: value.revision }
}
export function createApi(fetchImpl: typeof fetch = fetch): DecisionApi {
  const call = async (method: string, args?: unknown, signal?: AbortSignal): Promise<unknown> => {
    const response = await fetchImpl(RPC_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }), signal })
    let value: unknown
    try { value = await response.json() } catch { throw new DecisionError('failed') }
    if (!record(value)) throw new DecisionError('failed')
    if (value.ok === false && record(value.error) && ERROR_CODES.includes(value.error.code as typeof ERROR_CODES[number])) throw new DecisionError(value.error.code as typeof ERROR_CODES[number])
    if (!response.ok || value.ok !== true || !Object.hasOwn(value, 'value')) throw new DecisionError('failed')
    return value.value
  }
  return {
    state: async signal => stateResponse(await call('state', undefined, signal)),
    save: async (change, signal) => stateResponse(await call('save', change, signal)),
    remove: async (id, revision, signal) => stateResponse(await call('remove', { id, revision }, signal)),
    test: async (providerId, modelId, signal) => {
      const result = await call('test', { providerId, modelId }, signal)
      if (!record(result) || typeof result.model !== 'string' || typeof result.elapsedMs !== 'number' || !Number.isFinite(result.elapsedMs) || result.elapsedMs < 0) throw new DecisionError('failed')
      return result as unknown as ChoiceResult
    },
  }
}
