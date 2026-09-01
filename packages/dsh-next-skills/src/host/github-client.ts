/**
 * GitHub client for provider sync. All network access flows through the
 * injected `fetch` face so tests can double it.
 *
 * Per sync:
 *   GET https://api.github.com/repos/{owner}/{repo}   -> description + stars
 *   GET https://codeload.github.com/{owner}/{repo}/tar.gz/HEAD -> full snapshot
 *
 * The snapshot is a single CDN download (not part of the API budget), so
 * skills sync in seconds instead of one raw request per file. Metadata calls
 * authenticate with `DSH_GITHUB_TOKEN` or `GITHUB_TOKEN` when set, raising
 * the rate limit from 60 req/hr (whole IP, unauthenticated) to 5000/hr.
 */
import type { FetchLike } from '../core/types.ts'

const API_ROOT = 'https://api.github.com'
const CODELOAD_ROOT = 'https://codeload.github.com'
const USER_AGENT = 'dsh-next-skills'
/** Hard ceiling for a snapshot download so a stalled request cannot hang a sync. */
const DOWNLOAD_TIMEOUT_MS = 120_000
const METADATA_TIMEOUT_MS = 30_000

export interface GhRepoInfo {
  owner: string
  repo: string
  /** Repository description (empty when unset). */
  description: string
  /** Star count at sync time. */
  stars: number
}

export interface GhTreeEntry {
  path: string
  type: string
  sha: string
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  }
  // Optional authenticated API budget (5000 req/hr instead of 60 for the
  // whole shared IP). Read per call so a token added to the environment
  // later is picked up on the next sync.
  const token = (process.env.DSH_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? '').trim()
  if (token !== '') headers.authorization = `Bearer ${token}`
  return headers
}

function messageFor(status: number, what: string): string {
  if (status === 404) return `${what}: repository not found (it may be private or misspelled)`
  if (status === 401) return `${what}: GitHub rejected the request (repository private?)`
  if (status === 403 || status === 429) return `${what}: GitHub API rate limit reached`
  return `${what} (HTTP ${status})`
}

/** Fetch repository metadata (description + stars). */
export async function fetchRepoInfo(fetch: FetchLike, owner: string, repo: string): Promise<GhRepoInfo> {
  const res = await fetch(`${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: apiHeaders(),
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(messageFor(res.status, `reading ${owner}/${repo}`))
  const data = await res.json()
  const description = (data && typeof data === 'object' && typeof (data as { description?: unknown }).description === 'string')
    ? (data as { description: string }).description
    : ''
  const stars = (data && typeof data === 'object' && typeof (data as { stargazers_count?: unknown }).stargazers_count === 'number')
    ? (data as { stargazers_count: number }).stargazers_count
    : 0
  return { owner, repo, description, stars }
}

/**
 * Download the repository's default-branch snapshot (tar.gz) in one request.
 * Returns the raw gzip bytes; extraction happens in `host/tarball.ts`.
 */
export async function fetchRepoTarball(fetch: FetchLike, owner: string, repo: string): Promise<Uint8Array> {
  const res = await fetch(`${CODELOAD_ROOT}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/HEAD`, {
    headers: { accept: 'application/x-gtar', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(messageFor(res.status, `downloading the ${owner}/${repo} snapshot`))
  return new Uint8Array(await res.bytes())
}
