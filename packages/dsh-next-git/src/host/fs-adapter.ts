/**
 * The narrow filesystem face the git service consumes.
 *
 * Everything the service needs from disk goes through this port so tests can
 * drive the service without a real filesystem, and so the service stays free
 * of `node:fs` imports at its call sites.
 */

import { mkdir, readFile, rm, stat, unlink, writeFile, copyFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Filesystem operations the service needs. */
export interface FsPorts {
  /** Read a UTF-8 file, or null when it does not exist / is unreadable. */
  readText(path: string): Promise<string | null>
  /** Write a UTF-8 file, creating parent directories. */
  writeText(path: string, contents: string): Promise<void>
  /** Whether a path exists. */
  exists(path: string): Promise<boolean>
  /** Remove a file; missing is not an error. */
  remove(path: string): Promise<void>
  /** Copy one file, creating the destination's parent directory. */
  copy(from: string, to: string): Promise<void>
  /** Whether a path is a directory. */
  isDirectory(path: string): Promise<boolean>
}

/** Production {@link FsPorts} over `node:fs/promises`. */
export function nodeFs(): FsPorts {
  return {
    async readText(path) {
      try {
        return await readFile(path, 'utf8')
      } catch {
        return null
      }
    },
    async writeText(path, contents) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, contents, 'utf8')
    },
    async exists(path) {
      try {
        await stat(path)
        return true
      } catch {
        return false
      }
    },
    async remove(path) {
      try {
        await unlink(path)
      } catch {
        // Missing is the desired end state.
      }
    },
    async copy(from, to) {
      await mkdir(dirname(to), { recursive: true })
      await copyFile(from, to)
    },
    async isDirectory(path) {
      try {
        return (await stat(path)).isDirectory()
      } catch {
        return false
      }
    },
  }
}

/** A {@link FsPorts} over an in-memory map; used by the service's unit tests. */
export function memoryFs(initial: Readonly<Record<string, string>> = {}): FsPorts & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initial))
  const dirs = new Set<string>()
  const self = {
    files,
    async readText(path: string) {
      return files.get(path) ?? null
    },
    async writeText(path: string, contents: string) {
      files.set(path, contents)
    },
    async exists(path: string) {
      if (files.has(path)) return true
      for (const key of files.keys()) if (key.startsWith(`${path}/`)) return true
      return dirs.has(path)
    },
    async remove(path: string) {
      files.delete(path)
    },
    async copy(from: string, to: string) {
      const contents = files.get(from)
      if (contents !== undefined) files.set(to, contents)
    },
    async isDirectory(path: string) {
      if (dirs.has(path)) return true
      for (const key of files.keys()) if (key.startsWith(`${path}/`)) return true
      return false
    },
  }
  return self
}

/** Remove the worktree directory tree (used only for a failed create's rollback). */
export async function removeTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}
