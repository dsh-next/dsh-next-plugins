/**
 * Classify a path on disk for snapshot / restore. Regular-file bytes are
 * returned so binary files can still be restored even when they cannot
 * enter DiffBlock.
 */
import { lstat, readFile } from 'node:fs/promises'
import { containsNul, decodeUtf8 } from '../core/hunks.ts'
import { DIFF_MAX_BYTES, type FileKind } from '../core/types.ts'

export interface Inspected {
  readonly kind: FileKind
  readonly bytes: Uint8Array | null
  readonly mtimeMs: number | null
}

export type InspectFn = (absPath: string) => Promise<Inspected>

/** lstat + bounded read. */
export const inspectPath: InspectFn = async (absPath) => {
  let st: Awaited<ReturnType<typeof lstat>>
  try {
    st = await lstat(absPath)
  } catch {
    return { kind: 'missing', bytes: null, mtimeMs: null }
  }
  const mtimeMs = Math.round(st.mtimeMs)
  if (st.isSymbolicLink()) return { kind: 'symlink', bytes: null, mtimeMs }
  if (st.isDirectory()) return { kind: 'directory', bytes: null, mtimeMs }
  if (!st.isFile()) return { kind: 'symlink', bytes: null, mtimeMs }
  if (st.size > DIFF_MAX_BYTES) return { kind: 'too-large', bytes: null, mtimeMs }
  let buf: Buffer
  try {
    buf = await readFile(absPath)
  } catch {
    return { kind: 'missing', bytes: null, mtimeMs }
  }
  const bytes = new Uint8Array(buf)
  if (containsNul(bytes)) return { kind: 'binary', bytes, mtimeMs }
  if (decodeUtf8(bytes) === undefined) return { kind: 'invalid-utf8', bytes, mtimeMs }
  return { kind: 'text', bytes, mtimeMs }
}
