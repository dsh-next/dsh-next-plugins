/**
 * In-memory ConfigScopeFace double for service tests: stands in for the
 * real settings scope. Records written sections and fires watchers so tests
 * can assert config round-trips and invalidation behavior.
 */
import type { ConfigScopeFace } from '../../src/host/skills-service.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Mirror the real provider's merge semantics: objects merge recursively. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(base[key], value)
  return out
}

export class MemConfigFace implements ConfigScopeFace {
  private section: Record<string, unknown> = {}
  readonly watchers: Array<(next: unknown, prev: unknown) => void> = []
  updateCalls = 0
  replaceCalls = 0

  get(): unknown {
    return JSON.parse(JSON.stringify(this.section)) as unknown
  }

  async update(patch: object): Promise<void> {
    this.updateCalls++
    // Deep-merge like the real SettingsProvider: a patch key that is an
    // object merges per sub-key and NEVER deletes absent ones. Services
    // that need to remove a key must replace() the whole section.
    this.section = deepMerge(this.section, patch) as Record<string, unknown>
  }

  async replace(section: object): Promise<void> {
    this.replaceCalls++
    this.section = JSON.parse(JSON.stringify(section)) as Record<string, unknown>
  }

  watch(callback: (next: unknown, prev: unknown) => void): () => void {
    this.watchers.push(callback)
    return () => {
      const idx = this.watchers.indexOf(callback)
      if (idx >= 0) this.watchers.splice(idx, 1)
    }
  }

  /** Simulate an external (hand) edit of the settings.yaml section. */
  setSection(section: Record<string, unknown>): void {
    const prev = this.get()
    this.section = JSON.parse(JSON.stringify(section))
    for (const watcher of this.watchers) watcher(this.get(), prev)
  }

  raw(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.section))
  }
}
