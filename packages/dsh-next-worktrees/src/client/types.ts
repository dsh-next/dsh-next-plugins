/**
 * Shared client-side types: translator, RPC wrapper, and the runtime
 * services the flows drive (the incumbent-proven create/open surface).
 */

/** Translator over this package's namespace. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** Same-origin RPC call into the host half. */
export type Rpc = (method: string, args?: unknown) => Promise<unknown>

/** The client sessions surface the flows need. */
export interface SessionsLike {
  create(input: { workspaceId: string }): Promise<string>
  open(sessionId: string): void
}

/** The client workspaces surface the flows need. */
export interface WorkspacesLike {
  create(input: { path: string }): Promise<{ workspaceId: string; path: string }>
}

/** Both runtime services, defensively optional (composition-dependent). */
export interface WorktreeClientServices {
  readonly sessions?: SessionsLike
  readonly workspaces?: WorkspacesLike
}

/** One standard-props hook face (uSES selector) over an unknown snapshot. */
export type SelectorHook = <T>(select: (snapshot: unknown) => T) => T

/** Session/input standard props consumed by the entries (loose faces). */
export interface EntryRuntimeProps {
  readonly sessionId?: string | undefined
  readonly useSession?: SelectorHook | undefined
  readonly useInput?: SelectorHook | undefined
}

/** Create RPC outcome (contract-tested on the host side). */
export interface CreateRpcOutcome {
  readonly slug: string
  readonly path: string
  readonly sessionCwd: string
  readonly branch: string
  readonly baseRef: string
  readonly title: string
}

/** Preflight RPC outcome. */
export interface PreflightRpcOutcome {
  readonly ok: boolean
  readonly degraded: boolean
  readonly reasons: readonly string[]
  readonly showIgnoreHint: boolean
}

/** Status RPC outcome (subset the chip renders). */
export interface StatusRpcOutcome {
  readonly bound: boolean
  readonly binding: {
    readonly slug: string
    readonly path: string
    readonly branch: string
    readonly baseRef: string
    readonly title: string
  } | null
  readonly chipStatus: 'clean' | 'dirty' | 'error' | null
  readonly ahead: number | null
  readonly dirty: boolean | null
  readonly siblings: readonly {
    readonly slug: string
    readonly title: string
    readonly branch: string
    readonly sessionId: string | null
    readonly running: boolean | null
  }[]
}

/** The RPC error envelope (`{ error: { code, message, hint? } }`). */
export interface RpcErrorPayload {
  readonly error?: {
    readonly code?: string
    readonly message?: string
    readonly hint?: string
  }
}

/** Extract the flow-error message from an RPC response, if any. */
export function rpcErrorMessage(response: unknown): string | null {
  const payload = response as RpcErrorPayload | null
  if (payload === null || typeof payload !== 'object') return null
  const error = payload.error
  if (error === undefined || typeof error !== 'object') return null
  return typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : typeof error.code === 'string' ? error.code : null
}
