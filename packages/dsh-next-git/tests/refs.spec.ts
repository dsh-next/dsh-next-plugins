/**
 * The picker's data model: how refs become rows, how they group, and which
 * rows a filter keeps. Pure input/output, so the ordering rules the picker
 * relies on are pinned without a DOM or a repository.
 */
import { describe, expect, it } from 'vitest'
import {
  branchOptions,
  filterRefs,
  hasLocalBranch,
  partitionRefs,
  refOptions,
  tagOptions,
  type RefOption,
} from '../src/core/refs.ts'
import type { BranchInfo, TagInfo } from '../src/core/types.ts'

function branch(overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: 'main',
    current: false,
    oid: 'aaaaaaa1',
    upstream: null,
    remote: false,
    author: 'Ada',
    committedAt: 1_700_000_000,
    ahead: 0,
    behind: 0,
    subject: 'fix: guard the read',
    ...overrides,
  }
}

function tag(overrides: Partial<TagInfo> = {}): TagInfo {
  return { name: 'v1.0.0', oid: 'bbbbbbb2', author: 'Grace', committedAt: 1_600_000_000, subject: 'release 1', ...overrides }
}

const refs = (): RefOption[] => refOptions([
  branch({ name: 'main', current: true, upstream: 'origin/main', ahead: 1, behind: 2 }),
  branch({ name: 'feature/alpha', subject: 'feat: alpha', oid: 'ccccccc3' }),
  branch({ name: 'origin/main', remote: true, subject: 'fix upstream' }),
  branch({ name: 'upstream/release', remote: true, subject: 'release prep', oid: 'ddddddd4' }),
], [tag(), tag({ name: 'v2.0.0' })])

describe('ref options', () => {
  it('flags the kind, the current branch and the local name a remote checkout creates', () => {
    const options = branchOptions([
      branch({ name: 'main', current: true }),
      branch({ name: 'origin/feature', remote: true }),
      branch({ name: 'upstream/feature', remote: true }),
    ])
    expect(options.map((option) => [option.id, option.kind, option.current, option.localName])).toEqual([
      ['branch:main', 'branch', true, 'main'],
      ['remote:origin/feature', 'remote', false, 'feature'],
      // Only a configured remote prefix is stripped.
      ['remote:upstream/feature', 'remote', false, 'upstream/feature'],
    ])
    expect(branchOptions([branch({ name: 'upstream/feature', remote: true })], ['origin', 'upstream'])[0]?.localName).toBe('feature')
  })

  it('carries the tip detail and zero drift onto a tag row', () => {
    const [option] = tagOptions([tag()])
    expect(option).toMatchObject({
      id: 'tag:v1.0.0',
      kind: 'tag',
      name: 'v1.0.0',
      localName: 'v1.0.0',
      oid: 'bbbbbbb2',
      author: 'Grace',
      committedAt: 1_600_000_000,
      subject: 'release 1',
      current: false,
      upstream: null,
      ahead: 0,
      behind: 0,
    })
  })

  it('lists branches, then remote-tracking branches, then tags', () => {
    expect(refOptions([branch(), branch({ name: 'origin/x', remote: true })], [tag()]).map((option) => option.id)).toEqual([
      'branch:main',
      'remote:origin/x',
      'tag:v1.0.0',
    ])
  })
})

describe('ref grouping', () => {
  it('splits rows into labeled sections and drops the empty ones', () => {
    expect(partitionRefs(refs()).map((group) => [group.kind, group.refs.length])).toEqual([
      ['branch', 2],
      ['remote', 2],
      ['tag', 2],
    ])
    expect(partitionRefs([])).toEqual([])
    expect(partitionRefs(tagOptions([tag()])).map((group) => group.kind)).toEqual(['tag'])
  })
})

describe('ref filtering', () => {
  it('keeps the source order for a blank query, without copying the list', () => {
    const options = refs()
    expect(filterRefs(options, '   ')).toBe(options)
  })

  it('ranks a name prefix above a substring and both above a subject hit', () => {
    const options = [
      { ...branch({ name: 'release/prep' }), id: 'branch:release/prep', kind: 'branch' as const, localName: 'release/prep' },
      { ...branch({ name: 'prep/release' }), id: 'branch:prep/release', kind: 'branch' as const, localName: 'prep/release' },
      { ...branch({ name: 'other', subject: 'release notes' }), id: 'branch:other', kind: 'branch' as const, localName: 'other' },
    ]
    expect(filterRefs(options, 'release').map((option) => option.name)).toEqual(['release/prep', 'prep/release', 'other'])
  })

  it('matches a name as an ordered subsequence', () => {
    expect(filterRefs(refs(), 'falpha').map((option) => option.name)).toEqual(['feature/alpha'])
    expect(filterRefs(refs(), 'ftr').map((option) => option.id)).toEqual(['branch:feature/alpha'])
  })

  it('matches a subject, an author and a commit prefix', () => {
    expect(filterRefs(refs(), 'upstream').map((option) => option.name)).toContain('origin/main')
    expect(filterRefs(refs(), 'Grace').every((option) => option.kind === 'tag')).toBe(true)
    expect(filterRefs(refs(), 'aaaaaaa').map((option) => option.id)).toEqual(['branch:main', 'remote:origin/main'])
  })

  it('is case-insensitive and empty when nothing matches', () => {
    expect(filterRefs(refs(), 'MAIN').map((option) => option.id)).toContain('branch:main')
    expect(filterRefs(refs(), 'nothing-here')).toEqual([])
  })
})

describe('local branch lookup', () => {
  it('finds a local branch by exact name and ignores remotes', () => {
    const options = refs()
    expect(hasLocalBranch(options, 'main')).toBe(true)
    expect(hasLocalBranch(options, 'nope')).toBe(false)
    // A remote row of the same name is not a local branch.
    expect(hasLocalBranch(branchOptions([branch({ name: 'origin/main', remote: true })]), 'origin/main')).toBe(false)
  })
})
