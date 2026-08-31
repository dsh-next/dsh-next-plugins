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
