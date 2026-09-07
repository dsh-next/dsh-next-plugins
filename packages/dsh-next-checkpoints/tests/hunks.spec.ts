import { describe, expect, it } from 'vitest'
import { changeCounts, computeHunkDiffs, containsNul, decodeUtf8, lfNormalize } from '../src/core/hunks.ts'
import { validateHunks } from '../src/core/validate.ts'

describe('lfNormalize', () => {
  it('converts CRLF to LF so mixed endings are not a whole-file change', () => {
    expect(lfNormalize('a\r\nb\r\n')).toBe('a\nb\n')
  })
})

describe('containsNul / decodeUtf8', () => {
  it('treats a NUL in the first 8 KiB as binary', () => {
    expect(containsNul(new Uint8Array([65, 0, 66]))).toBe(true)
    expect(containsNul(new Uint8Array([65, 66]))).toBe(false)
  })

  it('treats a NUL past the first 8 KiB as binary', () => {
    const bytes = new Uint8Array(8 * 1024 + 2)
    bytes.fill(65)
    bytes[8 * 1024] = 0
    expect(containsNul(bytes)).toBe(true)
  })

  it('rejects invalid UTF-8', () => {
    expect(decodeUtf8(new Uint8Array([0xff, 0xfe]))).toBeUndefined()
    expect(decodeUtf8(new TextEncoder().encode('ok'))).toBe('ok')
  })
})

describe('computeHunkDiffs', () => {
  it('returns empty hunks for identical texts', () => {
    expect(computeHunkDiffs('a.ts', 'same\n', 'same\n')).toEqual({ ok: true, hunks: [] })
  })

  it('does not paint a 400-line file for a one-line edit', () => {
    const before = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 200', 'line 200 changed')
    const result = computeHunkDiffs('big.ts', before, after)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.hunks.length).toBe(1)
    const hunk = result.hunks[0]!
    expect(hunk.oldText?.includes('line 0')).toBe(false)
    expect(hunk.newText.includes('line 200 changed')).toBe(true)
    expect(hunk.oldStart).toBeGreaterThan(0)
    expect(hunk.lines.some((line) => line.kind === 'add' && line.text.includes('changed'))).toBe(true)
    const counts = changeCounts(before, after)
    expect(counts.added).toBe(1)
    expect(counts.removed).toBe(1)
  })

  it('uses oldText null for a pure create', () => {
    const result = computeHunkDiffs('new.ts', '', 'hello\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.hunks[0]?.oldText).toBeNull()
    expect(result.hunks[0]?.newText).toContain('hello')
  })

  it('counts lines whose content starts with ++ or --', () => {
    const before = 'keep\n'
    const after = 'keep\n++plus\n--minus\n'
    const counts = changeCounts(before, after)
    expect(counts.added).toBe(2)
    expect(counts.removed).toBe(0)
  })

  it('reports too-large when rendered rows exceed the cap', () => {
    const before = 'x\n'
    const after = Array.from({ length: 2001 }, (_, i) => `line ${i}`).join('\n')
    const result = computeHunkDiffs('big.ts', before, after)
    expect(result).toEqual({ ok: false, reason: 'too-large' })
  })

  it('reports timeout when structuredPatch exceeds the budget', () => {
    const before = Array.from({ length: 80 }, (_, i) => `left ${i} ${'a'.repeat(40)}`).join('\n')
    const after = Array.from({ length: 80 }, (_, i) => `right ${i} ${'b'.repeat(40)}`).join('\n')
    const result = computeHunkDiffs('slow.ts', before, after, 0)
    expect(result.ok === false && result.reason === 'timeout').toBe(true)
  })
})

describe('validateHunks', () => {
  it('drops malformed rows so DiffBlock never sees undefined texts', () => {
    expect(validateHunks(undefined)).toEqual([])
    expect(validateHunks([{ path: 'a.ts' }])).toEqual([])
    expect(validateHunks([{ path: 'a.ts', oldText: 1, newText: 'x' }])).toEqual([])
    expect(validateHunks([{ path: 'a.ts', oldText: null, newText: 'x' }])).toEqual([
      { path: 'a.ts', oldText: null, newText: 'x', oldStart: 1, newStart: 1, lines: [] },
    ])
    expect(validateHunks('nope')).toEqual([])
    expect(validateHunks([null, ['x'], { path: 'a.ts', oldText: null, newText: 'x' }])).toEqual([
      { path: 'a.ts', oldText: null, newText: 'x', oldStart: 1, newStart: 1, lines: [] },
    ])
  })
})
