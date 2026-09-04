/**
 * Sidecar registry store: JSON at `<primary>/.dsh/worktrees/registry.json`.
 *
 * Mutations serialize per repository (one promise chain per primary) so
 * concurrent RPCs cannot interleave read-modify-write cycles. Git remains
 * the truth: readers reconcile (see core/registry.ts) and persist the
 * pruned view back only when something dropped.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  EMPTY_REGISTRY,
  type RegistryFile,
  type WorktreeBinding,
} from '../core/registry.ts'

/** Persistence ports (tests substitute an in-memory fake). */
export interface StoreFs {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(dir: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export const nodeFs: StoreFs = {
  readFile: async (path) => readFile(path, 'utf8'),
  writeFile: async (path, data) => {
    await writeFile(path, data, 'utf8')
  },
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true })
  },
  rename: async (from, to) => {
    await rename(from, to)
  },
}

/** Store face the service consumes. */
export interface RegistryStorePorts {
  load(primary: string): Promise<RegistryFile>
  /** Run a mutation under the per-repo lock; receives the current rows. */
  mutate(
    primary: string,
    path: string,
    fn: (rows: readonly WorktreeBinding[]) => readonly WorktreeBinding[] | Promise<readonly WorktreeBinding[]>,
  ): Promise<readonly WorktreeBinding[]>
  /** Persist a wholesale replacement (reconcile drops). */
  replaceAll(primary: string, path: string, rows: readonly WorktreeBinding[]): Promise<void>
}

/** Production store: atomic writes (tmp + rename) over the JSON sidecar. */
export class RegistryStore implements RegistryStorePorts {
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(private readonly fs: StoreFs = nodeFs) {}

  private registryPath(primary: string): string {
    return `${primary}/.dsh/worktrees/registry.json`
  }

  private serialize(file: RegistryFile): string {
    return `${JSON.stringify(file, null, 2)}\n`
  }

  async load(primary: string): Promise<RegistryFile> {
    try {
      const raw = await this.fs.readFile(this.registryPath(primary))
      const parsed = JSON.parse(raw) as Partial<RegistryFile>
      if (parsed.version !== 1 || !Array.isArray(parsed.bindings)) {
        return EMPTY_REGISTRY
      }
      // Tolerate foreign or legacy rows: every field the projection reads
      // gets a type-checked default, so a malformed entry degrades to a
      // slug-titled row instead of poisoning the render.
      const bindings = parsed.bindings
        .filter((b): b is WorktreeBinding => b !== null && typeof b === 'object')
        .map((b) => ({
          ...b,
          sessionId: typeof b.sessionId === 'string' ? b.sessionId : '',
          slug: typeof b.slug === 'string' ? b.slug : '',
          name: typeof b.name === 'string' ? b.name : '',
          path: typeof b.path === 'string' ? b.path : '',
          branch: typeof b.branch === 'string' ? b.branch : '',
          baseRef: typeof b.baseRef === 'string' ? b.baseRef : 'HEAD',
          relPath: typeof b.relPath === 'string' ? b.relPath : '',
          role: 'owner' as const,
          createdAt: typeof b.createdAt === 'number' ? b.createdAt : 0,
        }))
      return { version: 1, bindings }
    } catch {
      return EMPTY_REGISTRY
    }
  }

  private async write(primary: string, rows: readonly WorktreeBinding[]): Promise<void> {
    const path = this.registryPath(primary)
    const tmp = `${path}.tmp`
    await this.fs.mkdir(dirname(path))
    await this.fs.writeFile(tmp, this.serialize({ version: 1, bindings: rows }))
    await this.fs.rename(tmp, path)
  }

  private enqueue<T>(primary: string, task: () => Promise<T>): Promise<T> {
    const prior = this.chains.get(primary) ?? Promise.resolve()
    const next = prior.then(task, task)
    this.chains.set(primary, next.catch(() => undefined))
    return next
  }

  async mutate(
    primary: string,
    _path: string,
    fn: (rows: readonly WorktreeBinding[]) => readonly WorktreeBinding[] | Promise<readonly WorktreeBinding[]>,
  ): Promise<readonly WorktreeBinding[]> {
    return this.enqueue(primary, async () => {
      const current = await this.load(primary)
      const rows = await fn(current.bindings)
      await this.write(primary, rows)
      return rows
    })
  }

  async replaceAll(
    primary: string,
    _path: string,
    rows: readonly WorktreeBinding[],
  ): Promise<void> {
    await this.enqueue(primary, async () => {
      await this.write(primary, rows)
    })
  }
}
