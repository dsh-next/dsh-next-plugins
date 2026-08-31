/**
 * In-memory FsLike double for host service tests. Seed with a path->content
 * map (absolute paths); directory nodes are materialized lazily on write.
 */
import type { FsDirent, FsLike } from '../../src/core/types.ts'
import { dirnamePath, joinPath } from '../../src/core/path.ts'

function norm(p: string): string {
  let s = p.replace(/\/{2,}/g, '/')
  if (!s.startsWith('/')) s = '/' + s
  if (s.length > 1) s = s.replace(/\/$/, '')
  return s || '/'
}

export interface MemFs extends FsLike {
  snapshot(): Record<string, string>
  has(path: string): boolean
}

export function createMemFs(seed: Record<string, string> = {}): MemFs {
  const nodes = new Map<string, { type: 'file' | 'dir'; content?: string }>()

  function ensureDir(path: string): void {
    const n = norm(path)
    if (n === '/') { if (!nodes.has('/')) nodes.set('/', { type: 'dir' }); return }
    let cur = ''
    for (const part of n.split('/').filter(Boolean)) {
      cur += '/' + part
      if (!nodes.has(cur)) nodes.set(cur, { type: 'dir' })
    }
  }

  for (const [p, c] of Object.entries(seed)) {
    ensureDir(dirnamePath(p))
    nodes.set(norm(p), { type: 'file', content: c })
  }

  const fs: MemFs = {
    readFile: async (p) => {
      const n = nodes.get(norm(p))
      if (!n || n.type !== 'file') throw new Error('ENOENT: ' + p)
      return n.content ?? ''
    },
    writeFile: async (p, content) => {
      ensureDir(dirnamePath(p))
      nodes.set(norm(p), { type: 'file', content })
    },
    mkdir: async (p) => { ensureDir(norm(p)) },
    readdir: async (p) => {
      const base = norm(p)
      const prefix = base === '/' ? '/' : base + '/'
      const result = new Map<string, FsDirent>()
      for (const [path] of nodes) {
        if (path === base || !path.startsWith(prefix)) continue
        const name = path.slice(prefix.length).split('/')[0]
        if (name === '' || result.has(name)) continue
        const child = nodes.get(joinPath(base, name))
        result.set(name, { name, isDirectory: () => child?.type === 'dir' })
      }
      return [...result.values()]
    },
    rm: async (p, opts) => {
      const n = norm(p)
      const prefix = n === '/' ? '/' : n + '/'
      const toDelete = [...nodes.keys()].filter((k) => k === n || k.startsWith(prefix))
      if (toDelete.length === 0 && !opts?.force) throw new Error('ENOENT: ' + p)
      for (const k of toDelete) nodes.delete(k)
    },
    stat: async (p) => {
      const n = nodes.get(norm(p))
      if (!n) throw new Error('ENOENT: ' + p)
      return { isDirectory: () => n.type === 'dir' }
    },
    access: async (p) => {
      if (!nodes.has(norm(p))) throw new Error('ENOENT: ' + p)
    },
    rename: async (from, to) => {
      const src = norm(from)
      const dest = norm(to)
      if (!nodes.has(src)) throw new Error('ENOENT: ' + from)
      ensureDir(dirnamePath(dest))
      const prefix = src === '/' ? '/' : src + '/'
      for (const key of [...nodes.keys()]) {
        const node = nodes.get(key)!
        if (key === src) {
          nodes.delete(key)
          nodes.set(dest, node)
        } else if (key.startsWith(prefix)) {
          nodes.delete(key)
          nodes.set(norm(dest + key.slice(src.length)), node)
        }
      }
    },
    snapshot: () => {
      const out: Record<string, string> = {}
      for (const [path, node] of nodes) if (node.type === 'file') out[path] = node.content ?? ''
      return out
    },
    has: (p) => nodes.has(norm(p)),
  }
  return fs
}
