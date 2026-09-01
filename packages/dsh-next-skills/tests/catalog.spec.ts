import { describe, expect, it } from 'vitest'
import {
  catalogSkillViews,
  filterCatalogSkills,
  lastRefreshEpoch,
  parseCatalog,
  parseManifest,
  providerViews,
} from '../src/core/catalog.ts'
import type { Catalog } from '../src/core/types.ts'

const CATALOG: Catalog = {
  providers: [
    {
      id: 'a-b',
      spec: 'a/b',
      branch: 'main',
      lastRefresh: '2026-08-29T10:00:00.000Z',
      skills: [
        { name: 'find-skills', description: 'Find skills', cacheDir: 'skills__find-skills', skillPath: 'skills/find-skills', version: 'v1', files: [{ path: 'SKILL.md', sha: 's1' }] },
        { name: 'other', description: 'Other', cacheDir: 'nested__other', skillPath: 'nested/other', version: 'v2', files: [{ path: 'SKILL.md', sha: 's2' }] },
      ],
    },
    {
      id: 'c-d',
      spec: 'c/d',
      branch: 'main',
      lastRefresh: '',
      error: 'boom',
      skills: [],
    },
  ],
}

describe('catalog views', () => {
  it('lists skills sorted by name with provider attribution', () => {
    const view = { skills: catalogSkillViews(CATALOG), providers: providerViews(CATALOG) }
    expect(view.skills.map((s) => s.name)).toEqual(['find-skills', 'other'])
    expect(view.skills[0]).toMatchObject({ providerId: 'a-b', providerSpec: 'a/b', skillPath: 'skills/find-skills', version: 'v1' })
  })
  it('lists provider rows with counts and status', () => {
    const rows = providerViews(CATALOG)
    expect(rows[0]).toMatchObject({ id: 'a-b', spec: 'a/b', skillCount: 2 })
    expect(rows[1]).toMatchObject({ id: 'c-d', spec: 'c/d', skillCount: 0, error: 'boom' })
  })
  it('catalogSkillViews keeps whenToUse only when present', () => {
    const withWhen = { ...CATALOG, providers: [{ ...CATALOG.providers[0], skills: [{ ...CATALOG.providers[0].skills[0], whenToUse: 'x' }] }] }
    expect(catalogSkillViews(withWhen)[0].whenToUse).toBe('x')
    expect(catalogSkillViews(CATALOG)[0].whenToUse).toBeUndefined()
  })
})

describe('filterCatalogSkills', () => {
  it('filters by name, description, and provider spec', () => {
    const skills = catalogSkillViews(CATALOG)
    expect(filterCatalogSkills(skills, 'find')).toHaveLength(1)
    expect(filterCatalogSkills(skills, 'OTHER')).toHaveLength(1)
    expect(filterCatalogSkills(skills, 'a/b')).toHaveLength(2)
    expect(filterCatalogSkills(skills, 'zzz')).toHaveLength(0)
    expect(filterCatalogSkills(skills, '')).toHaveLength(2)
  })
})

describe('parseCatalog', () => {
  it('round-trips a valid catalog', () => {
    expect(parseCatalog(JSON.parse(JSON.stringify(CATALOG)))).toEqual(CATALOG)
  })
  it('degrades corrupt input to an empty catalog', () => {
    expect(parseCatalog(null)).toEqual({ providers: [] })
    expect(parseCatalog('nope')).toEqual({ providers: [] })
    expect(parseCatalog({})).toEqual({ providers: [] })
    expect(parseCatalog({ providers: 'nope' })).toEqual({ providers: [] })
  })
  it('drops malformed providers and skills but keeps valid ones', () => {
    const parsed = parseCatalog({
      providers: [
        { id: 'ok', spec: 'a/b', skills: [{ name: 'x', cacheDir: 'x', files: [{ path: 'SKILL.md', sha: 's' }], bad: 1 }, { name: 5 }] },
        { id: 7 },
      ],
    })
    expect(parsed.providers).toHaveLength(1)
    expect(parsed.providers[0].skills).toHaveLength(1)
    expect(parsed.providers[0].skills[0]).toMatchObject({ name: 'x', cacheDir: 'x' })
  })
})

describe('parseManifest', () => {
  it('parses a valid manifest and fills installedAt', () => {
    expect(parseManifest({ providerId: 'a-b', providerSpec: 'a/b', skillPath: 's/x', version: 'v1' }))
      .toEqual({ providerId: 'a-b', providerSpec: 'a/b', skillPath: 's/x', version: 'v1', installedAt: '' })
  })
  it('rejects missing fields', () => {
    expect(parseManifest(undefined)).toBeUndefined()
    expect(parseManifest({ providerId: 'a-b' })).toBeUndefined()
    expect(parseManifest({ providerId: 'a-b', providerSpec: 'a/b', skillPath: 1, version: 'v' })).toBeUndefined()
  })
})

describe('lastRefreshEpoch', () => {
  it('takes the newest successful sync and ignores errored providers', () => {
    expect(lastRefreshEpoch(CATALOG)).toBe(Date.parse('2026-08-29T10:00:00.000Z'))
    expect(lastRefreshEpoch({ providers: [] })).toBe(0)
    expect(lastRefreshEpoch({ providers: [{ id: 'x', spec: 'x/y', branch: 'main', lastRefresh: 'bogus', skills: [] }] })).toBe(0)
  })
})
