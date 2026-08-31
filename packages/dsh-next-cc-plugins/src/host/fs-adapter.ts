/**
 * Node filesystem adapter over the pure {@link FsLike} contract. The host half
 * runs in the DSH Node process and manages the marketplace cache, the skills
 * roots, and the managed block inside `$DSH_HOME/cordis.patch.yml`.
 */
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { FsDirent, FsLike } from '../core/types.ts'

export function nodeFs(): FsLike {
  return {
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, content) => writeFile(path, content, 'utf8'),
    mkdir: async (path, opts) => { await mkdir(path, opts) },
    readdir: async (path) => {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map((e): FsDirent => ({ name: e.name, isDirectory: () => e.isDirectory() }))
    },
    rm: (path, opts) => rm(path, opts),
    stat: async (path) => {
      const s = await stat(path)
      return { isDirectory: () => s.isDirectory() }
    },
    access: (path) => access(path),
    rename: (from, to) => rename(from, to),
  }
}
