/** Stable RPC error codes the browser maps through locale dictionaries. */

export type ErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'busy'
  | 'cancelled'
  | 'timeout'
  | 'auth'
  | 'network'
  | 'port'
  | 'origin'
  | 'unsupported'
  | 'store'
  | 'unknown'

export class RpcError extends Error {
  readonly code: ErrorCode
  readonly params?: Record<string, string | number>

  constructor(code: ErrorCode, message: string, params?: Record<string, string | number>) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.params = params
  }
}

export function classifyLoginError(error: unknown): RpcError {
  if (error instanceof RpcError) return error
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (error instanceof Error && error.name === 'AbortError') return new RpcError('cancelled', message)
  if (lower.includes('eaddrinuse') || lower.includes('address already in use')) {
    return new RpcError('port', message)
  }
  if (lower.includes('timeout') || lower.includes('timed out')) return new RpcError('timeout', message)
  if (lower.includes('enotfound') || lower.includes('network') || lower.includes('fetch')) {
    return new RpcError('network', message)
  }
  if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('invalid_grant')) {
    return new RpcError('auth', message)
  }
  return new RpcError('unknown', message)
}
