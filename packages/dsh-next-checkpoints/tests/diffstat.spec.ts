import { describe, expect, it } from 'vitest'
import { DIFFSTAT_BLOCKS, diffstatBlocks, formatDiffCount, sumDiffs } from '../src/core/diffstat.ts'

describe('formatDiffCount', () => {
  it('groups thousands the way GitHub does', () => {
    expect(formatDiffCount(4801)).toBe('4,801')
    expect(formatDiffCount(66)).toBe('66')
    expect(formatDiffCount(0)).toBe('0')
  })

  it('clamps non-finite and negative values', () => {
    expect(formatDiffCount(-3)).toBe('0')
    expect(formatDiffCount(Number.NaN)).toBe('0')
  })
})

describe('diffstatBlocks', () => {
  it('is five empty cells when both sides are zero', () => {
    expect(diffstatBlocks(0, 0)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty'])
    expect(diffstatBlocks(0, 0)).toHaveLength(DIFFSTAT_BLOCKS)
  })

  it('fills every cell when only one side has counts', () => {
    expect(diffstatBlocks(10, 0)).toEqual(['add', 'add', 'add', 'add', 'add'])
    expect(diffstatBlocks(0, 10)).toEqual(['del', 'del', 'del', 'del', 'del'])
  })

  it('floors a tiny deletion so it does not steal a block', () => {
    expect(diffstatBlocks(4801, 66)).toEqual(['add', 'add', 'add', 'add', 'empty'])
  })

  it('splits even mixes without overflowing five cells', () => {
    expect(diffstatBlocks(3, 2)).toEqual(['add', 'add', 'add', 'del', 'del'])
    expect(diffstatBlocks(1, 1)).toEqual(['add', 'add', 'del', 'del', 'empty'])
  })

  it('clamps negatives', () => {
    expect(diffstatBlocks(-4, 5)).toEqual(['del', 'del', 'del', 'del', 'del'])
  })
})

describe('sumDiffs', () => {
  it('adds per-file counts', () => {
    expect(sumDiffs([
      { added: 1, removed: 0 },
      { added: 0, removed: 1 },
      { added: 2, removed: 1 },
    ])).toEqual({ added: 3, removed: 2 })
  })

  it('returns zeros for an empty list', () => {
    expect(sumDiffs([])).toEqual({ added: 0, removed: 0 })
  })
})
