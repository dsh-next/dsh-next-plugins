/**
 * Same-origin RPC client for the checkpoints host half.
 */
export const RPC_PATH = '/dsh-next-checkpoints/rpc'

export class CheckpointsRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'CheckpointsRpcError'
  }
}

export function rpc<T>(method: string, args?: unknown): Promise<T> {
  return fetch(RPC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args: args === undefined ? null : args }),
  }).then((res) => {
    if (!res.ok) throw new CheckpointsRpcError('http', `HTTP ${res.status}`)
    return res.json() as Promise<T>
  }).then((payload) => {
    if (payload !== null && typeof payload === 'object' && 'error' in payload) {
      const error = (payload as { error: { code: string; message: string; hint?: string } }).error
      throw new CheckpointsRpcError(error.code, error.message, error.hint)
    }
    return payload as T
  })
}
