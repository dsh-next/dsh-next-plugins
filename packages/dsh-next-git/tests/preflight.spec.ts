import { describe, expect, it } from 'vitest'
import {
  alwaysConfirms,
  decidePreflight,
  dirtyPathsOf,
  isDirty,
  needsOperationAbort,
  operationBlocksCheckout,
  type PreflightInput,
} from '../src/core/preflight.ts'
import type { PreflightAction } from '../src/core/types.ts'

/** A clean, at-rest, on-a-branch repository. */
function input(overrides: Partial<PreflightInput> & { action: PreflightAction }): PreflightInput {
  return {
    operation: null,
    modified: [],
    untracked: [],
    conflicts: [],
    detached: false,
    ...overrides,
  }
}

describe('preflight', () => {
  it('always confirms a discard, and names the untracked file it would delete', () => {
    const decision = decidePreflight(input({ action: 'discard', modified: ['a.ts'], untracked: ['b.txt'] }))
    expect(decision).toMatchObject({ verdict: 'confirm', code: 'dirty-tree' })
    expect(decision.verdict === 'confirm' ? decision.paths : []).toEqual(['a.ts', 'b.txt'])
  })

  it('always confirms removing untracked files', () => {
    const decision = decidePreflight(input({ action: 'remove-untracked', untracked: ['a.txt'] }))
    expect(decision).toMatchObject({ verdict: 'confirm', code: 'dirty-tree', paths: ['a.txt'] })
  })

  it('allows deleting a clean, merged worktree', () => {
    expect(decidePreflight(input({ action: 'delete-worktree', merged: true })).verdict).toBe('allow')
  })

  it('confirms deleting a dirty or unmerged worktree', () => {
    expect(decidePreflight(input({ action: 'delete-worktree', merged: false }))).toMatchObject({
      verdict: 'confirm',
      code: 'not-merged',
    })
    expect(
      decidePreflight(input({ action: 'delete-worktree', merged: true, untracked: ['x.txt'] })),
    ).toMatchObject({ verdict: 'confirm', code: 'dirty-tree' })
  })

  it('allows a branch switch on a clean tree and confirms it when dirty', () => {
    expect(decidePreflight(input({ action: 'switch-branch', target: 'feature' })).verdict).toBe('allow')
    expect(
      decidePreflight(input({ action: 'switch-branch', target: 'feature', modified: ['a.ts'] })),
    ).toMatchObject({ verdict: 'confirm', code: 'dirty-tree', detail: 'switch:feature' })
  })

  it('blocks deleting the checked-out branch', () => {
    expect(decidePreflight(input({ action: 'delete-branch', target: 'main', current: true }))).toMatchObject({
      verdict: 'block',
      code: 'current-branch',
    })
  })

  it('confirms deleting a merged branch and warns on an unmerged one', () => {
    expect(decidePreflight(input({ action: 'delete-branch', target: 'done', merged: true }))).toMatchObject({
      verdict: 'confirm',
      code: 'not-merged',
    })
    expect(decidePreflight(input({ action: 'delete-branch', target: 'wip', merged: false }))).toMatchObject({
      verdict: 'confirm',
      code: 'not-merged',
      detail: 'delete-unmerged:wip',
    })
  })

  it('blocks a merge while an operation is in progress', () => {
    expect(decidePreflight(input({ action: 'merge', operation: 'merge', conflicts: ['a.ts'] }))).toMatchObject({
      verdict: 'block',
      code: 'operation-in-progress',
      paths: ['a.ts'],
    })
  })

  it('blocks a merge on a detached HEAD and on a dirty tree', () => {
    expect(decidePreflight(input({ action: 'merge', detached: true }))).toMatchObject({
      verdict: 'block',
      code: 'detached-head',
    })
    expect(decidePreflight(input({ action: 'merge', modified: ['a.ts'] }))).toMatchObject({
      verdict: 'block',
      code: 'dirty-tree',
    })
    expect(decidePreflight(input({ action: 'merge' })).verdict).toBe('allow')
  })

  it('requires an upstream for update and blocks a dirty tree', () => {
    expect(decidePreflight(input({ action: 'update' })).verdict).toBe('allow')
    expect(decidePreflight(input({ action: 'update', hasUpstream: false }))).toMatchObject({
      verdict: 'block',
      code: 'no-upstream',
    })
    expect(decidePreflight(input({ action: 'update', detached: true }))).toMatchObject({
      verdict: 'block',
      code: 'detached-head',
    })
    expect(decidePreflight(input({ action: 'update', untracked: ['x'] }))).toMatchObject({
      verdict: 'block',
      code: 'dirty-tree',
    })
  })

  it('confirms a commit checkout and names the detached HEAD', () => {
    expect(decidePreflight(input({ action: 'checkout-commit', target: 'abc123' }))).toMatchObject({
      verdict: 'confirm',
      code: 'detached-head',
      detail: 'checkout:abc123',
    })
    expect(
      decidePreflight(input({ action: 'checkout-commit', target: 'abc123', modified: ['a.ts'] })),
    ).toMatchObject({ verdict: 'confirm', code: 'dirty-tree' })
  })

  it('blocks revert and cherry-pick while dirty or mid-operation', () => {
    for (const action of ['revert', 'cherry-pick'] as const) {
      expect(decidePreflight(input({ action })).verdict).toBe('allow')
      expect(decidePreflight(input({ action, modified: ['a.ts'] }))).toMatchObject({
        verdict: 'block',
        code: 'dirty-tree',
      })
      expect(decidePreflight(input({ action, operation: 'rebase' }))).toMatchObject({
        verdict: 'block',
        code: 'operation-in-progress',
      })
    }
  })

  it('exposes the helpers the panel uses', () => {
    expect(dirtyPathsOf(input({ action: 'merge', modified: ['a'], untracked: ['b'] }))).toEqual(['a', 'b'])
    expect(isDirty(input({ action: 'merge', modified: ['a'] }))).toBe(true)
    expect(isDirty(input({ action: 'merge' }))).toBe(false)
    expect(alwaysConfirms('discard')).toBe(true)
    expect(alwaysConfirms('merge')).toBe(false)
    expect(needsOperationAbort(decidePreflight(input({ action: 'merge', operation: 'merge' })))).toBe(true)
    expect(needsOperationAbort(decidePreflight(input({ action: 'merge', modified: ['a'] })))).toBe(false)
    expect(operationBlocksCheckout('merge')).toBe(true)
    expect(operationBlocksCheckout(null)).toBe(false)
  })
})
