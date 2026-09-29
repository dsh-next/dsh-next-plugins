import type { CatalogSkillView, InstalledSkill, SkillsState } from '../../core/types.ts'

/** One card in the skills grid: one discovered copy, or a catalog skill (Install). */
export interface GridEntry {
  key: string
  name: string
  description: string
  whenToUse?: string
  /** The catalog skill backing this entry (install flow), when offered. */
  catalog?: CatalogSkillView
  /** The discovered copy this card manages (undefined for offering cards). */
  row?: InstalledSkill
  /** Catalog provider id (the provider filter compares ids). */
  providerId?: string
  /** Provider spec label (`owner/repo`), when provider-installed. */
  providerSpec?: string
}

/**
 * One card per discovered copy (a skill present in several roots produces a
 * card per root), plus an Install card per catalog skill whose name has NO
 * installed copy. A name that is installed renders only its copy cards: the
 * provider offerings collapse into that copy's source switcher (the
 * Providers button), so one skill + one source costs exactly one card.
 * Externally-owned copies get no switcher either —
 * their source is the owning plugin's business.
 */
export function buildGridEntries(state: SkillsState): GridEntry[] {
  const specToId = new Map(state.providers.map((p) => [p.spec, p.id]))
  const installedNames = new Set<string>()
  for (const row of state.installed) installedNames.add(row.name)
  const rows: GridEntry[] = state.installed.map((row) => ({
    key: `row:${row.source}:${row.path}`,
    name: row.name,
    description: row.description,
    ...(row.whenToUse !== undefined ? { whenToUse: row.whenToUse } : {}),
    row,
    ...(row.provider !== undefined && specToId.get(row.provider) !== undefined
      ? { providerId: specToId.get(row.provider) }
      : {}),
    ...(row.provider !== undefined ? { providerSpec: row.provider } : {}),
  }))
  const offerings: GridEntry[] = state.catalog
    .filter((s) => !installedNames.has(s.name))
    .map((s) => ({
      key: `cat:${s.providerId}/${s.skillPath}`,
      name: s.name,
      description: s.description,
      ...(s.whenToUse !== undefined ? { whenToUse: s.whenToUse } : {}),
      catalog: s,
      providerId: s.providerId,
      providerSpec: s.providerSpec,
    }))
  return [...rows, ...offerings].sort((a, b) =>
    // Installed names first, then names to add; within a class, by name and
    // provider spec.
    ((installedNames.has(b.name) ? 1 : 0) - (installedNames.has(a.name) ? 1 : 0))
    || a.name.localeCompare(b.name)
    || (a.providerSpec ?? '').localeCompare(b.providerSpec ?? ''))
}

/**
 * Relevance tier of an entry for a search query: 0 exact name match, 1 name
 * prefix, 2 name contains, 3 description/provider-spec contains, and
 * undefined when the entry does not match at all. Lower ranks first, so a
 * name match surfaces above an incidental description match instead of the
 * alphabetical order deciding what the user sees.
 */
export function searchTier(entry: GridEntry, q: string): number | undefined {
  if (q === '') return 0
  const name = entry.name.toLowerCase()
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (name.includes(q)) return 2
  const rest = `${entry.description} ${entry.providerSpec ?? ''}`.toLowerCase()
  return rest.includes(q) ? 3 : undefined
}

/** Case-insensitive search (relevance-ranked) + provider filter +
 *  installed-only filter. With an empty query every entry matches and the
 *  grid order is preserved. */
export function filterEntries(
  entries: readonly GridEntry[],
  search: string,
  providerFilter: string,
  installedOnly: boolean,
): GridEntry[] {
  const q = search.trim().toLowerCase()
  const hits = entries.filter((entry) => {
    if (installedOnly && entry.row === undefined) return false
    if (providerFilter !== '' && entry.providerId !== providerFilter) return false
    return searchTier(entry, q) !== undefined
  })
  // Stable tier sort: within one tier the grid's own order (installed names
  // first, then name/provider) is preserved.
  return hits.sort((a, b) => (searchTier(a, q) ?? 0) - (searchTier(b, q) ?? 0))
}
