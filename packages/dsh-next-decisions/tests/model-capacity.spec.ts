// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatContextCapacity, parseContextCapacity } from '../src/core/model-capacity.ts'

describe('parseContextCapacity', () => {
  it.each(['', ' ', '\t', '\n\r', '\u2003'])('treats blank %j as unspecified rather than invalid', draft => {
    expect(parseContextCapacity(draft)).toBeUndefined()
  })
  it.each([
    ['1', 1], ['0001', 1], ['999', 999], ['1000', 1_000],
    ['1K', 1_000], ['1k', 1_000], ['128K', 128_000], ['000128k', 128_000],
    ['999K', 999_000], ['1M', 1_000_000], ['1m', 1_000_000], ['1000000', 1_000_000],
    ['  64k  ', 64_000], [' 1M\n', 1_000_000],
  ] as const)('reads decimal context draft %s as %i tokens', (draft, tokens) => {
    expect(parseContextCapacity(draft)).toBe(tokens)
  })
  it.each([
    '0', '0K', '0M', '000000', '-1', '+1', '1.5', '1.5K',
    '1000001', '1001K', '2M', '9007199254740992', '999999999999999999999K',
    '1Ki', '1KiB', '1KB', '1G', 'K', 'M', '1mB',
    '1 K', '1 K  ', '1e3', '1_000', '1,000', '12/3', '1\nK', 'Infinity', 'NaN',
  ])('rejects malformed or out-of-range context %j without rounding', draft => {
    expect(Number.isNaN(parseContextCapacity(draft))).toBe(true)
  })
})

describe('formatContextCapacity', () => {
  it('renders unspecified context as blank', () => {
    expect(formatContextCapacity(undefined)).toBe('')
    expect(parseContextCapacity(formatContextCapacity(undefined))).toBeUndefined()
  })
  it.each([
    [1, '1'], [999, '999'], [1_000, '1K'], [1_001, '1001'], [64_000, '64K'],
    [128_000, '128K'], [999_000, '999K'], [999_999, '999999'], [1_000_000, '1M'],
  ] as const)('formats %i using the shortest exact decimal spelling %s', (tokens, draft) => {
    expect(formatContextCapacity(tokens)).toBe(draft)
    expect(parseContextCapacity(formatContextCapacity(tokens))).toBe(tokens)
  })
  it('round-trips exact capacities across unscaled, K, M, and boundary values', () => {
    for (const tokens of [1, 2, 31, 999, 1_000, 1_001, 16_000, 32_768, 128_000, 256_000, 999_999, 1_000_000]) {
      expect(parseContextCapacity(formatContextCapacity(tokens))).toBe(tokens)
    }
  })
})
