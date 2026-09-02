/**
 * Pure catalog helpers: assembling the marketplace view from the persisted
 * provider catalog, client-side filtering, and provider dedupe/limits.
 */
import type * as T from './types.ts'

/** Per-skill file guard: a repo-root SKILL.md would otherwise hoover every
 * loose file in the repository into one bogus skill. Such oversized groups
 * are skipped, not fatal. There is deliberately NO cap on the number of
 * skills a provider may expose — the panel paginates, and a large catalog
 * is the repository's honest content. */
export const MAX_FILES_PER_SKILL = 200

/** Build the marketplace skill view rows from a persisted catalog. */
export function catalogSkillViews(catalog: T.Catalog): T.CatalogSkillView[] {
  const out: T.CatalogSkillView[] = []
  for (const provider of catalog.providers) {
    for (const skill of provider.skills) {
      out.push({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
        providerId: provider.id,
        providerSpec: provider.spec,
        skillPath: skill.skillPath,
        version: skill.version,
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.providerSpec.localeCompare(b.providerSpec))
}

/** Build the provider status rows from a persisted catalog. */
export function providerViews(catalog: T.Catalog): T.ProviderView[] {
  return catalog.providers.map((provider) => ({
    id: provider.id,
    spec: provider.spec,
    skillCount: provider.skills.length,
    lastRefresh: provider.lastRefresh,
    ...(provider.description !== undefined ? { description: provider.description } : {}),
    ...(provider.stars !== undefined ? { stars: provider.stars } : {}),
    ...(provider.error !== undefined ? { error: provider.error } : {}),
  }))
}

/** Case-insensitive substring filter over name, description, and provider spec. */
export function filterCatalogSkills(skills: readonly T.CatalogSkillView[], query: string): T.CatalogSkillView[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...skills]
  return skills.filter((s) =>
    s.name.toLowerCase().includes(q)
    || s.description.toLowerCase().includes(q)
    || s.providerSpec.toLowerCase().includes(q))
}

/** Parse the persisted catalog JSON defensively; a corrupt file yields an empty catalog. */
export function parseCatalog(raw: unknown): T.Catalog {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as T.Catalog).providers)) return { providers: [] }
  const catalog = raw as T.Catalog
  return {
    providers: catalog.providers
      .filter((p) => p && typeof p.id === 'string' && typeof p.spec === 'string' && Array.isArray(p.skills))
      .map((p) => ({
        id: p.id,
        spec: p.spec,
        branch: typeof p.branch === 'string' ? p.branch : '',
        lastRefresh: typeof p.lastRefresh === 'string' ? p.lastRefresh : '',
        ...(p.description !== undefined && typeof p.description === 'string' ? { description: p.description } : {}),
        ...(p.stars !== undefined && typeof p.stars === 'number' ? { stars: p.stars } : {}),
        ...(p.error !== undefined && typeof p.error === 'string' ? { error: p.error } : {}),
        skills: p.skills
          .filter((s) => s && typeof s.name === 'string' && typeof s.cacheDir === 'string' && Array.isArray(s.files))
          .map((s) => ({
            name: s.name,
            description: typeof s.description === 'string' ? s.description : '',
            ...(s.whenToUse !== undefined && typeof s.whenToUse === 'string' ? { whenToUse: s.whenToUse } : {}),
            cacheDir: s.cacheDir,
            skillPath: typeof s.skillPath === 'string' ? s.skillPath : '',
            version: typeof s.version === 'string' ? s.version : '',
            files: s.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha === 'string'),
          })),
      })),
  }
}

/** Parse a provider manifest JSON defensively; unreadable content yields undefined. */
export function parseManifest(raw: unknown): T.ProviderManifest | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const m = raw as Partial<T.ProviderManifest>
  if (typeof m.providerId !== 'string' || typeof m.providerSpec !== 'string' || typeof m.skillPath !== 'string' || typeof m.version !== 'string') {
    return undefined
  }
  return {
    providerId: m.providerId,
    providerSpec: m.providerSpec,
    skillPath: m.skillPath,
    version: m.version,
    installedAt: typeof m.installedAt === 'string' ? m.installedAt : '',
  }
}

/** The most recent successful sync timestamp across the catalog (0 when never). */
export function lastRefreshEpoch(catalog: T.Catalog): number {
  let latest = 0
  for (const provider of catalog.providers) {
    if (provider.error !== undefined) continue
    const t = Date.parse(provider.lastRefresh)
    if (Number.isFinite(t) && t > latest) latest = t
  }
  return latest
}
