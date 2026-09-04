/**
 * Chip status derivation — pure parsing of git outputs.
 *
 * The session-header chip shows title/branch, an ahead count, and one status
 * dot: clean, dirty, foregrounded, or error. Foreground (M2) parks the
 * worktree on a detached HEAD; M1 reports the other three states.
 */

/** Chip dot states (M1 subset of the plan's lifecycle). */
export type ChipStatus = 'clean' | 'dirty' | 'error'

/** Parse `git rev-list --count <base>..HEAD` output; null when unusable. */
export function parseAheadCount(stdout: string): number | null {
  const trimmed = stdout.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Parse `git status --porcelain` output into a dirty flag. */
export function parseDirty(porcelain: string): boolean {
  return porcelain.trim().length > 0
}

/**
 * Derive the chip status dot. An unparseable status (git failure) is the
 * error state, never a silent clean.
 */
export function deriveChipStatus(facts: {
  dirty: boolean
  aheadOk: boolean
}): ChipStatus {
  if (!facts.aheadOk) return 'error'
  return facts.dirty ? 'dirty' : 'clean'
}
