/**
 * Marketplace snapshot freshness and plugin version comparison.
 *
 * Two pure questions drive the panel's update affordances:
 *  - is a cached marketplace snapshot stale (older than the refresh TTL), so
 *    `getState` should re-sync it before answering;
 *  - does the snapshot's catalog carry a newer version than the installed
 *    record, so a card should offer an Update button.
 *
 * Marketplace versions are usually semver, but Claude Code indexes also carry
 * loose forms (`v1.2`, `2025.01.15-rc`, plain tags). Comparisons therefore
 * prefer numeric dotted segments and fall back to string inequality — an
 * "update" on a non-semver change is still safe: it re-installs the latest
 * snapshot.
 */

/** Cached marketplace snapshots older than this re-sync when the panel opens. */
export const MARKETPLACE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Whether a snapshot's `fetchedAt` is older than the TTL. Missing, empty, or
 * unparseable stamps count as stale (a missing or corrupt cache should be
 * refreshed, not trusted).
 */
export function isSnapshotStale(fetchedAt: string, now: number = Date.now(), ttl: number = MARKETPLACE_TTL_MS): boolean {
  const at = Date.parse(fetchedAt)
  if (Number.isNaN(at)) return true
  return now - at >= ttl
}

interface ParsedVersion {
  /** Numeric dotted segments, at least one. */
  nums: number[]
  /** Pre-release suffix without the leading `-` ('' when absent). */
  pre: string
}

/** Parse `v`-prefixed, optionally pre-release/build-metadata dotted numbers. */
function parseVersion(v: string): ParsedVersion | undefined {
  const raw = v.trim().replace(/^[vV]/, '').split('+')[0]
  const dash = raw.indexOf('-')
  const numeric = dash === -1 ? raw : raw.slice(0, dash)
  const pre = dash === -1 ? '' : raw.slice(dash + 1)
  const parts = numeric.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN))
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return undefined
  return { nums: parts, pre }
}

/** Semver-ish ordering of two parsed versions. */
function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  const len = Math.max(a.nums.length, b.nums.length)
  for (let i = 0; i < len; i++) {
    const x = a.nums[i] ?? 0
    const y = b.nums[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  // A pre-release sorts below its release (`1.0.0-rc.1` < `1.0.0`); two
  // pre-releases order by their raw suffix (an approximation of semver
  // identifier rules, adequate for an update badge).
  if (a.pre === b.pre) return 0
  if (a.pre === '') return 1
  if (b.pre === '') return -1
  return a.pre < b.pre ? -1 : 1
}

/**
 * Whether `catalog` (the marketplace snapshot's version) is newer than
 * `installed` (the installed record's version). Unparseable but different
 * strings count as newer — updating just re-installs the latest snapshot, so
 * erring toward offering it is safe. An empty catalog version never triggers.
 */
export function hasNewerVersion(installed: string, catalog: string): boolean {
  if (catalog === '') return false
  if (installed === '') return true
  const a = parseVersion(installed)
  const b = parseVersion(catalog)
  if (a !== undefined && b !== undefined) return compareParsed(b, a) > 0
  return installed !== catalog
}

/**
 * Whether a marketplace entry `version` satisfies a Claude plugin
 * dependency range (`name@range` in `plugin.json` `dependencies`).
 * Supports the common semver forms (`^1.2.0`, `~1.2`, `1.2.3`, `>=1.0`,
 * `*`/empty) over the same loose dotted-number parsing as the update
 * badge; an unparseable version satisfies only an exact string match or
 * an open range, so a weird version never silently passes a pin.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const r = range.trim()
  if (r === '' || r === '*' || r === 'latest') return true
  const v = parseVersion(version)
  const m = /^(>=|~|\^|=)?(.*)$/.exec(r.toLowerCase())
  const op = m?.[1] ?? ''
  const rest = (m?.[2] ?? '').trim()
  const bound = parseVersion(rest)
  if (v === undefined || bound === undefined) {
    // Unparseable on either side: only an exact string match satisfies, so
    // a weird version never silently passes a pin.
    return op === '' && version.trim().toLowerCase() === rest
  }
  if (op === '>=') return compareParsed(v, bound) >= 0
  if (op === '^') {
    if (v.nums[0] !== bound.nums[0]) return false // same major, not below
    return compareParsed(v, bound) >= 0
  }
  if (op === '~') {
    if (v.nums[0] !== bound.nums[0]) return false // same major.minor, not below
    if ((v.nums[1] ?? 0) !== (bound.nums[1] ?? 0)) return false
    return compareParsed(v, bound) >= 0
  }
  return compareParsed(v, bound) === 0
}

/** The `.claude-plugin/plugin.json` version of a plugin's files ('' when absent). */
export function manifestVersion(files: Record<string, string>): string {
  const raw = files['.claude-plugin/plugin.json']
  if (raw === undefined) return ''
  try {
    const data = JSON.parse(raw) as { version?: unknown }
    return typeof data.version === 'string' ? data.version.trim() : ''
  } catch {
    return ''
  }
}

export interface UpdateAvailability {
  /** The installed record's version ('' when none was resolved at install). */
  installedVersion: string
  /** The marketplace index entry's `version` ('' when it carries none). */
  entryVersion: string
  /** The plugin's own `plugin.json` version from the snapshot, when the
   *  plugin files resolve from the marketplace snapshot (relative sources). */
  manifestVersion?: string
  /** Digest of the marketplace snapshot at install time. */
  installedDigest?: string
  /** Digest of the marketplace snapshot now. */
  catalogDigest?: string
}

/**
 * Whether an installed plugin's card should offer Update, following Claude
 * Code's precedence: the catalog version is the marketplace entry's
 * `version`, falling back to the plugin's own `plugin.json` version, falling
 * back to "the marketplace content changed" — Claude resolves version-less
 * plugins to their source's commit SHA, and this bridge's snapshot digest is
 * the closest same-machine signal (it also covers entry-only edits).
 */
export function isUpdateAvailable(args: UpdateAvailability): boolean {
  const catalog = args.entryVersion !== '' ? args.entryVersion : args.manifestVersion ?? ''
  if (catalog !== '') return hasNewerVersion(args.installedVersion, catalog)
  if (args.installedDigest !== undefined && args.catalogDigest !== undefined) {
    return args.installedDigest !== args.catalogDigest
  }
  return false
}
