import type { AliasRoute, FamilyId, NativeId } from './catalog.ts'
import type { ModelDraft } from './settings.ts'
import type { ErrorCode } from './errors.ts'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export interface ModelView {
  readonly id: string
  readonly name: string
  readonly contextWindow?: number
  readonly maxTokens?: number
}

export interface ProviderState {
  readonly family: FamilyId
  readonly alias: AliasRoute
  readonly nativeId: NativeId
  readonly displayName: string
  readonly status: ConnectionStatus
  readonly accountLabel?: string
  readonly models: readonly ModelView[]
  readonly defaultModels: readonly ModelView[]
  readonly modelsOverridden: boolean
  readonly usingDefaults: boolean
}

export interface PluginState {
  readonly providers: readonly ProviderState[]
  readonly writable: boolean
}

export interface AttemptPrompt {
  readonly id: string
  readonly kind: 'text' | 'secret' | 'select'
  readonly message: string
  readonly placeholder?: string
  readonly options?: readonly { id: string; label: string; description?: string }[]
}

export interface AttemptNotice {
  readonly message: string
  readonly url?: string
  readonly code?: string
}

export type AttemptStatus = 'running' | 'authorized' | 'cancelled' | 'failed'

export interface AttemptView {
  readonly id: string
  readonly family: FamilyId
  readonly status: AttemptStatus
  readonly notice?: AttemptNotice
  readonly prompt?: AttemptPrompt
  readonly error?: { code: ErrorCode; params?: Record<string, string | number> }
  readonly expiresAt: number
}

export interface RpcOk<T> {
  readonly ok: true
  readonly value: T
}

export interface RpcFail {
  readonly ok: false
  readonly error: { code: ErrorCode; params?: Record<string, string | number> }
}

export type RpcEnvelope<T> = RpcOk<T> | RpcFail

export type { ModelDraft }
