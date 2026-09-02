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

/** Build the marketplace skill view rows from a persisted catalog.
 *
 * A provider may store one skill in several directories — a canonical
 * `skills/<name>` plus translation copies under `docs/<locale>/skills/<name>`
 * and vendor copies under `.kiro`/`.agents`/`.cursor/skills`. Each becomes its
 * own catalog row, which would flood the marketplace with duplicate Add cards
 * for the same skill name. The view therefore collapses rows to one per
 * `(provider, name)`, preferring the canonical `skills/<name>` copy when one
 * exists and otherwise the first (path-sorted) copy. Cross-provider same-name
 * rows stay separate: each provider is an independent source.
 */
export function catalogSkillViews(catalog: T.Catalog): T.CatalogSkillView[] {
  const out: T.CatalogSkillView[] = []
  for (const provider of catalog.providers) {
    // One representative skill per name within this provider: a canonical
    // `skills/<name>` copy wins when present; otherwise the lexicographically
    // first path. Deterministic regardless of catalog array order.
    const byName = new Map<string, T.CatalogSkill>()
    for (const skill of provider.skills) {
      const current = byName.get(skill.name)
      if (current === undefined || compareCatalogCopies(skill, current) < 0) {
        byName.set(skill.name, skill)
      }
    }
    for (const skill of byName.values()) {
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
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.providerSpec.localeCompare(b.providerSpec) || a.skillPath.localeCompare(b.skillPath))
}

/** Ordering for two copies of one skill name: canonical first, then path.
 *  Returns <0 when `a` is the better representative. */
function compareCatalogCopies(a: T.CatalogSkill, b: T.CatalogSkill): number {
  const ac = isCanonicalPath(a) ? 1 : 0
  const bc = isCanonicalPath(b) ? 1 : 0
  if (ac !== bc) return bc - ac
  return a.skillPath.localeCompare(b.skillPath)
}

/** Whether a skill is the canonical `skills/<name>` copy of its provider repo. */
function isCanonicalPath(skill: T.CatalogSkill): boolean {
  return skill.skillPath === `skills/${skill.name}`
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
