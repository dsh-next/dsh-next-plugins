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
 *  - `scopes`: per-skill-name enablement — `global` (enabled everywhere, the
 *    default when absent) or a workspace whitelist. Scope is pure config:
 *    enabling and disabling never writes skill files.
 *
 * All access flows through pure, defensive normalizers so a hand-edited yaml
 * document can never crash the host.
 */

/** Enablement scope for one skill name. */
export type SkillScopeSetting =
  | { kind: 'global' }
  | { kind: 'workspaces'; workspacePaths: readonly string[] }

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

/** Normalize one raw scope value; anything else falls back to global. */
export function parseScopeSetting(raw: unknown): SkillScopeSetting {
  if (!isRecord(raw) || raw.kind !== 'workspaces') return { kind: 'global' }
  const paths = Array.isArray(raw.workspacePaths)
    ? [...new Set(raw.workspacePaths.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim()))]
    : []
  return { kind: 'workspaces', workspacePaths: paths }
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

function samePath(a: string, b: string): boolean {
  return normalizePathForCompare(a) === normalizePathForCompare(b)
}

/**
 * Whether a skill with `scope` is enabled for the workspace at `cwd`.
 * Absent scope and `global` are enabled everywhere; a workspace whitelist is
 * enabled only inside one of its paths (an empty list disables everywhere).
 * `undefined` cwd (no workspace in context) only sees global scopes.
 */
export function isScopeEnabled(scope: SkillScopeSetting | undefined, cwd: string | undefined): boolean {
  if (scope === undefined || scope.kind === 'global') return true
  if (cwd === undefined || cwd === '') return false
  return scope.workspacePaths.some((path) => samePath(path, cwd))
}

/** Read the stored scope for a skill name (undefined = unset = global). */
export function scopeForName(scopes: SkillsConfig['scopes'], name: string): SkillScopeSetting | undefined {
  const raw = scopes[name]
  return raw === undefined ? undefined : parseScopeSetting(raw)
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
  const providerIds = new Set(providers.map((p) => p.id))
  const scopes: Record<string, SkillScopeSetting> = {}
  if (isRecord(raw.scopes)) {
    for (const [name, value] of Object.entries(raw.scopes)) {
      if (typeof name !== 'string' || name === '') continue
      const parsed = parseScopeSetting(value)
      // Only persist meaningful entries: a workspaces scope (the whitelist),
      // or an explicit global marker. Junk shapes become global = drop.
      if (parsed.kind === 'workspaces') scopes[name] = parsed
    }
  }
  return {
    providers,
    installed: [...installedByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    scopes,
  }
}

/** Canonical JSON-able config for persistence (scopes keep explicit globals). */
export function configForStorage(config: SkillsConfig): {
  providers: ProviderRecord[]
  installed: InstalledRecord[]
  scopes: Record<string, SkillScopeSetting>
} {
  return {
    providers: [...config.providers].sort((a, b) => a.id.localeCompare(b.id)),
    installed: [...config.installed].sort((a, b) => a.name.localeCompare(b.name)),
    scopes: Object.fromEntries(Object.entries(config.scopes).map(([name, scope]) => [name, parseScopeSetting(scope)])),
  }
}

/** Deduplicate helper used by mutations: merge one scope map over another. */
export function withScope(
  scopes: SkillsConfig['scopes'],
  name: string,
  scope: SkillScopeSetting | undefined,
): SkillsConfig['scopes'] {
  const next: SkillsConfig['scopes'] = { ...scopes }
  if (scope === undefined) delete next[name]
  else next[name] = scope
  return next
}

/** Readable presence label inputs: how many workspaces a whitelist holds. */
export function scopeWorkspaceCount(scope: SkillScopeSetting | undefined): number {
  return scope?.kind === 'workspaces' ? scope.workspacePaths.length : 0
}
