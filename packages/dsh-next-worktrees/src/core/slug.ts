/**
 * Pure slug and name generation.
 *
 * The create modal asks for a folder name. A valid name is kebab-case
 * (`update-plugin`) and is the disk folder, the sidebar title, and the
 * slug in `dsh-worktrees/<slug>`. Generated `[a-z]+-YYYYMMDDHHmm` slugs
 * remain the fallback when no name is sent (API / tests).
 *
 * Legacy rows may still use `[a-z]+-\d{2}` (`sable-01`).
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

/** Folder / slug / title: kebab-case, git-ref safe, filesystem safe. */
export const FOLDER_NAME_MAX = 60

/**
 * `update-plugin`, `a`, `auth-refresh-2`. No spaces, uppercase, dots,
 * consecutive hyphens, or leading/trailing hyphens.
 */
const FOLDER_NAME_RE = /^[a-z](?:[a-z0-9]{0,59}|[a-z0-9-]{0,58}[a-z0-9])$/

const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** Why a typed folder name is not usable. */
export type FolderNameReason = 'empty' | 'too-long' | 'format' | 'reserved'

/** Result of validating a create-modal folder name. */
export type FolderNameResult =
  | { readonly ok: true; readonly folder: string }
  | { readonly ok: false; readonly reason: FolderNameReason }

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
 * Suggest a kebab-case folder name (adjective-noun). The create modal
 * prefills this; the user may edit it into another valid folder name.
 *
 * @param seed - deterministic entropy for tests.
 * @param takenSlugs - occupied folder names and plugin branch slugs.
 * @returns a free kebab-case suggestion, suffixed when the pair is taken.
 */
export function suggestName(seed: number, takenSlugs: readonly string[] = []): string {
  const base = `${pick(NAME_ADJECTIVES, seed)}-${pick(NAME_NOUNS, seed + 3)}`
  const taken = new Set(takenSlugs)
  let name = base
  for (let suffix = 2; taken.has(name); suffix += 1) {
    name = `${base}-${suffix}`
  }
  return name
}

/**
 * Whether `raw` is a legal worktree folder / slug / title.
 *
 * @param raw - the modal's input (not trimmed by the caller).
 */
export function validateFolderName(raw: string): FolderNameResult {
  const folder = raw.trim()
  if (folder === '') return { ok: false, reason: 'empty' }
  if (folder.length > FOLDER_NAME_MAX) return { ok: false, reason: 'too-long' }
  if (WINDOWS_RESERVED.has(folder) || folder === 'git') return { ok: false, reason: 'reserved' }
  if (!FOLDER_NAME_RE.test(folder) || folder.includes('--')) {
    return { ok: false, reason: 'format' }
  }
  return { ok: true, folder }
}

/**
 * Sanitize a user-typed Name into a display title.
 *
 * Valid kebab-case names are kept as-is (they are also the folder).
 * Anything else is trimmed to a single line so legacy callers still
 * have a label; they must not be used as a folder.
 *
 * @param raw - the modal's input.
 * @returns a trimmed title, or '' when nothing usable remains.
 */
export function normalizeName(raw: string): string {
  const parsed = validateFolderName(raw)
  if (parsed.ok) return parsed.folder
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return ''
  return collapsed.slice(0, FOLDER_NAME_MAX)
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
