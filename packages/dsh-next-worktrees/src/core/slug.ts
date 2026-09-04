/**
 * Pure slug and name generation.
 *
 * Locked rules: the slug is generated (`[a-z]+-\d{2}`) and is the only
 * thing that ever reaches a branch name; the user-typed Name is a display
 * title only — user text never becomes a ref (PII the moment someone
 * pushes). Branches read `dsh-worktrees/<slug>`.
 */

/** Slug words: short, lowercase, branch-safe, collision-resistant by pair. */
const SLUG_WORDS = [
  'swift', 'amber', 'cobalt', 'delta', 'ember', 'fjord', 'gale', 'harbor',
  'indigo', 'juniper', 'kite', 'lumen', 'maple', 'nimbus', 'onyx', 'quartz',
  'raven', 'sable', 'tundra', 'verdant', 'willow', 'zephyr',
] as const

/** Name suggestion words: adjective + noun pairs read as work labels. */
const NAME_ADJECTIVES = [
  'quiet', 'brisk', 'steady', 'clever', 'polished', 'focused', 'tidy',
  'bold', 'nimble', 'patient',
] as const

const NAME_NOUNS = [
  'otter', 'falcon', 'cedar', 'harbor', 'meadow', 'lantern', 'compass',
  'pebble', 'cinder', 'juniper',
] as const

/** Deterministic picker so tests (and retry paths) stay reproducible. */
function pick<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length] as T
}

export interface SlugInput {
  /** Existing slugs in this repo (registry rows and live branches alike). */
  readonly takenSlugs: readonly string[]
  /** Caller-supplied entropy; defaults to time so production runs vary. */
  readonly seed?: number
}

/**
 * Generate the next `[a-z]+-\d{2}` slug that is free in this repo.
 *
 * @param input - taken slugs plus entropy.
 * @returns a slug not present in `takenSlugs`.
 */
export function nextSlug(input: SlugInput): string {
  const seed = input.seed ?? Date.now()
  const taken = new Set(input.takenSlugs)
  for (let attempt = 0; attempt < SLUG_WORDS.length * 40; attempt += 1) {
    const word = pick(SLUG_WORDS, seed + attempt * 7)
    for (let index = 1; index <= 40; index += 1) {
      const slug = `${word}-${String(index).padStart(2, '0')}`
      if (!taken.has(slug)) return slug
    }
  }
  // Exhausted the table: fall back to a time-derived suffix. Unreachable in
  // practice (880 combinations per repo), but generation must never throw.
  return `wt-${String(seed % 9973).padStart(4, '0')}`
}

/**
 * Suggest a display Name (adjective + noun). The create modal prefills
 * this and the user freely edits it.
 *
 * @param seed - deterministic entropy for tests.
 * @returns a two-word suggestion.
 */
export function suggestName(seed: number): string {
  return `${pick(NAME_ADJECTIVES, seed)} ${pick(NAME_NOUNS, seed + 3)}`
}

/**
 * Sanitize a user-typed Name into a display title.
 *
 * @param raw - the modal's input.
 * @returns a trimmed single-line title, or '' when nothing usable remains
 * (callers fall back to the slug).
 */
export function normalizeName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return ''
  return collapsed.slice(0, 60)
}

/**
 * The display title for a worktree row: the typed Name when present, the
 * slug otherwise.
 *
 * @param name - sanitized display name ('' when unset).
 * @param slug - generated slug.
 * @returns the title the sidebar and menus show.
 */
export function displayTitle(name: string, slug: string): string {
  return name === '' ? slug : name
}
