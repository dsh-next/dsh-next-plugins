import { describe, expect, it } from 'vitest'
import {
  BRANCH_FIELD,
  REF_SUBJECT_LIMIT,
  checkoutCandidates,
  findBranch,
  isValidBranchName,
  localBranches,
  localNameForRemote,
  parseBranches,
  parseTags,
  parseTrack,
  validateBranchName,
} from '../src/core/branches.ts'

/** Build one `for-each-ref` branch line, with the tip detail the picker reads. */
function line(
  marker: string,
  name: string,
  oid: string,
  upstream: string,
  full: string,
  author = 'Ada',
  committedAt = '1700000000',
  track = '',
  subject = 'tip commit',
): string {
  return [marker, name, oid, upstream, full, author, committedAt, track, subject].join(BRANCH_FIELD)
}

/** Build one `for-each-ref` tag line. */
function tagLine(name: string, oid: string, peeled: string, author = 'Ada', committedAt = '1700000000', subject = 'release'): string {
  return [name, oid, peeled, author, committedAt, subject].join(BRANCH_FIELD)
}

const RAW = [
  line('*', 'main', 'aaaa', 'origin/main', 'refs/heads/main', 'Ada', '1700000000', '[ahead 1, behind 2]', 'fix: guard the read'),
  line(' ', 'feature', 'bbbb', '', 'refs/heads/feature'),
  line(' ', 'origin/main', 'aaaa', '', 'refs/remotes/origin/main'),
  line(' ', 'origin/remote-only', 'cccc', '', 'refs/remotes/origin/remote-only'),
  '',
  'malformed',
].join('\n')

describe('branch listing', () => {
  it('parses locals first, then remotes, with the current marker', () => {
    const branches = parseBranches(RAW)
    expect(branches.map((branch) => [branch.name, branch.remote, branch.current])).toEqual([
      ['main', false, true],
      ['feature', false, false],
      ['origin/main', true, false],
      ['origin/remote-only', true, false],
    ])
    expect(branches[0]!.upstream).toBe('origin/main')
    expect(branches[1]!.upstream).toBeNull()
  })

  it('skips malformed and empty input', () => {
    expect(parseBranches('')).toEqual([])
    expect(parseBranches('\n \n')).toEqual([])
    expect(parseBranches('too\u001ffew')).toEqual([])
    expect(parseBranches(line('*', 'main', '', '', 'refs/heads/main'))).toEqual([])
  })

  it('finds and filters branches', () => {
    const branches = parseBranches(RAW)
    expect(findBranch(branches, 'feature')?.name).toBe('feature')
    expect(findBranch(branches, 'nope')).toBeUndefined()
    expect(localBranches(branches).map((branch) => branch.name)).toEqual(['main', 'feature'])
  })

  it('offers remote-tracking branches that have no local twin', () => {
    const branches = parseBranches(RAW)
    expect(checkoutCandidates(branches)).toEqual([
      expect.objectContaining({ name: 'remote-only', remote: true }),
    ])
    // A remote whose local twin exists is not offered twice.
    expect(
      checkoutCandidates([
        { name: 'main', current: true, oid: 'a', upstream: 'origin/main', remote: false, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'tip' },
        { name: 'origin/main', current: false, oid: 'a', upstream: null, remote: true, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'tip' },
      ]),
    ).toEqual([])
  })

  it('strips the longest matching remote prefix', () => {
    expect(localNameForRemote('origin/feature/x')).toBe('feature/x')
    expect(localNameForRemote('upstream/main', ['origin', 'upstream'])).toBe('main')
    expect(localNameForRemote('feature')).toBe('feature')
  })
})

describe('ref tip detail', () => {
  it('reads the tip author, age, drift and subject of each branch', () => {
    const [main, feature] = parseBranches(RAW)
    expect(main).toMatchObject({
      author: 'Ada',
      committedAt: 1_700_000_000,
      ahead: 1,
      behind: 2,
      subject: 'fix: guard the read',
    })
    // No upstream means no drift, and the default tip detail still parses.
    expect(feature).toMatchObject({ ahead: 0, behind: 0, subject: 'tip commit' })
  })

  it('keeps a subject that contains the field separator', () => {
    const row = line(' ', 'x', 'a', '', 'refs/heads/x', 'Ada', '1700000000', '', `odd${BRANCH_FIELD}subject`)
    expect(parseBranches(row)[0]?.subject).toBe(`odd${BRANCH_FIELD}subject`)
  })

  it('bounds a subject and drops unusable times', () => {
    const long = 'x'.repeat(REF_SUBJECT_LIMIT + 40)
    const row = line(' ', 'x', 'a', '', 'refs/heads/x', 'Ada', 'not-a-time', '', long)
    const parsed = parseBranches(row)[0]!
    expect(parsed.subject).toHaveLength(REF_SUBJECT_LIMIT)
    expect(parsed.committedAt).toBe(0)
  })

  it.each([
    ['', { ahead: 0, behind: 0 }],
    ['[gone]', { ahead: 0, behind: 0 }],
    ['[ahead 3]', { ahead: 3, behind: 0 }],
    ['[behind 4]', { ahead: 0, behind: 4 }],
    ['[ahead 1, behind 2]', { ahead: 1, behind: 2 }],
  ])('parses the track atom %j', (raw, expected) => {
    expect(parseTrack(raw)).toEqual(expected)
  })
})

describe('tag listing', () => {
  it('peels an annotated tag to its commit and keeps the tag-object id otherwise', () => {
    const tags = parseTags([
      tagLine('v2.0.0', 'tagobject', 'commit2', 'Ada', '1700000000', 'release 2'),
      tagLine('v1.0.0', 'commit1', ''),
    ].join('\n'))
    expect(tags).toEqual([
      { name: 'v2.0.0', oid: 'commit2', author: 'Ada', committedAt: 1_700_000_000, subject: 'release 2' },
      { name: 'v1.0.0', oid: 'commit1', author: 'Ada', committedAt: 1_700_000_000, subject: 'release' },
    ])
  })

  it('skips blank and short input', () => {
    expect(parseTags('')).toEqual([])
    expect(parseTags('\n \n')).toEqual([])
    expect(parseTags(`${tagLine('v1', 'a', '')}\nbad${BRANCH_FIELD}line`)).toHaveLength(1)
    expect(parseTags(tagLine('', 'a', ''))).toEqual([])
    expect(parseTags(tagLine('v1', '', ''))).toEqual([])
  })
})

describe('branch name validation', () => {
  it('accepts ordinary names, including slashes', () => {
    expect(validateBranchName('feature')).toBeNull()
    expect(validateBranchName('feature/x-1')).toBeNull()
    expect(isValidBranchName('release/2024.01')).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['HEAD', 'reserved'],
    ['@', 'reserved'],
    ['refs/heads/x', 'reserved'],
    ['-lead', 'leading-dash'],
    ['trail.', 'trailing-dot'],
    ['trail/', 'trailing-dot'],
    ['a..b', 'consecutive-dots'],
    ['a@{1}', 'invalid-character'],
    ['a b', 'invalid-character'],
    ['a~b', 'invalid-character'],
    ['a^b', 'invalid-character'],
    ['a:b', 'invalid-character'],
    ['a?b', 'invalid-character'],
    ['a*b', 'invalid-character'],
    ['a[b', 'invalid-character'],
    ['a\\b', 'invalid-character'],
    ['a//b', 'separator'],
    ['a/.hidden', 'separator'],
  ])('refuses %j with %s', (input, issue) => {
    expect(validateBranchName(input)).toBe(issue)
  })
})
