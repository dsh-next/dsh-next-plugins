/**
 * Pure slug and name generation.
 *
 * Locked rules: the slug is generated (`[a-z]+-YYYYMMDDHHmm` UTC) and is
 * the only thing that ever reaches a branch name; the user-typed Name is a
 * display title only — user text never becomes a ref (PII the moment
 * someone pushes). Branches read `dsh-worktrees/<slug>`.
 *
 * Legacy rows may still use `[a-z]+-\d{2}` (`sable-01`). New creates never
 * reuse that shape, so a leftover branch from Delete cannot collide with
 * the next click.
 */

/** Plugin-owned branch prefix. The slug is everything after this. */
export const PLUGIN_REF_PREFIX = 'dsh-worktrees/'

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

const MINUTE_MS = 60_000
const MAX_MINUTE_SHIFTS = 24 * 60

/** Deterministic picker so tests (and retry paths) stay reproducible. */
function pick<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length] as T
}

export interface SlugInput {
  /** Existing slugs in this repo (registry rows and live branches alike). */
  readonly takenSlugs: readonly string[]
  /** Caller-supplied entropy; defaults to `now` so production runs vary. */
  readonly seed?: number
  /** Clock for the UTC stamp; defaults to `Date.now()`. */
  readonly now?: number
}

/**
 * UTC `YYYYMMDDHHmm` stamp used in generated slugs.
 *
 * @param ms - epoch milliseconds.
 * @returns twelve digits, zero-padded.
 */
export function formatSlugStamp(ms: number): string {
  const date = new Date(ms)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  return `${year}${month}${day}${hour}${minute}`
}

/**
 * The slug encoded in a plugin branch ref, if this is one of ours.
 *
 * Accepts `dsh-worktrees/<slug>` and `refs/heads/dsh-worktrees/<slug>`.
 *
 * @param ref - a branch name or fully-qualified ref.
 * @returns the slug, or undefined when the ref is not plugin-owned.
 */
export function slugFromPluginRef(ref: string): string | undefined {
  const short = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
  if (!short.startsWith(PLUGIN_REF_PREFIX)) return undefined
  const slug = short.slice(PLUGIN_REF_PREFIX.length)
  return slug === '' ? undefined : slug
}

/**
 * Generate the next `[a-z]+-YYYYMMDDHHmm` slug that is free in this repo.
 *
 * The word is picked from the table; the stamp is UTC to the minute. When
 * that pair is taken, other words at the same minute are tried, then the
 * stamp steps forward one minute at a time.
 *
 * @param input - taken slugs plus entropy and clock.
 * @returns a slug not present in `takenSlugs`.
 */
export function nextSlug(input: SlugInput): string {
  const now = input.now ?? Date.now()
  const seed = input.seed ?? now
  const taken = new Set(input.takenSlugs)
  for (let minute = 0; minute < MAX_MINUTE_SHIFTS; minute += 1) {
    const stamp = formatSlugStamp(now + minute * MINUTE_MS)
    for (let attempt = 0; attempt < SLUG_WORDS.length; attempt += 1) {
      const word = pick(SLUG_WORDS, seed + attempt * 7)
      const slug = `${word}-${stamp}`
      if (!taken.has(slug)) return slug
    }
  }
  // Exhausted a day's worth of minute/word pairs: still must not throw.
  return `wt-${formatSlugStamp(now)}-${String(seed % 9973).padStart(4, '0')}`
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
