import { basenamePath } from './path.ts'

/**
 * The `dsh-next-skills` settings section: the shareable configuration the
 * plugin persists under its own namespace in the harness `settings.yaml`
 * (`~/.dsh/settings.yaml`), in the spirit of Claude Code's plugin config.
 *
 * Three sections:
 *  - `providers`: the configured skill sources (GitHub `owner/repo` specs).
 *  - `installed`: one record per skill the plugin installed into the global
 *    root, so the list is readable, copyable between developers, and a fresh
 *    machine can reconcile missing copies from the provider caches.
 *  - `scopes`: per-skill-name enablement, stored as the workspace DIRECTORY
 *    NAMES where the skill is enabled — names, not absolute paths, so the
 *    section is portable between developers whose checkouts live in
 *    different places:
 *
 *        scopes:
 *          find-skills:        # enabled only in a workspace named "web"
 *            - web
 *          opentofu: []        # empty list = off everywhere
 *          # absent (or an empty scopes map) = enabled everywhere
 *
 * Matching compares the basename of the session's workspace path against
 * these names; two registered workspaces sharing a folder name therefore
 * share their enablement (the price of portability).
 *
 * All access flows through pure, defensive normalizers so a hand-edited yaml
 * document can never crash the host, and legacy shapes (full paths, the old
 * `{ kind, workspacePaths }` objects) normalize into the name lists on read.
 */

/**
 * Enablement scope for one skill name: the workspace directory NAMES where
 * it is enabled. `undefined` (no entry) = everywhere; an empty list = off
 * everywhere.
 */
export type SkillScopeSetting = readonly string[]

/** One configured skill provider (GitHub `owner/repo`). */
export interface ProviderRecord {
  id: string
  spec: string
  addedAt: string
}

/** One skill installed by the plugin into the global root. */
export interface InstalledRecord {
  name: string
  providerId: string
  providerSpec: string
  skillPath: string
  version: string
  installedAt: string
}

/** The whole persisted settings section. */
export interface SkillsConfig {
  providers: ProviderRecord[]
  installed: InstalledRecord[]
  scopes: Record<string, SkillScopeSetting>
}

/** The empty configuration (also the shape of a fresh namespace). */
export function emptySkillsConfig(): SkillsConfig {
  return { providers: [], installed: [], scopes: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Normalize one workspace entry to a directory name (accepts full paths). */
function toWorkspaceName(entry: unknown): string | undefined {
  if (typeof entry !== 'string') return undefined
  const trimmed = entry.trim()
  if (trimmed === '') return undefined
  return basenamePath(trimmed)
}

/**
 * Normalize one raw scope value into a workspace-name list; `undefined` when
 * the value means "everywhere" (absent, an explicit global marker, or junk).
 * Legacy shapes — full paths and the old `{ kind, workspacePaths }`
 * objects — normalize into the name lists.
 */
export function parseScopeSetting(raw: unknown): SkillScopeSetting | undefined {
  let entries: readonly unknown[]
  if (Array.isArray(raw)) {
    entries = raw
  } else if (isRecord(raw) && raw.kind === 'workspaces') {
    entries = Array.isArray(raw.workspacePaths) ? raw.workspacePaths : []
  } else {
    return undefined
  }
  const names = [...new Set(entries.map(toWorkspaceName).filter((n): n is string => n !== undefined))]
  return names
}

/** Normalize one raw installed record; undefined when unusable. */
export function parseInstalledRecord(raw: unknown): InstalledRecord | undefined {
  if (!isRecord(raw)) return undefined
  const strings = ['name', 'providerId', 'providerSpec', 'skillPath', 'version', 'installedAt'] as const
  for (const key of strings) {
    if (typeof raw[key] !== 'string' || (raw[key] as string) === '') return undefined
  }
  return {
    name: raw.name as string,
    providerId: raw.providerId as string,
    providerSpec: raw.providerSpec as string,
    skillPath: raw.skillPath as string,
    version: raw.version as string,
    installedAt: raw.installedAt as string,
  }
}

/** Normalize one raw provider record; undefined when unusable. */
export function parseProviderRecord(raw: unknown): ProviderRecord | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.id !== 'string' || raw.id === '') return undefined
  if (typeof raw.spec !== 'string' || raw.spec === '') return undefined
  return { id: raw.id, spec: raw.spec, addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : '' }
}

/** Light path normalization for comparisons: trimmed, no trailing slash. */
export function normalizePathForCompare(path: string): string {
  let out = path.trim()
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/**
 * Whether a skill with `scope` is enabled for the workspace at `cwd`.
 * Absent scope = enabled everywhere; a name list is enabled only when the
 * workspace directory's basename is in the list (an empty list disables
 * everywhere, including without a cwd).
 */
export function isScopeEnabled(scope: SkillScopeSetting | undefined, cwd: string | undefined): boolean {
  if (scope === undefined) return true
  if (cwd === undefined || cwd === '') return false
  // basenamePath ignores trailing slashes and empty segments on its own.
  return scope.includes(basenamePath(cwd))
}

/** Read the stored scope for a skill name (undefined = unset = everywhere). */
export function scopeForName(scopes: SkillsConfig['scopes'], name: string): SkillScopeSetting | undefined {
  return scopes[name]
}

/** Defensive whole-section normalizer: drops junk, keeps known shapes. */
export function normalizeSkillsConfig(raw: unknown): SkillsConfig {
  if (!isRecord(raw)) return emptySkillsConfig()
  const providers = Array.isArray(raw.providers)
    ? raw.providers.map(parseProviderRecord).filter((p): p is ProviderRecord => p !== undefined)
    : []
  // One installed record per name (last wins) and one provider per id.
  const installedByName = new Map<string, InstalledRecord>()
  if (Array.isArray(raw.installed)) {
    for (const rawRecord of raw.installed) {
      const record = parseInstalledRecord(rawRecord)
      if (record !== undefined) installedByName.set(record.name, record)
    }
  }
  const scopes: Record<string, SkillScopeSetting> = {}
  if (isRecord(raw.scopes)) {
    for (const [name, value] of Object.entries(raw.scopes)) {
      if (typeof name !== 'string' || name === '') continue
      const parsed = parseScopeSetting(value)
      // An explicit everywhere (junk or a global marker) carries no
      // information — drop it; absent already means everywhere.
      if (parsed !== undefined) scopes[name] = parsed
    }
  }
  return {
    providers,
    installed: [...installedByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    scopes,
  }
}

/** Canonical JSON-able config for persistence (scopes keep name lists). */
export function configForStorage(config: SkillsConfig): {
  providers: ProviderRecord[]
  installed: InstalledRecord[]
  scopes: Record<string, SkillScopeSetting>
} {
  return {
    providers: [...config.providers].sort((a, b) => a.id.localeCompare(b.id)),
    installed: [...config.installed].sort((a, b) => a.name.localeCompare(b.name)),
    scopes: Object.fromEntries(Object.entries(config.scopes).map(([name, names]) => [name, [...names]])),
  }
}

/** Set, replace, or clear one skill's scope without mutating the input. */
export function withScope(
  scopes: SkillsConfig['scopes'],
  name: string,
  scope: SkillScopeSetting | undefined,
): SkillsConfig['scopes'] {
  const next: SkillsConfig['scopes'] = { ...scopes }
  if (scope === undefined) delete next[name]
  else next[name] = [...scope]
  return next
}
