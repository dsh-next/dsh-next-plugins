/**
 * The panel's RPC client.
 *
 * One `POST /dsh-next-git/rpc` per method, same-origin. Every business failure
 * arrives as a structured envelope (`{ ok: false, failure, degraded }`) and is
 * rethrown as a {@link GitApiError} carrying the named state, so the panel can
 * render "another git process is running" instead of "request failed".
 */

import type { DegradedState, GitFailure, GitFailureCode } from '../core/types.ts'

/** Route the host serves. */
export const RPC_PATH = '/dsh-next-git/rpc'

/** A business failure, with its named state and (when terminal) degraded info. */
export class GitApiError extends Error {
  constructor(
    readonly failure: GitFailure,
    readonly degraded: DegradedState | null,
  ) {
    super(failure.detail === '' ? failure.code : failure.detail)
    this.name = 'GitApiError'
  }

  /** The named failure code. */
  get code(): GitFailureCode {
    return this.failure.code
  }
}

/** Success envelope. */
interface OkEnvelope<T> {
  readonly ok: true
  readonly value: T
}

/** Failure envelope. */
interface FailEnvelope {
  readonly ok: false
  readonly failure: GitFailure
  readonly degraded: DegradedState | null
}

/** Minimal fetch signature, so tests can inject a stub. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal | undefined },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** The panel's whole host surface. */
export interface GitApi {
  /** Call one method and unwrap its value. */
  call<T>(method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T>
}

/**
 * Build the API over a fetch implementation.
 *
 * @param path - the RPC route.
 * @param fetchImpl - `fetch` in the browser, a stub in tests.
 * @returns the callable API.
 */
export function createApi(path: string = RPC_PATH, fetchImpl?: FetchLike): GitApi {
  const doFetch: FetchLike =
    fetchImpl ??
    ((input, init) =>
      fetch(input, init) as unknown as ReturnType<FetchLike>)

  return {
    async call<T>(method: string, args: Record<string, unknown>, signal?: AbortSignal) {
      const response = await doFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }),
        ...(signal === undefined ? {} : { signal }),
      })
      if (!response.ok) {
        throw new GitApiError(
          { code: 'git-failed', detail: `HTTP ${response.status}` },
          null,
        )
      }
      const body = (await response.json()) as OkEnvelope<T> | FailEnvelope | null
      if (body === null || typeof body !== 'object') {
        throw new GitApiError({ code: 'git-failed', detail: 'empty RPC response' }, null)
      }
      if (body.ok === true) return body.value
      if (body.ok === false) throw new GitApiError(body.failure, body.degraded ?? null)
      throw new GitApiError({ code: 'git-failed', detail: 'malformed RPC envelope' }, null)
    },
  }
}

/** Narrow an unknown throw to a {@link GitApiError}. */
export function asApiError(error: unknown): GitApiError {
  if (error instanceof GitApiError) return error
  return new GitApiError(
    { code: 'git-failed', detail: error instanceof Error ? error.message : String(error) },
    null,
  )
}
