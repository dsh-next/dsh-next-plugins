import { describe, expect, it } from 'vitest'
import { parseWorktreeWorkspacePath, toPosix, WORKTREES_MARKER } from '../src/core/paths.ts'

describe('toPosix', () => {
  it('turns windows separators into slashes', () => {
    expect(toPosix('C:\\repos\\wt-repo')).toBe('C:/repos/wt-repo')
  })
})

describe('parseWorktreeWorkspacePath', () => {
  const root = '/repos/wt-repo/.dsh/worktrees/swift-01'

  it('parses the worktree root', () => {
    expect(parseWorktreeWorkspacePath(root)).toEqual({
      primary: '/repos/wt-repo',
      slug: 'swift-01',
      root,
    })
  })

  it('parses a subdirectory workspace under the worktree', () => {
    expect(parseWorktreeWorkspacePath(`${root}/packages/foo`)).toEqual({
      primary: '/repos/wt-repo',
      slug: 'swift-01',
      root,
    })
  })

  it('accepts windows separators', () => {
    expect(parseWorktreeWorkspacePath(
      'C:\\repos\\wt-repo\\.dsh\\worktrees\\swift-01\\packages\\foo',
    )).toEqual({
      primary: 'C:/repos/wt-repo',
      slug: 'swift-01',
      root: `C:/repos/wt-repo${WORKTREES_MARKER}swift-01`,
    })
  })

  it('rejects a path that is not a plugin worktree', () => {
    expect(parseWorktreeWorkspacePath('/repos/wt-repo')).toBeUndefined()
    expect(parseWorktreeWorkspacePath('/repos/wt-repo/.dsh/other/swift-01')).toBeUndefined()
    expect(parseWorktreeWorkspacePath('/.dsh/worktrees/swift-01')).toBeUndefined()
    expect(parseWorktreeWorkspacePath('/repos/wt-repo/.dsh/worktrees/')).toBeUndefined()
  })
})
