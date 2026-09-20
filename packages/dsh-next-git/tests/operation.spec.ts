import { describe, expect, it } from 'vitest'
import { abortCommand, atRestMarkers, blocksCheckout, continueCommand, detectOperation, operationKindOf } from '../src/core/operation.ts'
import type { OperationMarkers } from '../src/core/operation.ts'
import type { OperationKind, StatusEntry } from '../src/core/types.ts'

describe('operation marker detection', () => {
  it('creates fresh backward-compatible at-rest evidence', () => {
    expect(atRestMarkers()).toEqual({ mergeHead: null, rebaseMerge: false, rebaseApply: false, cherryPickHead: null, revertHead: null, rebaseStep: null, message: null })
    expect(atRestMarkers()).not.toBe(atRestMarkers())
    expect(detectOperation(atRestMarkers())).toEqual({ kind: null, step: null, message: null, conflicts: [] })
  })

  it.each<[Partial<OperationMarkers>, OperationKind | null]>([
    [{ mergeHead: 'abc' }, 'merge'],
    [{ mergeHead: '' }, 'merge'],
    [{ cherryPickHead: 'abc' }, 'cherry-pick'],
    [{ revertHead: 'abc' }, 'revert'],
    [{ rebaseMerge: true }, 'rebase'],
    [{ rebaseApply: true }, 'rebase'],
    [{ rebaseApply: true, rebaseApplyApplying: true }, 'am'],
    [{ rebaseApply: true, rebaseApplyApplying: false }, 'rebase'],
    [{ rebaseApply: true, rebaseApplyRebasing: true }, 'rebase'],
    [{ rebaseApply: true, rebaseApplyApplying: true, rebaseApplyRebasing: true }, 'rebase'],
    [{ rebaseApplyApplying: true }, null],
    [{ rebaseApplyRebasing: true }, null],
    [{ rebaseMerge: true, rebaseApply: true, rebaseApplyApplying: true }, 'rebase'],
    [{ rebaseApply: true, rebaseApplyApplying: true, cherryPickHead: 'abc', mergeHead: 'abc' }, 'am'],
    [{ rebaseMerge: true, cherryPickHead: 'abc', mergeHead: 'abc' }, 'rebase'],
    [{ mergeHead: 'abc', cherryPickHead: 'abc', revertHead: 'abc' }, 'merge'],
    [{ cherryPickHead: 'abc', revertHead: 'abc' }, 'cherry-pick'],
  ])('classifies %j as %s with operation precedence', (markers, kind) => {
    expect(operationKindOf({ ...atRestMarkers(), ...markers })).toBe(kind)
  })

  it('retains message and unmerged paths, omitting ordinary modified entries', () => {
    const ordinary: StatusEntry = { path: 'normal', xy: '.M', untracked: false, ignored: false, worktree: 'modified' }
    const conflicted: StatusEntry = { ...ordinary, path: 'conflicted', unmerged: 'both-modified' }
    expect(detectOperation({ ...atRestMarkers(), mergeHead: 'abc', message: '  subject\nbody\n' }, [ordinary, conflicted]))
      .toEqual({ kind: 'merge', step: null, message: 'subject\nbody', conflicts: ['conflicted'] })
    expect(detectOperation({ ...atRestMarkers(), message: ' \n ' }).message).toBeNull()
  })

  it('only includes a positive-total rebase step for rebases, not git am', () => {
    const markers = { ...atRestMarkers(), rebaseApply: true, rebaseStep: { current: 2, total: 5 } }
    expect(detectOperation(markers).step).toBe('2/5')
    expect(detectOperation({ ...markers, rebaseStep: { current: 0, total: 0 } }).step).toBeNull()
    expect(detectOperation({ ...markers, rebaseStep: { current: 0, total: -1 } }).step).toBeNull()
    expect(detectOperation({ ...markers, rebaseApplyApplying: true })).toMatchObject({ kind: 'am', step: null })
  })
})

describe('operation commands and checkout blocking', () => {
  it.each<[OperationKind | null, string | null, string | null]>([
    [null, null, null],
    ['merge', 'commit', 'merge --abort'],
    ['rebase', 'rebase --continue', 'rebase --abort'],
    ['cherry-pick', 'cherry-pick --continue', 'cherry-pick --abort'],
    ['revert', 'revert --continue', 'revert --abort'],
    ['am', 'am --continue', 'am --abort'],
  ])('maps %s to its own recovery commands', (kind, continueValue, abortValue) => {
    expect(continueCommand(kind)).toBe(continueValue)
    expect(abortCommand(kind)).toBe(abortValue)
    expect(blocksCheckout(kind)).toBe(kind !== null)
  })
})
