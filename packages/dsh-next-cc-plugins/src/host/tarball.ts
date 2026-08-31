/**
 * Minimal tar.gz reader for repository snapshots. GitHub codeload archives
 * are gzip-compressed tar streams in ustar/pax format produced by
 * `git archive`: entries may carry pax extended headers (`x`) or GNU long
 * names (`L`) when paths exceed the classic 100-character limit, and the
 * first path segment is the archive root (`<repo>-<ref>/`).
 *
 * Only regular files are returned (as UTF-8 text); directories, links, and
 * metadata headers are consumed but skipped. Binary assets are therefore not
 * cached — Claude Code plugin payloads this bridge consumes (markdown, JSON,
 * scripts) are text.
 */
import { gunzipSync } from 'node:zlib'

export interface TarFileEntry {
  /** Archive-relative path with the root folder stripped. */
  path: string
  content: string
}

function readString(buf: Buffer, offset: number, length: number): string {
  return buf.toString('utf8', offset, offset + length).replace(/[\0 ]+$/, '')
}

/** Parse `len key=value\n` pax records and return the `path` value if present. */
function paxPath(data: Buffer): string | undefined {
  const text = data.toString('utf8')
  const match = /(?:^|\n)\d+ path=([^\n]+)/.exec(text)
  return match === null ? undefined : match[1]
}

/**
 * Extract regular files from a gzip-compressed tar archive. Throws when the
 * payload is not valid gzip.
 */
export function extractTarEntries(gzip: Uint8Array): TarFileEntry[] {
  const raw = gunzipSync(Buffer.from(gzip))
  const out: TarFileEntry[] = []
  let offset = 0
  let pendingPath: string | undefined
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break // end-of-archive blocks
    let name = readString(header, 0, 100)
    const sizeField = readString(header, 124, 12)
    const size = sizeField === '' ? 0 : Number.parseInt(sizeField, 8) || 0
    const typeFlag = String.fromCharCode(header[156]) || '0'
    const prefix = readString(header, 345, 155)
    offset += 512
    const data = raw.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512

    if (typeFlag === 'x' || typeFlag === 'L') {
      // Extended header: carries the real path of the NEXT entry.
      pendingPath = typeFlag === 'L' ? data.toString('utf8').replace(/\0+$/, '') : (paxPath(data) ?? name)
      continue
    }
    if (typeFlag === 'g') continue // pax global header
    if (typeFlag !== '0' && typeFlag !== '\0' && typeFlag !== '7') continue // dirs, links, devices
    if (pendingPath !== undefined) {
      name = pendingPath
      pendingPath = undefined
    } else if (prefix !== '') {
      name = `${prefix}/${name}`
    }
    // Strip the archive root folder (`<repo>-<ref>/`); skip root-level entries.
    const slash = name.indexOf('/')
    if (slash === -1 || slash === name.length - 1) continue
    out.push({ path: name.slice(slash + 1), content: data.toString('utf8') })
  }
  return out
}
