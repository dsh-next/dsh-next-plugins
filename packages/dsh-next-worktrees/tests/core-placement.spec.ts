import { describe, expect, it } from 'vitest'
import { computePlacement } from '../src/core/placement.ts'

describe('computePlacement', () => {
  it('derives the primary root at the repo root itself', () => {
    expect(computePlacement({
      cwd: '/repos/wt-repo',
      gitCommonDir: '/repos/wt-repo/.git',
    })).toEqual({
      primary: '/repos/wt-repo',
      relPath: '',
      worktreesRoot: '/repos/wt-repo/.dsh/worktrees',
      insideWorktreesRoot: false,
    })
  })

  it('preserves a subdirectory relPath', () => {
    expect(computePlacement({
      cwd: '/repos/wt-repo/packages/foo',
      gitCommonDir: '/repos/wt-repo/.git',
    })).toEqual({
      primary: '/repos/wt-repo',
      relPath: 'packages/foo',
      worktreesRoot: '/repos/wt-repo/.dsh/worktrees',
      insideWorktreesRoot: false,
    })
  })

  it('flags a cwd inside the worktrees root but still resolves geometry', () => {
    // bind and status run from inside a worktree session; placement must
    // succeed and report the flag so create alone can refuse nesting.
    expect(computePlacement({
      cwd: '/repos/wt-repo/.dsh/worktrees/swift-01/packages/foo',
      gitCommonDir: '/repos/wt-repo/.git',
    })).toEqual({
      primary: '/repos/wt-repo',
      relPath: '.dsh/worktrees/swift-01/packages/foo',
      worktreesRoot: '/repos/wt-repo/.dsh/worktrees',
      insideWorktreesRoot: true,
    })
  })

  it('refuses directories outside a work tree', () => {
    expect(computePlacement({ cwd: '/repos/wt-plain', gitCommonDir: undefined }))
      .toBe('not-a-repository')
  })

  it('refuses bare or unknown layouts', () => {
    expect(computePlacement({ cwd: '/repos/bare', gitCommonDir: '/repos/bare' }))
      .toBe('bare-or-unknown-layout')
  })

  it('normalizes windows separators', () => {
    expect(computePlacement({
      cwd: 'C:\\repos\\wt-repo\\sub',
      gitCommonDir: 'C:\\repos\\wt-repo\\.git',
    })).toEqual({
      primary: 'C:/repos/wt-repo',
      relPath: 'sub',
      worktreesRoot: 'C:/repos/wt-repo/.dsh/worktrees',
      insideWorktreesRoot: false,
    })
  })
})
