/**
 * GitHub client for marketplace and plugin snapshot downloads. All network
 * access flows through the injected `fetch` face so tests can double it.
 *
 * A sync is a single CDN download (codeload tar.gz), which is not part of the
 * 60 req/hr unauthenticated API budget, so marketplaces and external plugin
 * sources download in seconds.
 */
import type { FetchLike } from '../core/types.ts'

const CODELOAD_ROOT = 'https://codeload.github.com'
const USER_AGENT = 'dsh-next-cc-plugins'
/** Hard ceiling for a snapshot download so a stalled request cannot hang an install. */
const DOWNLOAD_TIMEOUT_MS = 120_000

function messageFor(status: number, what: string): string {
  if (status === 404) return `${what}: repository not found (it may be private or misspelled)`
  if (status === 401) return `${what}: GitHub rejected the request (repository private?)`
  if (status === 403 || status === 429) return `${what}: GitHub rate limit reached`
  return `${what} (HTTP ${status})`
}

/**
 * Download a repository snapshot (tar.gz) in one request. `ref` defaults to
 * the repository's default branch (HEAD).
 */
export async function fetchRepoTarball(fetch: FetchLike, owner: string, repo: string, ref?: string): Promise<Uint8Array> {
  const rev = ref === undefined || ref === '' ? 'HEAD' : ref
  const res = await fetch(`${CODELOAD_ROOT}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${encodeURIComponent(rev)}`, {
    headers: { accept: 'application/x-gtar', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(messageFor(res.status, `downloading the ${owner}/${repo} snapshot`))
  return new Uint8Array(await res.bytes())
}
