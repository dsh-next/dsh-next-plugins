import { constants } from 'node:fs'
import { lstat, open, readlink, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface WorktreeText {
  readonly kind: 'text' | 'symlink' | 'binary' | 'oversize'
  readonly text: string
}

/** Read one repository path without dereferencing a symlink's target content. */
export async function readWorktreeText(root: string, path: string, limit = 2 * 1024 * 1024): Promise<WorktreeText | null> {
  if (!path || isAbsolute(path) || path.includes('\0') || path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git')) return null
  const base = await realpath(root)
  const full = resolve(base, path)
  const rel = relative(base, full)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null
  try {
    let directory = base
    for (const part of rel.split(sep).slice(0, -1)) {
      directory = join(directory, part)
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) return null
    }
    const info = await lstat(full)
    if (info.isSymbolicLink()) return { kind: 'symlink', text: await readlink(full) }
    if (!info.isFile()) return null
    if (info.size > limit) return { kind: 'oversize', text: '' }
    const fd = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const opened = await fd.stat()
      if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) return null
      const parent = await realpath(dirname(full))
      if (parent !== base && !parent.startsWith(base + sep)) return null
      const current = await lstat(full)
      if (!current.isFile() || current.ino !== opened.ino || current.dev !== opened.dev) return null
      const bytes = Buffer.alloc(limit + 1)
      let length = 0
      while (length < bytes.length) {
        const read = await fd.read(bytes, length, bytes.length - length, length)
        if (read.bytesRead === 0) break
        length += read.bytesRead
      }
      if (length > limit) return { kind: 'oversize', text: '' }
      const end = await fd.stat()
      if (end.size !== opened.size || end.mtimeMs !== opened.mtimeMs) return null
      const content = bytes.subarray(0, length)
      if (content.includes(0)) return { kind: 'binary', text: '' }
      try { return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(content) } }
      catch { return { kind: 'binary', text: '' } }
    } finally { await fd.close() }
  } catch { return null }
}
