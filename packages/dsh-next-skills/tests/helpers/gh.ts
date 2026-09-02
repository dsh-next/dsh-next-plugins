/**
 * In-memory GitHub fetch double: serves repo metadata (description + stars)
 * and a real gzip-compressed tar snapshot built from a plain file map — the
 * same wire shape the plugin consumes (repo API + codeload tar.gz).
 * Records every request URL so tests can assert call counts.
 */
import { gzipSync } from 'node:zlib'
import type { FetchLike, FetchResponse } from '../../src/core/types.ts'

export interface GhDoubleOptions {
  /** Repository description served by the repo endpoint (default provided). */
  repoDescription?: string
  /** Star count served by the repo endpoint (default provided). */
  repoStars?: number
  /** Status for the repo metadata endpoint (simulates API failures). */
  repoStatus?: number
  /** Status for the snapshot endpoint (simulates download failures). */
  tarballStatus?: number
  /** Repository files (path -> content) packaged into the tar.gz snapshot. */
  files?: Record<string, string>
}

export interface GhDouble {
  fetch: FetchLike
  calls: { url: string; headers?: Record<string, string> }[]
  apiCalls: () => number
  snapshotCalls: () => number
  setFiles: (files: Record<string, string>) => void
  setRepoStatus: (status: number) => void
  setTarballStatus: (status: number) => void
}

function respond(data: unknown, status = 200): FetchResponse {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(JSON.stringify(data), 'utf8')
  const payload = new Uint8Array(bytes)
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(payload.length === 0 ? '{}' : Buffer.from(payload).toString('utf8')),
    bytes: async () => payload,
  }
}

function serveBytes(bytes: Uint8Array, status = 200): FetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}), bytes: async () => bytes }
}

/** Build a ustar archive (512-byte headers, no long-path entries needed). */
function buildTar(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = []
  for (const [name, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const data = Buffer.from(content, 'utf8')
    const header = Buffer.alloc(512)
    header.write(`${name}`, 0, Math.min(name.length, 100), 'utf8')
    header.write('0000644\0', 100, 8, 'utf8') // mode
    header.write('0000000\0', 108, 8, 'utf8') // uid
    header.write('0000000\0', 116, 8, 'utf8') // gid
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8') // size (octal)
    header.write('00000000000\0', 136, 12, 'utf8') // mtime
    header.write('        ', 148, 8, 'utf8') // checksum placeholder (spaces)
    header.write('0', 156, 1, 'utf8') // type: regular file
    header.write('ustar\0', 257, 6, 'utf8')
    header.write('00', 263, 2, 'utf8')
    let sum = 0
    for (const byte of header) sum += byte
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8')
    chunks.push(header, data)
    const padding = (512 - (data.length % 512)) % 512
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(1024)) // end-of-archive blocks
  return Buffer.concat(chunks)
}

export function createGhDouble(opts: GhDoubleOptions = {}): GhDouble {
  let files = opts.files ?? {}
  let repoStatus = opts.repoStatus
  let tarballStatus = opts.tarballStatus
  const calls: { url: string; headers?: Record<string, string> }[] = []

  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers })
    if (url.startsWith('https://api.github.com/repos/o/r')) {
      if (repoStatus !== undefined) return respond({}, repoStatus)
      return respond({
        description: opts.repoDescription ?? 'Test repository for skills sync',
        stargazers_count: opts.repoStars ?? 42,
      })
    }
    if (url.startsWith('https://codeload.github.com/o/r/')) {
      if (tarballStatus !== undefined) return serveBytes(new Uint8Array(), tarballStatus)
      // Real GitHub archives nest every entry under a `<repo>-<ref>/` root.
      const rooted = Object.fromEntries(Object.entries(files).map(([k, v]) => [`o-r-head/${k}`, v]))
      return serveBytes(new Uint8Array(gzipSync(buildTar(rooted))))
    }
    return respond({}, 404)
  }

  return {
    fetch,
    calls,
    apiCalls: () => calls.filter((c) => c.url.startsWith('https://api.github.com/')).length,
    snapshotCalls: () => calls.filter((c) => c.url.startsWith('https://codeload.github.com/')).length,
    setFiles: (next) => { files = next },
    setRepoStatus: (status) => { repoStatus = status },
    setTarballStatus: (status) => { tarballStatus = status },
  }
}
