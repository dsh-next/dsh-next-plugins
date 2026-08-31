/**
 * Pure merge/sort helpers for installed-skill lists.
 */
import type { InstalledSkill } from './types.ts'

export function sortInstalled(skills: readonly InstalledSkill[]): InstalledSkill[] {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Merge several installed lists; the first list's entry wins a duplicate name.
 * Callers pass lists already ordered by root precedence so the winning copy is
 * the one with the lowest rank.
 */
export function mergeInstalled(...lists: readonly InstalledSkill[][]): InstalledSkill[] {
  const byName = new Map<string, InstalledSkill>()
  for (const list of lists) {
    for (const skill of list) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill)
    }
  }
  return sortInstalled([...byName.values()])
}
