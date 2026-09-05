/**
 * Same-origin RPC client for the worktrees host half.
 *
 * Envelope contract (src/host/rpc.ts): success answers the handler's value
 * directly; failure answers HTTP 200 with `{ error: { code, message,
 * hint? } }`. This wrapper turns that into thrown WorktreesRpcErrors so
 * callers branch on machine codes, never on string matching.
 */
export const RPC_PATH = '/dsh-next-worktrees/rpc'

/** A structured RPC failure carrying the host's machine code. */
export class WorktreesRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'WorktreesRpcError'
  }
}

/** Minimal shape of the projections the client consumes. */
export interface WorktreeTopologyStatus {
  readonly clean: boolean
  readonly dirty: boolean
  readonly ahead: number
  readonly merged: boolean
  readonly conflict: boolean
}

export interface WorktreeTopologyWorktree {
  readonly slug: string
  readonly title: string
  readonly path: string
  readonly branch: string
  readonly baseRef: string
  readonly primaryBranch: string
  readonly status: WorktreeTopologyStatus
  readonly sessionIds: readonly string[]
}

export interface WorktreeTopologyRepo {
  readonly primary: string
  readonly ok: boolean
  readonly worktrees: readonly WorktreeTopologyWorktree[]
}

export interface WorktreeTopology {
  readonly repos: readonly WorktreeTopologyRepo[]
  readonly workspaces: readonly {
    readonly cwd: string
    readonly primary: string
    readonly canCreate: boolean
    readonly reason?: string
  }[]
}

/** Call one RPC method. */
export function rpc<T>(method: string, args?: unknown): Promise<T> {
  return fetch(RPC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args: args === undefined ? null : args }),
  }).then((res) => {
    if (!res.ok) throw new WorktreesRpcError('http', `HTTP ${res.status}`)
    return res.json() as Promise<T>
  }).then((payload) => {
    if (payload !== null && typeof payload === 'object' && 'error' in payload) {
      const error = (payload as { error: { code: string; message: string; hint?: string } }).error
      throw new WorktreesRpcError(error.code, error.message, error.hint)
    }
    return payload as T
  })
}

/** Window event the menu Refresh action dispatches to re-pull topology. */
export const REFRESH_EVENT = 'dsh-next-worktrees:refresh'

/** Ask every consumer to re-pull topology. */
export function requestTopologyRefresh(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT))
}
