import { describe, expect, it } from 'vitest'
import { statusLine, worktreeStatus } from '../src/core/status.ts'

describe('worktreeStatus', () => {
  it('derives clean from a zero porcelain count', () => {
    expect(worktreeStatus({
      dirtyCount: 0,
      aheadCount: 0,
      mergedIntoTarget: false,
    })).toEqual({ clean: true, dirty: false, ahead: 0, merged: false })
  })

  it('derives dirty with an ahead count', () => {
    expect(worktreeStatus({
      dirtyCount: 3,
      aheadCount: 2,
      mergedIntoTarget: false,
    })).toEqual({ clean: false, dirty: true, ahead: 2, merged: false })
  })

  it('carries the merged flag independently of dirt', () => {
    expect(worktreeStatus({
      dirtyCount: 1,
      aheadCount: 0,
      mergedIntoTarget: true,
    })).toEqual({ clean: false, dirty: true, ahead: 0, merged: true })
  })
})

describe('statusLine', () => {
  it('reads clean alone when nothing else applies', () => {
    expect(statusLine({ clean: true, dirty: false, ahead: 0, merged: false })).toBe('clean')
  })

  it('composes dirty, ahead, and merged in order', () => {
    expect(statusLine({ clean: false, dirty: true, ahead: 2, merged: true }))
      .toBe('dirty, 2 ahead, merged')
  })
})
