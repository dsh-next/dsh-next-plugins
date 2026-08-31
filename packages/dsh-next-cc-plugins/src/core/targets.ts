/**
 * Install-target helpers: the pure logic behind multi-target installs.
 *
 * A target is a skills root — the global `~/.agents/skills` (scope
 * `global`) or one workspace's `<workspace>/.agents/skills` (scope
 * `workspace`). A plugin may hold skills in any number of targets at
 * once; its MCP rows, agent rows, commands, and hooks are plugin-level
 * and activate once regardless.
 *
 * This module also migrates the pre-targets registry shape (a single
 * top-level `scope`/`workspacePath`/`skills` triple per record) into the
 * targets array on read, and validates the RPC install arguments.
 */
import type { InstalledFile, InstalledPlugin, InstalledTarget } from './types.ts'

/** Stable identity of a target: '' for global, the workspace path otherwise. */
export function targetId(target: { scope: 'global' | 'workspace'; workspacePath?: string }): string {
  return target.scope === 'workspace' ? (target.workspacePath ?? '') : ''
}

/** Human label for a target id: "Global" or the workspace title when known. */
export function targetLabel(id: string, workspaces: ReadonlyArray<{ path: string; title: string }>): string {
  if (id === '') return 'Global'
  return workspaces.find((w) => w.path === id)?.title ?? id
}

export type TargetRequest = { scope: 'global' | 'workspace'; workspacePath?: string }

export type TargetsParseResult =
  | { targets: TargetRequest[] }
  | { error: string }

/**
 * Validate an install request's target list: at least one target, every
 * workspace target carries a non-empty absolute-ish path, no duplicates.
 */
export function parseTargets(raw: unknown): TargetsParseResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'at least one install target is required (global or workspace)' }
  }
  const seen = new Set<string>()
  const targets: TargetRequest[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: 'install targets must be objects' }
    }
    const e = entry as Record<string, unknown>
    const scope = e.scope === 'workspace' ? 'workspace' : 'global'
    const workspacePath = typeof e.workspacePath === 'string' ? e.workspacePath : ''
    if (scope === 'workspace' && workspacePath === '') {
      return { error: 'workspace targets require a workspacePath' }
    }
    const id = scope === 'workspace' ? workspacePath : ''
    if (seen.has(id)) return { error: 'duplicate install target' }
    seen.add(id)
    targets.push(scope === 'workspace' ? { scope, workspacePath } : { scope })
  }
  return { targets }
}

/**
 * Migrate one raw persisted record to the targets shape. Records written
 * before multi-target support carry `scope`/`workspacePath`/`skills` at the
 * top level; they wrap into a single target. Records without any skills
 * target (and none of the plugin-level components either) are dropped so a
 * corrupt line cannot wedge the panel. Unknown fields are preserved except
 * the migrated trio.
 */
export function normalizeInstalledRecord(raw: unknown): InstalledPlugin | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const key = typeof r.key === 'string' ? r.key : ''
  const pluginName = typeof r.pluginName === 'string' ? r.pluginName : ''
  if (key === '' || pluginName === '') return undefined
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const skillsOf = (v: unknown): InstalledTarget['skills'] =>
    Array.isArray(v)
      ? v.filter((s): s is InstalledTarget['skills'][number] =>
        s !== null && typeof s === 'object' && !Array.isArray(s) && typeof (s as Record<string, unknown>).name === 'string' && typeof (s as Record<string, unknown>).directory === 'string')
      : []
  let targets: InstalledTarget[] = Array.isArray(r.targets)
    ? r.targets
      .map((t): InstalledTarget | undefined => {
        if (t === null || typeof t !== 'object' || Array.isArray(t)) return undefined
        const tt = t as Record<string, unknown>
        const scope = tt.scope === 'workspace' ? 'workspace' : 'global'
        const workspacePath = typeof tt.workspacePath === 'string' && tt.workspacePath !== '' ? tt.workspacePath : undefined
        if (scope === 'workspace' && workspacePath === undefined) return undefined
        return { scope, ...(workspacePath !== undefined ? { workspacePath } : {}), skills: skillsOf(tt.skills) }
      })
      .filter((t): t is InstalledTarget => t !== undefined)
    : []
  // Legacy single-scope record: wrap its trio into one target.
  if (targets.length === 0 && (r.scope === 'global' || r.scope === 'workspace') && r.skills !== undefined) {
    const workspacePath = typeof r.workspacePath === 'string' && r.workspacePath !== '' ? r.workspacePath : undefined
    targets = [{ scope: r.scope, ...(workspacePath !== undefined ? { workspacePath } : {}), skills: skillsOf(r.skills) }]
  }
  const hasComponents = targets.some((t) => t.skills.length > 0)
    || (Array.isArray(r.mcpServers) && r.mcpServers.length > 0)
    || (Array.isArray(r.agents) && r.agents.length > 0)
  if (targets.length === 0 && !hasComponents) return undefined
  const pending = (r.pending !== null && typeof r.pending === 'object' && !Array.isArray(r.pending))
    ? r.pending as Record<string, unknown>
    : {}
  return {
    key,
    marketplaceId: str(r.marketplaceId),
    marketplaceSpec: str(r.marketplaceSpec),
    pluginName,
    version: str(r.version),
    installedAt: str(r.installedAt),
    updatedAt: str(r.updatedAt),
    targets,
    mcpServers: Array.isArray(r.mcpServers) ? (r.mcpServers as InstalledPlugin['mcpServers']) : [],
    agents: Array.isArray(r.agents) ? (r.agents as InstalledPlugin['agents']) : [],
    pending: {
      commands: Array.isArray(pending.commands) ? pending.commands.filter((c): c is string => typeof c === 'string') : [],
      hookEvents: Array.isArray(pending.hookEvents) ? pending.hookEvents.filter((c): c is string => typeof c === 'string') : [],
    },
  }
}

/** Migrate a whole installed.json document on read. */
export function normalizeInstalledFile(raw: unknown): InstalledFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray((raw as Record<string, unknown>).plugins)) {
    return { plugins: [] }
  }
  const plugins = ((raw as Record<string, unknown>).plugins as unknown[])
    .map(normalizeInstalledRecord)
    .filter((p): p is InstalledPlugin => p !== undefined)
  return { plugins }
}
