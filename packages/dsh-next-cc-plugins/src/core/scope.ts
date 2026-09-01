/**
 * Install-scope helpers: the pure logic behind the either/or scope model.
 *
 * A plugin works globally (skills in the shared skills root) or in a set
 * of workspaces (skills in each workspace's `.agents/skills` root) — never
 * a mix. This module validates untrusted scope payloads (the RPC boundary)
 * and derives the per-root facts the host service needs.
 */
import type { InstallScope, InstalledPlugin } from './types.ts'

export type { InstallScope }

export type ScopeParseResult =
  | { scope: InstallScope }
  | { error: string }

/**
 * Validate an untrusted scope payload (the install/re-scope RPC argument).
 * Accepted forms: `{ kind: 'global' }`, or `{ kind: 'workspaces',
 * workspacePaths: [abs, ...] }` with at least one non-empty, deduplicated
 * path. Unknown shapes fall back to global only when the input is absent.
 */
export function parseScope(raw: unknown): ScopeParseResult {
  if (raw === undefined || raw === null) return { scope: { kind: 'global' } }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'scope must be an object' }
  const s = raw as Record<string, unknown>
  if (s.kind === 'workspaces') {
    if (!Array.isArray(s.workspacePaths)) return { error: 'workspace scope requires a workspacePaths array' }
    const seen = new Set<string>()
    const workspacePaths: string[] = []
    for (const p of s.workspacePaths) {
      if (typeof p !== 'string' || p.trim() === '') return { error: 'workspace scope requires non-empty workspace paths' }
      if (seen.has(p)) return { error: 'duplicate workspace path in scope' }
      seen.add(p)
      workspacePaths.push(p)
    }
    if (workspacePaths.length === 0) return { error: 'workspace scope requires at least one workspace' }
    return { scope: { kind: 'workspaces', workspacePaths } }
  }
  // `global`, unknown kinds, and bare objects all mean the default mode.
  return { scope: { kind: 'global' } }
}

/** The skills roots one scope spans, as `<workspacePath>/.agents/skills`
 *  list entries plus the global root marker. Pure: root joining happens
 *  host-side where the agents home is known. */
export function scopeWorkspacePaths(scope: InstallScope): string[] {
  return scope.kind === 'workspaces' ? [...scope.workspacePaths] : []
}

/** Whether two scopes select the same roots. */
export function sameScope(a: InstallScope, b: InstallScope): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'global' && b.kind === 'global') return true
  const ap = [...(a as { workspacePaths: string[] }).workspacePaths].sort()
  const bp = [...(b as { workspacePaths: string[] }).workspacePaths].sort()
  return ap.length === bp.length && ap.every((p, i) => p === bp[i])
}

/** The workspace paths a record's scope covers (empty for global). */
export function recordWorkspacePaths(record: InstalledPlugin): string[] {
  return scopeWorkspacePaths(record.scope)
}
