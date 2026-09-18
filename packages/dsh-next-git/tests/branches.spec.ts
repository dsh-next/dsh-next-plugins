import { describe, expect, it } from 'vitest'
import {
  BRANCH_FIELD,
  checkoutCandidates,
  findBranch,
  isValidBranchName,
  localBranches,
  localNameForRemote,
  parseBranches,
  validateBranchName,
} from '../src/core/branches.ts'

/** Build one for-each-ref line. */
function line(marker: string, name: string, oid: string, upstream: string, full: string): string {
  return [marker, name, oid, upstream, full].join(BRANCH_FIELD)
}

const RAW = [
  line('*', 'main', 'aaaa', 'origin/main', 'refs/heads/main'),
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
        { name: 'main', current: true, oid: 'a', upstream: 'origin/main', remote: false },
        { name: 'origin/main', current: false, oid: 'a', upstream: null, remote: true },
      ]),
    ).toEqual([])
  })

  it('strips the longest matching remote prefix', () => {
    expect(localNameForRemote('origin/feature/x')).toBe('feature/x')
    expect(localNameForRemote('upstream/main', ['origin', 'upstream'])).toBe('main')
    expect(localNameForRemote('feature')).toBe('feature')
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
