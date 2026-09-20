import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { link, lstat, mkdir, open, unlink, type FileHandle } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, resolve, sep, win32 } from 'node:path'

const MAX_BYTES = 32 * 1024 * 1024
const skippedCodes = new Set(['ENOENT', 'ENOTDIR', 'ELOOP', 'EEXIST'])
type Directory = { path: string; info: Stats }

function sameInode(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

function sameFile(a: Stats, b: Stats): boolean {
  return b.isFile() && sameInode(a, b) && a.mode === b.mode && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
}

async function directories(path: string): Promise<Directory[] | null> {
  const root = parse(path).root
  const result: Directory[] = []
  let current = root
  for (const part of ['', ...path.slice(root.length).split(sep).filter(Boolean)]) {
    current = join(current, part)
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) return null
    result.push({ path: current, info })
  }
  return result
}

async function unchanged(dirs: Directory[]): Promise<boolean> {
  for (const { path, info } of dirs) {
    const current = await lstat(path)
    if (!current.isDirectory() || !sameInode(info, current)) return false
  }
  return true
}

/**
 * Copy a regular file of at most 32 MiB, preserving permission bits. Returns
 * true only after installation; missing, unsafe, changed, or existing paths
 * return false. Other I/O failures retain their Node error code and path.
 *
 * Roots (including their ancestors) must be real directories, not symlinks.
 * New target subdirectories are created as needed. The temporary file starts
 * private (0600); hard-link installation is atomic and never replaces a leaf.
 *
 * Portable Node has no directory-relative openat/linkat APIs: O_NOFOLLOW only
 * protects leaves. Ancestor inode checks narrow but cannot eliminate directory
 * replacement races between checks and path-based syscalls (including cleanup).
 * Callers must exclude hostile concurrent directory renames/symlink swaps; this
 * is not an external-process security boundary or an atomic source snapshot.
 */
export async function copyWorktreeFile(sourceRoot: string, relativePath: string, targetRoot: string): Promise<boolean> {
  const parts = relativePath.split('/')
  if (!relativePath || isAbsolute(relativePath) || win32.isAbsolute(relativePath)
    || /[\\:\0]/.test(relativePath)
    || parts.some(part => !part || part === '.' || part === '..' || part.replace(/[. ]+$/, '').toLowerCase() === '.git')
    || [sourceRoot, targetRoot].some(root => !root || root.includes('\0') || root.split(/[\\/]/).includes('..'))
    || !constants.O_NOFOLLOW) return false

  const source = resolve(sourceRoot, relativePath)
  const targetBase = resolve(targetRoot)
  const target = join(targetBase, ...parts)
  let sourceHandle: FileHandle | undefined
  let temporaryHandle: FileHandle | undefined
  let temporary: string | undefined
  let temporaryInfo: Stats | undefined
  let targetDirs: Directory[] = []
  try {
    const sourceDirs = await directories(dirname(source))
    const baseDirs = await directories(targetBase)
    if (!sourceDirs || !baseDirs) return false
    targetDirs = baseDirs
    const initial = await lstat(source)
    if (!initial.isFile() || initial.size > MAX_BYTES) return false
    sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    if (!sameFile(initial, await sourceHandle.stat()) || !await unchanged(sourceDirs)) return false

    let parent = targetBase
    for (const part of parts.slice(0, -1)) {
      if (!await unchanged(targetDirs)) return false
      parent = join(parent, part)
      try { await mkdir(parent) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      const info = await lstat(parent)
      if (!info.isDirectory() || info.isSymbolicLink()) return false
      targetDirs.push({ path: parent, info })
    }
    if (!await unchanged(targetDirs)) return false
    try { await lstat(target); return false } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const candidate = join(dirname(target), '.dsh-worktree-copy-' + randomUUID() + '.tmp')
    temporaryHandle = await open(candidate, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    temporary = candidate // Ownership starts only after exclusive creation succeeds.
    temporaryInfo = await temporaryHandle.stat()
    const buffer = Buffer.alloc(Math.min(64 * 1024, initial.size + 1))
    let position = 0
    while (position < initial.size) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, Math.min(buffer.length, initial.size - position), position)
      if (!bytesRead) return false
      let written = 0
      while (written < bytesRead) {
        const { bytesWritten } = await temporaryHandle.write(buffer, written, bytesRead - written, position + written)
        if (!bytesWritten) throw new Error('Worktree copy made no write progress: ' + temporary)
        written += bytesWritten
      }
      position += bytesRead
    }
    if ((await sourceHandle.read(buffer, 0, 1, position)).bytesRead) return false
    await temporaryHandle.chmod(initial.mode & 0o7777)
    if (!await unchanged(sourceDirs) || !await unchanged(targetDirs)
      || !sameFile(initial, await sourceHandle.stat()) || !sameFile(initial, await lstat(source))
      || !sameInode(temporaryInfo, await lstat(temporary))) return false
    await link(temporary, target) // Unlike rename, link cannot overwrite any existing entry.
    return true
  } catch (error) {
    if (skippedCodes.has((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  } finally {
    try {
      if (temporary) {
        try {
          if (!await unchanged(targetDirs)) throw new Error('Worktree copy directory changed; cannot safely clean temporary file: ' + temporary)
          if (!temporaryInfo || sameInode(temporaryInfo, await lstat(temporary))) await unlink(temporary)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    } finally {
      try { await temporaryHandle?.close() } finally { await sourceHandle?.close() }
    }
  }
}
