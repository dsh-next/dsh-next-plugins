import { describe, expect, it } from 'vitest'
import {
  catalogSkillViews,
  parseCatalog,
  providerViews,
} from '../src/core/catalog.ts'
import type { Catalog } from '../src/core/types.ts'

const CATALOG: Catalog = {
  providers: [
    {
      id: 'a-b',
      spec: 'a/b',
      lastRefresh: '2026-08-29T10:00:00.000Z',
      skills: [
        { name: 'find-skills', description: 'Find skills', cacheDir: 'skills__find-skills', skillPath: 'skills/find-skills', version: 'v1', files: [{ path: 'SKILL.md', sha: 's1' }] },
        { name: 'other', description: 'Other', cacheDir: 'nested__other', skillPath: 'nested/other', version: 'v2', files: [{ path: 'SKILL.md', sha: 's2' }] },
      ],
    },
    {
      id: 'c-d',
      spec: 'c/d',
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
  it('keeps same names from different providers as separate rows (the update picker)', () => {
    const duplicated: Catalog = {
      providers: [
        CATALOG.providers[0],
        { ...CATALOG.providers[1], skills: [{ ...CATALOG.providers[0].skills[0], skillPath: 'dup/find-skills' }] },
      ],
    }
    const skills = catalogSkillViews(duplicated)
    expect(skills.filter((s) => s.name === 'find-skills')).toHaveLength(2)
    expect(skills.filter((s) => s.name === 'find-skills').map((s) => s.providerSpec)).toEqual(['a/b', 'c/d'])
  })
  it('collapses within-provider name duplicates, preferring the canonical skills/<name> copy', () => {
    const withCopies: Catalog = {
      providers: [
        {
          id: 'a-b',
          spec: 'a/b',
          lastRefresh: '',
          skills: [
            { name: 'find-skills', description: 'Find skills', cacheDir: 'docs__es__skills__find-skills', skillPath: 'docs/es/skills/find-skills', version: 'es', files: [{ path: 'SKILL.md', sha: 's0' }] },
            { name: 'find-skills', description: 'Find skills', cacheDir: 'skills__find-skills', skillPath: 'skills/find-skills', version: 'v1', files: [{ path: 'SKILL.md', sha: 's1' }] },
            { name: 'find-skills', description: 'Find skills', cacheDir: 'docs__ja-JP__skills__find-skills', skillPath: 'docs/ja-JP/skills/find-skills', version: 'ja', files: [{ path: 'SKILL.md', sha: 's2' }] },
          ],
        },
      ],
    }
    const skills = catalogSkillViews(withCopies)
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ name: 'find-skills', providerId: 'a-b', skillPath: 'skills/find-skills', version: 'v1' })
  })
  it('without a canonical skills/<name> copy, keeps the first (path-sorted) copy', () => {
    const noCanonical: Catalog = {
      providers: [
        {
          id: 'u-x',
          spec: 'u/x',
          lastRefresh: '',
          skills: [
            { name: 'brand', description: 'Brand', cacheDir: 'cli__assets__skills__brand', skillPath: 'cli/assets/skills/brand', version: 'c', files: [{ path: 'SKILL.md', sha: 's1' }] },
            { name: 'brand', description: 'Brand', cacheDir: '.claude__skills__brand', skillPath: '.claude/skills/brand', version: 'd', files: [{ path: 'SKILL.md', sha: 's2' }] },
          ],
        },
      ],
    }
    const skills = catalogSkillViews(noCanonical)
    expect(skills).toHaveLength(1)
    expect(skills[0].skillPath).toBe('.claude/skills/brand')
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
