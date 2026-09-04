import { describe, expect, it } from 'vitest'
import { displayTitle, nextSlug, normalizeName, suggestName } from '../src/core/slug.ts'

describe('nextSlug', () => {
  it('is deterministic for a seed', () => {
    expect(nextSlug({ takenSlugs: [], seed: 7 }))
      .toBe(nextSlug({ takenSlugs: [], seed: 7 }))
  })

  it('matches the locked [a-z]+-NN pattern', () => {
    expect(nextSlug({ takenSlugs: [], seed: 1 })).toMatch(/^[a-z]+-\d{2}$/)
  })

  it('skips taken slugs', () => {
    const first = nextSlug({ takenSlugs: [], seed: 3 })
    const second = nextSlug({ takenSlugs: [first], seed: 3 })
    expect(second).not.toBe(first)
  })

  it('eventually falls back rather than throwing', () => {
    // Overwhelming the table with one word's every index still yields a
    // usable slug from another word.
    const flood: string[] = []
    for (let i = 1; i <= 40; i++) flood.push(`swift-${String(i).padStart(2, '0')}`)
    const slug = nextSlug({ takenSlugs: flood, seed: 11 })
    expect(slug).toMatch(/^[a-z]+-\d{2}$/)
    expect(flood).not.toContain(slug)
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
