import { describe, expect, it } from 'vitest'
import { replaceRange } from '../src/core/rewind-range.ts'
import { headMoved } from '../src/core/paths.ts'

describe('replaceRange', () => {
  it('shadows every surface node after the checkpoint seq', () => {
    expect(replaceRange([0, 1, 4, 7], 1)).toEqual({
      start: 4,
      end: 7,
      shadowed: [4, 7],
    })
  })

  it('returns null when the checkpoint is already the tail', () => {
    expect(replaceRange([0, 1], 1)).toBeNull()
    expect(replaceRange([], 0)).toBeNull()
  })

  it('sorts unsorted surface nodes so start is not after end', () => {
    expect(replaceRange([0, 9, 3], 1)).toEqual({
      start: 3,
      end: 9,
      shadowed: [3, 9],
    })
  })
})

describe('headMoved', () => {
  it('is a warning, not a missing-head crash', () => {
    expect(headMoved(null, { sha: 'a' })).toBe(false)
    expect(headMoved({ sha: 'a' }, { sha: 'a' })).toBe(false)
    expect(headMoved({ sha: 'b' }, { sha: 'a' })).toBe(true)
  })
})
