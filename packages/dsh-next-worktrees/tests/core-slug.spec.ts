import { describe, expect, it } from 'vitest'
import {
  displayTitle,
  formatSlugStamp,
  nextSlug,
  normalizeName,
  slugFromPluginRef,
  suggestName,
} from '../src/core/slug.ts'

const NOW = Date.UTC(2026, 5, 14, 2, 22)

describe('formatSlugStamp', () => {
  it('renders UTC YYYYMMDDHHmm', () => {
    expect(formatSlugStamp(NOW)).toBe('202606140222')
  })

  it('zero-pads month, day, hour, and minute', () => {
    expect(formatSlugStamp(Date.UTC(2026, 0, 2, 3, 4))).toBe('202601020304')
  })
})

describe('slugFromPluginRef', () => {
  it('strips the plugin prefix', () => {
    expect(slugFromPluginRef('dsh-worktrees/willow-202606140222')).toBe('willow-202606140222')
  })

  it('accepts a fully-qualified heads ref', () => {
    expect(slugFromPluginRef('refs/heads/dsh-worktrees/sable-01')).toBe('sable-01')
  })

  it('rejects unrelated refs', () => {
    expect(slugFromPluginRef('main')).toBeUndefined()
    expect(slugFromPluginRef('dsh-worktrees/')).toBeUndefined()
    expect(slugFromPluginRef('refs/heads/main')).toBeUndefined()
  })
})

describe('nextSlug', () => {
  it('is deterministic for a seed and clock', () => {
    expect(nextSlug({ takenSlugs: [], seed: 7, now: NOW }))
      .toBe(nextSlug({ takenSlugs: [], seed: 7, now: NOW }))
  })

  it('matches word-YYYYMMDDHHmm (UTC)', () => {
    expect(nextSlug({ takenSlugs: [], seed: 7, now: NOW })).toBe('harbor-202606140222')
    expect(nextSlug({ takenSlugs: [], seed: 20, now: NOW })).toBe('willow-202606140222')
  })

  it('skips taken slugs at the same minute by picking another word', () => {
    const first = nextSlug({ takenSlugs: [], seed: 3, now: NOW })
    const second = nextSlug({ takenSlugs: [first], seed: 3, now: NOW })
    expect(second).not.toBe(first)
    expect(second).toMatch(/^[a-z]+-202606140222$/)
  })

  it('steps the stamp forward when every word is taken at that minute', () => {
    const taken: string[] = []
    for (let i = 0; i < 22; i += 1) {
      taken.push(nextSlug({ takenSlugs: taken, seed: 0, now: NOW }))
    }
    expect(taken).toHaveLength(22)
    expect(new Set(taken).size).toBe(22)
    const extra = nextSlug({ takenSlugs: taken, seed: 0, now: NOW })
    expect(extra).toMatch(/^[a-z]+-202606140223$/)
    expect(taken).not.toContain(extra)
  })

  it('does not collide with a leftover legacy word-NN slug', () => {
    expect(nextSlug({ takenSlugs: ['harbor-01'], seed: 7, now: NOW }))
      .toBe('harbor-202606140222')
  })
})

describe('suggestName', () => {
  it('is a two-word label', () => {
    expect(suggestName(5).split(' ')).toHaveLength(2)
  })

  it('is deterministic for a seed', () => {
    expect(suggestName(9)).toBe(suggestName(9))
  })

  it('varies across seeds', () => {
    const names = new Set(Array.from({ length: 20 }, (_, i) => suggestName(i)))
    expect(names.size).toBeGreaterThan(1)
  })
})

describe('normalizeName', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeName('  login   race \n fix ')).toBe('login race fix')
  })

  it('returns empty for blank input', () => {
    expect(normalizeName('   ')).toBe('')
  })

  it('caps length at 60 characters', () => {
    expect(normalizeName('x'.repeat(80))).toHaveLength(60)
  })
})

describe('displayTitle', () => {
  it('prefers the name when present', () => {
    expect(displayTitle('login race fix', 'swift-01')).toBe('login race fix')
  })

  it('falls back to the slug', () => {
    expect(displayTitle('', 'swift-01')).toBe('swift-01')
  })
})
