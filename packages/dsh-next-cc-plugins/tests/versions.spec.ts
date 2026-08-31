/**
 * Version comparison and snapshot staleness: the pure logic behind the panel's
 * Update button (catalog newer than the installed record) and the daily
 * marketplace auto-refresh TTL.
 */
import { describe, expect, it } from 'vitest'
import { hasNewerVersion, isSnapshotStale, isUpdateAvailable, manifestVersion, MARKETPLACE_TTL_MS } from '../src/core/versions.ts'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-02T12:00:00.000Z')

describe('MARKETPLACE_TTL_MS', () => {
  it('is one day', () => {
    expect(MARKETPLACE_TTL_MS).toBe(DAY)
  })
})

describe('isSnapshotStale', () => {
  it('keeps fresh snapshots', () => {
    expect(isSnapshotStale(new Date(NOW - 60 * 1000).toISOString(), NOW)).toBe(false)
    expect(isSnapshotStale(new Date(NOW - DAY + 1000).toISOString(), NOW)).toBe(false)
  })

  it('marks snapshots at or past the TTL stale', () => {
    expect(isSnapshotStale(new Date(NOW - DAY).toISOString(), NOW)).toBe(true)
    expect(isSnapshotStale(new Date(NOW - 7 * DAY).toISOString(), NOW)).toBe(true)
  })

  it('treats missing, empty, or invalid stamps as stale', () => {
    expect(isSnapshotStale('', NOW)).toBe(true)
    expect(isSnapshotStale('not-a-date', NOW)).toBe(true)
  })

  it('honors a custom ttl', () => {
    const stamp = new Date(NOW - 30 * 1000).toISOString()
    expect(isSnapshotStale(stamp, NOW, 60 * 1000)).toBe(false)
    expect(isSnapshotStale(stamp, NOW, 10 * 1000)).toBe(true)
  })
})

describe('hasNewerVersion', () => {
  it('is false for equal versions in every parseable shape', () => {
    expect(hasNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(hasNewerVersion('1.2', '1.2.0')).toBe(false)
    expect(hasNewerVersion('v1.2.3', '1.2.3')).toBe(false)
    expect(hasNewerVersion('1.0.0+b1', '1.0.0+b2')).toBe(false)
    expect(hasNewerVersion('beta-1', 'beta-1')).toBe(false)
  })

  it('is true for semver bumps in major, minor, and patch', () => {
    expect(hasNewerVersion('1.2.3', '1.2.4')).toBe(true)
    expect(hasNewerVersion('1.2.3', '1.3.0')).toBe(true)
    expect(hasNewerVersion('1.2.3', '2.0.0')).toBe(true)
    expect(hasNewerVersion('0.9', '0.10')).toBe(true) // numeric, not lexicographic
  })

  it('is false for downgrades', () => {
    expect(hasNewerVersion('1.2.4', '1.2.3')).toBe(false)
    expect(hasNewerVersion('2.0.0', '1.9.9')).toBe(false)
  })

  it('orders pre-releases below their release', () => {
    expect(hasNewerVersion('1.0.0-rc.1', '1.0.0')).toBe(true)
    expect(hasNewerVersion('1.0.0', '1.0.0-rc.1')).toBe(false)
    expect(hasNewerVersion('1.0.0-rc.1', '1.0.0-rc.2')).toBe(true)
  })

  it('never triggers on an empty catalog version', () => {
    expect(hasNewerVersion('1.0.0', '')).toBe(false)
    expect(hasNewerVersion('', '')).toBe(false)
  })

  it('treats any catalog version as newer than an unversioned install', () => {
    expect(hasNewerVersion('', '1.0.0')).toBe(true)
    expect(hasNewerVersion('', 'unstable')).toBe(true)
  })

  it('falls back to string inequality for non-semver versions', () => {
    expect(hasNewerVersion('2025.01a', '2025.02a')).toBe(true)
    expect(hasNewerVersion('2025.02a', '2025.01a')).toBe(true) // differs, so offer the refresh
    expect(hasNewerVersion('beta-1', 'beta-1')).toBe(false)
  })
})

describe('manifestVersion', () => {
  it('reads the version from .claude-plugin/plugin.json', () => {
    expect(manifestVersion({ '.claude-plugin/plugin.json': '{"name":"p","version":"3.2.1"}' })).toBe('3.2.1')
    expect(manifestVersion({ '.claude-plugin/plugin.json': '{"version":" 2.0 "}' })).toBe('2.0')
  })

  it('returns empty for absent, malformed, or non-string versions', () => {
    expect(manifestVersion({})).toBe('')
    expect(manifestVersion({ '.claude-plugin/plugin.json': '{oops' })).toBe('')
    expect(manifestVersion({ '.claude-plugin/plugin.json': '{"version":7}' })).toBe('')
    expect(manifestVersion({ '.claude-plugin/plugin.json': '{"version":""}' })).toBe('')
  })
})

describe('isUpdateAvailable', () => {
  const DIGEST_A = 'a'.repeat(64)
  const DIGEST_B = 'b'.repeat(64)

  it('follows the entry version when one is carried', () => {
    expect(isUpdateAvailable({ installedVersion: '1.0.0', entryVersion: '1.1.0' })).toBe(true)
    expect(isUpdateAvailable({ installedVersion: '1.1.0', entryVersion: '1.1.0' })).toBe(false)
    // Entry wins over manifest even when the manifest is newer.
    expect(isUpdateAvailable({ installedVersion: '1.0.0', entryVersion: '1.0.0', manifestVersion: '2.0.0' })).toBe(false)
  })

  it('falls back to the manifest version for version-less entries', () => {
    expect(isUpdateAvailable({ installedVersion: '1.0.0', entryVersion: '', manifestVersion: '1.1.0' })).toBe(true)
    expect(isUpdateAvailable({ installedVersion: '1.1.0', entryVersion: '', manifestVersion: '1.1.0' })).toBe(false)
    // An install with no resolved version treats any catalog version as new.
    expect(isUpdateAvailable({ installedVersion: '', entryVersion: '', manifestVersion: '0.1.0' })).toBe(true)
  })

  it('falls back to snapshot digests when no version exists anywhere', () => {
    expect(isUpdateAvailable({ installedVersion: '', entryVersion: '', installedDigest: DIGEST_A, catalogDigest: DIGEST_B })).toBe(true)
    expect(isUpdateAvailable({ installedVersion: '', entryVersion: '', installedDigest: DIGEST_A, catalogDigest: DIGEST_A })).toBe(false)
    // Missing digests mean no signal.
    expect(isUpdateAvailable({ installedVersion: '', entryVersion: '' })).toBe(false)
    expect(isUpdateAvailable({ installedVersion: '', entryVersion: '', catalogDigest: DIGEST_B })).toBe(false)
  })

  it('prefers a version signal over digests', () => {
    // Same version but changed digest: a version-carrying plugin does not
    // flag (Claude pins users to the version string); a version-less one
    // would flag via the digest branch above.
    expect(isUpdateAvailable({ installedVersion: '1.0.0', entryVersion: '1.0.0', installedDigest: DIGEST_A, catalogDigest: DIGEST_B })).toBe(false)
  })
})
