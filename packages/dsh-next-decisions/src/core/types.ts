export const SERVICE_KEY = 'dsh-next-decisions'
export const RPC_PATH = '/dsh-next-decisions/rpc'
export const DEFAULT_BASE_URL = 'https://api.typesafe.ai/v1'

export const ERROR_CODES = ['invalid-provider', 'invalid-models', 'invalid-request', 'not-found', 'conflict', 'read-only', 'credentials', 'configuration', 'network', 'http', 'invalid-response', 'busy', 'cancelled', 'timeout', 'disposed', 'origin', 'failed'] as const
export type ErrorCode = typeof ERROR_CODES[number]
export class DecisionError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = 'DecisionError' }
}
export interface DecisionModel {
  id: string
  /** Presentation only. Inference always sends the exact ID. */
  name?: string
  /** Provider-advertised total request context, in tokens; informational only. */
  contextWindow?: number
}
export interface DecisionProvider {
  id: string
  name: string
  baseUrl: string
  models: DecisionModel[]
}
export interface ProviderView extends DecisionProvider { keyConfigured: boolean }
export interface ProvidersState { providers: ProviderView[]; writable: boolean; revision: string }
export interface ProviderChange { provider: DecisionProvider; revision: string; mode: 'create' | 'edit'; apiKey?: string; clearKey?: boolean }
export interface ChoiceQuestion { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
export interface ChoiceRequest {
  providerId: string
  modelId: string
  state: string | Record<string, unknown> | unknown[]
  questions: Record<string, ChoiceQuestion>
}
export interface ChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  /** Provider-derived distribution statistic, not measured accuracy or authorization. */
  confidence: number
}
export interface ChoiceResult {
  providerId: string
  requestedModel: string
  model: string
  answers: Record<string, ChoiceAnswer>
  usage: { input_tokens?: number; output_tokens?: number }
  elapsedMs: number
}
/** Host-only inference interface. It grants no permission and performs no chosen action. */
export interface Decisions {
  listModels(): Promise<Array<{ providerId: string; providerName: string; modelId: string; modelName?: string; contextWindow?: number }>>
  evaluate(request: ChoiceRequest, signal?: AbortSignal): Promise<ChoiceResult>
}
export type RpcEnvelope<T> = { ok: true; value: T } | { ok: false; error: { code: ErrorCode } }
