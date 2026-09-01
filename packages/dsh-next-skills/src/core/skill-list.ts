/**
 * Pure merge/sort helpers for discovered-skill lists.
 */

export function sortInstalled<T extends { name: string }>(skills: readonly T[]): T[] {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Merge several discovered lists; the first list's entry wins a duplicate name.
 * Callers pass lists already ordered by root precedence so the winning copy is
 * the one with the lowest rank.
 */
export function mergeInstalled<T extends { name: string }>(...lists: readonly T[][]): T[] {
  const byName = new Map<string, T>()
  for (const list of lists) {
    for (const skill of list) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill)
    }
  }
  return sortInstalled([...byName.values()])
}
