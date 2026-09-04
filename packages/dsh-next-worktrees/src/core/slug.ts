/**
 * Slug and title derivation for worktree creation — pure logic.
 *
 * The slug is generated (never prompt-derived): branch names travel into
 * remotes the moment someone pushes, so the plan keeps prompt words in the
 * display title only. The title is derived from the first prompt words and
 * lives in the plugin registry, never in git.
 */

/** Minimal readable word list for generated slugs (lowercase, git-safe). */
const SLUG_WORDS = [
  'amber', 'bolt', 'canyon', 'delta', 'ember', 'flint', 'grove', 'harbor',
  'iris', 'jade', 'koala', 'lunar', 'meadow', 'north', 'onyx', 'pine',
  'quartz', 'ridge', 'solar', 'timber', 'umber', 'violet', 'willow', 'zephyr',
] as const

/** Shape of the injectable random source (0 <= n < max, integer). */
export type RandomInt = (maxExclusive: number) => number

/** Default random source backed by Math.random. */
export const mathRandom: RandomInt = (maxExclusive) =>
  Math.floor(Math.random() * maxExclusive)

/**
 * Generate a slug: one word plus two digits (`amber-42`). Collisions are
 * handled by the caller retrying with a fresh slug; the space is large
 * enough (24 * 100) that a couple of retries suffice for a repo's lifetime.
 */
export function generateSlug(random: RandomInt = mathRandom): string {
  const word = SLUG_WORDS[random(SLUG_WORDS.length)]
  const digits = String(random(100)).padStart(2, '0')
  return `${word}-${digits}`
}

/**
 * Derive a human title from the first prompt: up to `maxWords` words, at
 * most `maxChars` characters, whitespace collapsed, empty prompt yields ''.
 * Punctuation is kept (it is display-only); only control characters and
 * newlines are stripped.
 */
export function deriveTitle(
  prompt: string,
  maxWords = 4,
  maxChars = 28,
): string {
  const words = prompt
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, maxWords)
  if (words.length === 0) return ''
  let title = words.join(' ')
  if (title.length > maxChars) title = title.slice(0, maxChars).trimEnd()
  return title
}

/**
 * Turn a slug into a safe branch segment: lowercase, strip everything that
 * is not [a-z0-9-], collapse dashes, trim. Returns '' when nothing safe
 * remains (the caller then regenerates instead of creating).
 */
export function sanitizeSlugSegment(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Default branch prefix for plugin-created worktree branches. */
export const DEFAULT_BRANCH_PREFIX = 'dsh-worktrees'

/** Full branch name for a sanitized slug (`dsh-worktrees/amber-42`). */
export function branchName(slug: string, prefix = DEFAULT_BRANCH_PREFIX): string {
  return `${prefix}/${slug}`
}
