/**
 * Per-repository sidecar registry store.
 *
 * The registry file lives at `<primary>/.dsh/worktrees/registry.json` —
 * repo-local, covered by the same `.dsh/` gitignore hint as the worktrees.
 * Writes are atomic (tmp file + rename) and mutations are serialized per
 * primary (a simple promise chain) so concurrent RPCs cannot interleave
 * read-modify-write cycles. Git remains the truth: readers reconcile
 * against `git worktree list` (see the service).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  parseRegistry,
  serializeRegistry,
  type WorktreeBinding,
} from '../core/registry.ts'

/** Injectable fs surface (tests substitute a fake). */
export interface RegistryFs {
  readFile(path: string): Promise<string>
  writeFile(path: string, body: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(path: string): Promise<void>
}

/** Production fs over node:fs/promises. */
export const nodeFs: RegistryFs = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, body) => writeFile(path, body, 'utf8').then(() => {}),
  rename: (from, to) => rename(from, to).then(() => {}),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => {}),
}

/**
 * The store. One instance per host; state is the file plus a per-primary
 * mutation chain.
 */
export class RegistryStore {
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(
    private readonly fs: RegistryFs = nodeFs,
  ) {}

  /** Serialize mutations per primary (registry-level write lock). */
  private enqueue<T>(primaryRoot: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(primaryRoot) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.chains.set(primaryRoot, next.catch(() => {}))
    return next
  }

  /** Read bindings; a missing or corrupt file is an empty registry. */
  async load(primaryRoot: string, path: string): Promise<readonly WorktreeBinding[]> {
    let raw: string
    try {
      raw = await this.fs.readFile(path)
    } catch {
      return []
    }
    return parseRegistry(raw)?.bindings ?? []
  }

  /** Atomically replace the registry body after a mutation. */
  private async persist(primaryRoot: string, path: string, bindings: readonly WorktreeBinding[]): Promise<void> {
    await this.fs.mkdir(dirname(path))
    const tmp = `${path}.tmp`
    await this.fs.writeFile(tmp, serializeRegistry({ version: 1, bindings }))
    await this.fs.rename(tmp, path)
  }

  /** Insert or replace a binding (keyed by slug). */
  async upsert(primaryRoot: string, path: string, binding: WorktreeBinding): Promise<void> {
    return this.enqueue(primaryRoot, async () => {
      const current = await this.load(primaryRoot, path)
      const next = [
        ...current.filter((b) => b.slug !== binding.slug && b.path !== binding.path),
        binding,
      ]
      await this.persist(primaryRoot, path, next)
    })
  }

  /** Attach a session id to a binding (owner bind). */
  async bindSession(
    primaryRoot: string,
    path: string,
    slug: string,
    sessionId: string,
  ): Promise<WorktreeBinding | null> {
    return this.enqueue(primaryRoot, async () => {
      const current = await this.load(primaryRoot, path)
      let updated: WorktreeBinding | null = null
      const next = current.map((b) => {
        if (b.slug !== slug) return b
        updated = { ...b, sessionId }
        return updated
      })
      if (updated === null) return null
      await this.persist(primaryRoot, path, next)
      return updated
    })
  }

  /** Drop a binding by slug. */
  async remove(primaryRoot: string, path: string, slug: string): Promise<void> {
    return this.enqueue(primaryRoot, async () => {
      const current = await this.load(primaryRoot, path)
      await this.persist(primaryRoot, path, current.filter((b) => b.slug !== slug))
    })
  }

  /** Rewrite the file with a reconciled set (stale bindings dropped). */
  async replaceAll(
    primaryRoot: string,
    path: string,
    bindings: readonly WorktreeBinding[],
  ): Promise<void> {
    return this.enqueue(primaryRoot, async () => {
      await this.persist(primaryRoot, path, bindings)
    })
  }
}
