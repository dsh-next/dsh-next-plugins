import { describe, expect, it } from 'vitest'
import { formatCapacity, parseCapacity, validateModels } from '../src/core/capacity.ts'

describe('capacity', () => {
  it('parses K/M spellings and round-trips whole thousands', () => {
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('8192')).toBe(8192)
    expect(parseCapacity('256K')).toBe(256_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
    expect(Number.isNaN(parseCapacity('nope'))).toBe(true)
    expect(formatCapacity(256_000)).toBe('256K')
    expect(formatCapacity(1_000_000)).toBe('1M')
    expect(formatCapacity(8192)).toBe('8192')
  })

  it('rejects empty ids, duplicates, and invalid capacities', () => {
    expect(validateModels([{ id: ' ' }])?.key).toBe('modelIdRequired')
    expect(validateModels([{ id: 'a' }, { id: 'a' }])?.key).toBe('modelIdDuplicate')
    expect(validateModels([{ id: 'a', name: '' }])?.key).toBe('modelNameInvalid')
    expect(validateModels([{ id: 'a', contextWindow: Number.NaN }])?.key).toBe('modelContextInvalid')
    expect(validateModels([{ id: 'a', maxTokens: 0 }])?.key).toBe('modelMaxTokensInvalid')
    expect(validateModels([{ id: 'a', contextWindow: 128_000, maxTokens: 8192 }])).toBeUndefined()
  })
})
