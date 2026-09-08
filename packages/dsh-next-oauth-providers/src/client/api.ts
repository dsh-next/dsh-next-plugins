/**
 * Browser RPC client for the host subscription service.
 */
import { RPC_PATH } from '../core/ids.ts'
import type { ErrorCode } from '../core/errors.ts'
import type { AttemptView, PluginState, RpcEnvelope } from '../core/types.ts'
import type { FamilyId } from '../core/catalog.ts'
import type { ModelDraft } from '../core/settings.ts'

export class ClientRpcError extends Error {
  readonly code: ErrorCode
  readonly params?: Record<string, string | number>

  constructor(code: ErrorCode, message: string, params?: Record<string, string | number>) {
    super(message)
    this.name = 'ClientRpcError'
    this.code = code
    this.params = params
  }
}

export type RpcCall = (method: string, args?: unknown) => Promise<unknown>

export function createRpc(fetchImpl: typeof fetch = fetch): RpcCall {
  return async (method, args) => {
    const res = await fetchImpl(RPC_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, args: args === undefined ? null : args }),
    })
    let body: RpcEnvelope<unknown> | { error?: string }
    try {
      body = await res.json() as RpcEnvelope<unknown>
    } catch {
      throw new ClientRpcError('unknown', 'rpc.failed', { method, status: res.status })
    }
    if (body && typeof body === 'object' && 'ok' in body) {
      if (body.ok === true) return body.value
      throw new ClientRpcError(body.error.code, body.error.code, body.error.params)
    }
    throw new ClientRpcError('unknown', 'rpc.failed', { method, status: res.status })
  }
}

export function subscriptionsApi(rpc: RpcCall) {
  return {
    getState: () => rpc('getState') as Promise<PluginState>,
    addProvider: (family: FamilyId) => rpc('addProvider', { family }) as Promise<PluginState>,
    removeProvider: (family: FamilyId) => rpc('removeProvider', { family }) as Promise<PluginState>,
    startLogin: (family: FamilyId) => rpc('startLogin', { family }) as Promise<AttemptView>,
    getAttempt: (attemptId: string) => rpc('getAttempt', { attemptId }) as Promise<AttemptView>,
    submitPrompt: (attemptId: string, promptId: string, value: string) =>
      rpc('submitPrompt', { attemptId, promptId, value }) as Promise<AttemptView>,
    cancelLogin: (attemptId: string) => rpc('cancelLogin', { attemptId }) as Promise<AttemptView>,
    disconnect: (family: FamilyId) => rpc('disconnect', { family }) as Promise<PluginState>,
    listModels: (family: FamilyId) => rpc('listModels', { family }) as Promise<ModelDraft[]>,
    refreshModels: (family: FamilyId) => rpc('refreshModels', { family }) as Promise<PluginState>,
    addModel: (alias: string, model: ModelDraft) => rpc('addModel', { alias, model }) as Promise<PluginState>,
    setModels: (alias: string, models: readonly ModelDraft[]) => rpc('setModels', { alias, models }) as Promise<PluginState>,
    restoreModels: (alias: string) => rpc('restoreModels', { alias }) as Promise<PluginState>,
  }
}
