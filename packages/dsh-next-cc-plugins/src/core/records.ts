/**
 * Installed-record migration: the pure logic that reads persisted
 * `installed.json` documents into the current registry shape.
 *
 * The current shape is the either/or scope model: `scope` plus a flat
 * skill list. This module migrates the older shapes on read — the
 * pre-scope multi-target `targets` array and the original single
 * `scope`/`workspacePath`/`skills` trio — so an upgraded install keeps
 * working without a migration step:
 *
 *  - a record holding the global root keeps the global scope; skill copies
 *    recorded under workspace targets stay on disk but become unmanaged
 *    (the global scope covers every workspace anyway — the shared root is
 *    scanned everywhere);
 *  - a record holding only workspace targets becomes a workspace scope
 *    over those paths;
 *  - any recognized install form keeps its record alive even with no
 *    skills (MCP-, agent-, commands-, and hooks-only plugins); records
 *    with no recognized form and no plugin-level components drop out so a
 *    corrupt line cannot wedge the panel.
 */
import type { InstallScope, InstalledFile, InstalledPlugin, InstalledSkillRef } from './types.ts'

/** Read one raw skill-ref list, dropping malformed entries. */
function skillsOf(v: unknown): InstalledSkillRef[] {
  return Array.isArray(v)
    ? v.filter((s): s is InstalledSkillRef =>
      s !== null && typeof s === 'object' && !Array.isArray(s) && typeof (s as Record<string, unknown>).name === 'string' && typeof (s as Record<string, unknown>).directory === 'string')
    : []
}

/**
 * Migrate one raw persisted record to the scope shape. Unknown fields are
 * preserved except the migrated forms.
 */
export function normalizeInstalledRecord(raw: unknown): InstalledPlugin | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const key = typeof r.key === 'string' ? r.key : ''
  const pluginName = typeof r.pluginName === 'string' ? r.pluginName : ''
  if (key === '' || pluginName === '') return undefined
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')

  // Current shape: scope + flat skills. A recognized scope keeps the record
  // even with no skills (component-only plugins install with skills: []).
  if (r.scope !== null && typeof r.scope === 'object' && !Array.isArray(r.scope) && Array.isArray(r.skills)) {
    const s = r.scope as Record<string, unknown>
    if (s.kind === 'workspaces' && Array.isArray(s.workspacePaths)) {
      const workspacePaths = s.workspacePaths.filter((p): p is string => typeof p === 'string' && p !== '')
      if (workspacePaths.length > 0) {
        return finish(r, key, pluginName, str, { kind: 'workspaces', workspacePaths }, skillsOf(r.skills))
      }
    } else if (s.kind === 'global' || s.kind === undefined) {
      return finish(r, key, pluginName, str, { kind: 'global' }, skillsOf(r.skills))
    }
  }

  // Multi-target form: global wins (its scope covers every workspace);
  // otherwise the workspace paths become a workspace scope.
  let globalSkills: InstalledSkillRef[] | undefined
  const workspacePaths: string[] = []
  const workspaceSkills: InstalledSkillRef[] = []
  if (Array.isArray(r.targets)) {
    for (const t of r.targets) {
      if (t === null || typeof t !== 'object' || Array.isArray(t)) continue
      const tt = t as Record<string, unknown>
      if (tt.scope === 'workspace') {
        const path = typeof tt.workspacePath === 'string' && tt.workspacePath !== '' ? tt.workspacePath : undefined
        if (path === undefined) continue
        workspacePaths.push(path)
        workspaceSkills.push(...skillsOf(tt.skills))
      } else {
        globalSkills = [...(globalSkills ?? []), ...skillsOf(tt.skills)]
      }
    }
  }
  // Legacy single-scope trio, only when no targets form was recognized:
  // the global form keeps its skills; the workspace form becomes a
  // workspace scope over its path.
  if (globalSkills === undefined && workspacePaths.length === 0 && (r.scope === 'global' || r.scope === 'workspace') && r.skills !== undefined) {
    if (r.scope === 'global') {
      globalSkills = skillsOf(r.skills)
    } else {
      const path = typeof r.workspacePath === 'string' && r.workspacePath !== '' ? r.workspacePath : undefined
      if (path !== undefined) {
        workspacePaths.push(path)
        workspaceSkills.push(...skillsOf(r.skills))
      }
    }
  }
  if (globalSkills !== undefined) {
    return finish(r, key, pluginName, str, { kind: 'global' }, globalSkills)
  }
  if (workspacePaths.length > 0) {
    return finish(r, key, pluginName, str, { kind: 'workspaces', workspacePaths }, workspaceSkills)
  }
  // No recognized install form: survive only on plugin-level components.
  if ((Array.isArray(r.mcpServers) && r.mcpServers.length > 0) || (Array.isArray(r.agents) && r.agents.length > 0)) {
    return finish(r, key, pluginName, str, { kind: 'global' }, [])
  }
  return undefined
}

/** Assemble the migrated record. */
function finish(
  r: Record<string, unknown>,
  key: string,
  pluginName: string,
  str: (v: unknown) => string,
  scope: InstallScope,
  skills: InstalledSkillRef[],
): InstalledPlugin {
  const pending = (r.pending !== null && typeof r.pending === 'object' && !Array.isArray(r.pending))
    ? r.pending as Record<string, unknown>
    : {}
  return {
    key,
    marketplaceId: str(r.marketplaceId),
    marketplaceSpec: str(r.marketplaceSpec),
    pluginName,
    version: str(r.version),
    ...(typeof r.snapshotDigest === 'string' && r.snapshotDigest !== '' ? { snapshotDigest: r.snapshotDigest } : {}),
    installedAt: str(r.installedAt),
    updatedAt: str(r.updatedAt),
    scope,
    skills,
    mcpServers: Array.isArray(r.mcpServers) ? (r.mcpServers as InstalledPlugin['mcpServers']) : [],
    agents: Array.isArray(r.agents) ? (r.agents as InstalledPlugin['agents']) : [],
    ...(Array.isArray(r.notes) && r.notes.filter((n): n is string => typeof n === 'string').length > 0
      ? { notes: r.notes.filter((n): n is string => typeof n === 'string') }
      : {}),
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
