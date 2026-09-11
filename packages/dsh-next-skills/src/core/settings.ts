/** One configured skill provider (GitHub `owner/repo`). */
export interface ProviderRecord {
  id: string
  spec: string
  addedAt: string
}

/** One skill installed by the plugin into the global root (pure provenance). */
export interface InstalledRecord {
  name: string
  providerId: string
  providerSpec: string
  skillPath: string
}

/** Providers and install provenance only. Legacy scopes are ignored: previously
 * disabled/restricted global skills are available through native discovery,
 * subject to their own frontmatter invocation flags. No skill files are migrated. */
export interface SkillsConfig {
  providers: ProviderRecord[]
  installations: InstalledRecord[]
}

/** The empty configuration (also the shape of a fresh namespace). */
export function emptySkillsConfig(): SkillsConfig {
  return { providers: [], installations: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Normalize one raw installed record; undefined when unusable. */
export function parseInstalledRecord(raw: unknown): InstalledRecord | undefined {
  if (!isRecord(raw)) return undefined
  const strings = ['name', 'providerId', 'providerSpec', 'skillPath'] as const
  for (const key of strings) {
    if (typeof raw[key] !== 'string' || (raw[key] as string) === '') return undefined
  }
  return {
    name: raw.name as string,
    providerId: raw.providerId as string,
    providerSpec: raw.providerSpec as string,
    skillPath: raw.skillPath as string,
  }
}

/** Normalize one raw provider record; undefined when unusable. */
export function parseProviderRecord(raw: unknown): ProviderRecord | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.id !== 'string' || raw.id === '') return undefined
  if (typeof raw.spec !== 'string' || raw.spec === '') return undefined
  return { id: raw.id, spec: raw.spec, addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : '' }
}

/** Defensive whole-section normalizer: drops junk, keeps known shapes. */
export function normalizeSkillsConfig(raw: unknown): SkillsConfig {
  if (!isRecord(raw)) return emptySkillsConfig()
  const providers = Array.isArray(raw.providers)
    ? raw.providers.map(parseProviderRecord).filter((p): p is ProviderRecord => p !== undefined)
    : []
  // One installed record per name (last wins).
  // Read the settings section under the `installations` key; the older
  // `installed` key is accepted as a one-time compatibility read.
  const installedByName = new Map<string, InstalledRecord>()
  const rawInstalled = Array.isArray(raw.installations) ? raw.installations : raw.installed
  if (Array.isArray(rawInstalled)) {
    for (const rawRecord of rawInstalled) {
      const record = parseInstalledRecord(rawRecord)
      if (record !== undefined) installedByName.set(record.name, record)
    }
  }
  return {
    providers,
    installations: [...installedByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** Canonical JSON-able configuration; legacy scopes are intentionally omitted. */
export function configForStorage(config: SkillsConfig): SkillsConfig {
  return {
    providers: [...config.providers].sort((a, b) => a.id.localeCompare(b.id)),
    installations: [...config.installations].sort((a, b) => a.name.localeCompare(b.name)),
  }
}
