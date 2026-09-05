import { describe, expect, it } from 'vitest'
import { statusLine, worktreeStatus } from '../src/core/status.ts'

describe('worktreeStatus', () => {
  it('derives clean from a zero porcelain count', () => {
    expect(worktreeStatus({
      dirtyCount: 0,
      aheadCount: 0,
      mergedIntoTarget: false,
      tipEqualsBase: false,
    })).toEqual({ clean: true, dirty: false, ahead: 0, merged: false, conflict: false })
  })

  it('derives dirty with an ahead count', () => {
    expect(worktreeStatus({
      dirtyCount: 3,
      aheadCount: 2,
      mergedIntoTarget: false,
      tipEqualsBase: false,
    })).toEqual({ clean: false, dirty: true, ahead: 2, merged: false, conflict: false })
  })

  it('carries the merged flag independently of dirt', () => {
    expect(worktreeStatus({
      dirtyCount: 1,
      aheadCount: 0,
      mergedIntoTarget: true,
      tipEqualsBase: false,
    })).toEqual({ clean: false, dirty: true, ahead: 0, merged: true, conflict: false })
  })

  it('never reports merged for a fresh worktree (tip == base)', () => {
    // A brand-new branch is trivially an ancestor of the base; that is
    // "no unique work yet", not "landed".
    expect(worktreeStatus({
      dirtyCount: 0,
      aheadCount: 0,
      mergedIntoTarget: true,
      tipEqualsBase: true,
    })).toEqual({ clean: true, dirty: false, ahead: 0, merged: false, conflict: false })
  })

  it('reports merged only when ancestry holds with a distinct tip', () => {
    expect(worktreeStatus({
      dirtyCount: 0,
      aheadCount: 0,
      mergedIntoTarget: true,
      tipEqualsBase: false,
    })).toEqual({ clean: true, dirty: false, ahead: 0, merged: true, conflict: false })
  })
})

describe('statusLine', () => {
  it('reads clean alone when nothing else applies', () => {
    expect(statusLine({ clean: true, dirty: false, ahead: 0, merged: false, conflict: false })).toBe('clean')
  })

  it('composes dirty, ahead, and merged in order', () => {
    expect(statusLine({ clean: false, dirty: true, ahead: 2, merged: true, conflict: false }))
      .toBe('dirty, 2 ahead, merged')
  })

  it('reports conflict ahead of dirty when a merge is in flight', () => {
    expect(worktreeStatus({
      dirtyCount: 2,
      aheadCount: 0,
      mergedIntoTarget: false,
      tipEqualsBase: false,
      merging: true,
    })).toEqual({ clean: false, dirty: true, ahead: 0, merged: false, conflict: true })
    expect(statusLine({
      clean: false, dirty: true, ahead: 1, merged: false, conflict: true,
    })).toBe('conflict, 1 ahead')
  })
})
