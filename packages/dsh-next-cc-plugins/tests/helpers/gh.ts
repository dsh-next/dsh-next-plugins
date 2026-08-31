/**
 * In-memory GitHub fetch double: serves codeload tar.gz snapshots built from
 * plain file maps — the same wire shape the plugin consumes. Multiple
 * repositories can be served at once (marketplaces and external plugin
 * sources both download from codeload).
 */
import { gzipSync } from 'node:zlib'
import type { FetchLike, FetchResponse } from '../../src/core/types.ts'

export interface GhDouble {
  fetch: FetchLike
  calls: string[]
  setRepo: (owner: string, repo: string, files: Record<string, string>) => void
  failRepo: (owner: string, repo: string, status: number) => void
}

function respond(data: unknown, status = 200): FetchResponse {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(JSON.stringify(data), 'utf8')
  const payload = new Uint8Array(bytes)
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(payload.length === 0 ? '{}' : Buffer.from(payload).toString('utf8')),
    text: async () => Buffer.from(payload).toString('utf8'),
    bytes: async () => payload,
  }
}

function serveBytes(bytes: Uint8Array, status = 200): FetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => '', bytes: async () => bytes }
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

export function createGhDouble(repos: Record<string, Record<string, string>> = {}): GhDouble {
  const files = new Map(Object.entries(repos).map(([k, v]) => [k, { ...v }]))
  const failures = new Map<string, number>()
  const calls: string[] = []

  const fetch: FetchLike = async (url) => {
    calls.push(url)
    const match = /^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/tar\.gz\/(.+)$/.exec(url)
    if (match === null) return respond({}, 404)
    const key = `${match[1]}/${match[2]}`
    const status = failures.get(key)
    if (status !== undefined) return serveBytes(new Uint8Array(), status)
    const repoFiles = files.get(key)
    if (repoFiles === undefined) return respond({}, 404)
    // Real GitHub archives nest every entry under a `<repo>-<ref>/` root.
    const rooted = Object.fromEntries(Object.entries(repoFiles).map(([k, v]) => [`${match[2]}-${match[3]}/${k}`, v]))
    return serveBytes(new Uint8Array(gzipSync(buildTar(rooted))))
  }

  return {
    fetch,
    calls,
    setRepo: (owner, repo, next) => { files.set(`${owner}/${repo}`, { ...next }) },
    failRepo: (owner, repo, status) => { failures.set(`${owner}/${repo}`, status) },
  }
}
