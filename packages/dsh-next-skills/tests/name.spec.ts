import { describe, expect, it } from 'vitest'
import { isSkillName } from '../src/core/name.ts'

describe('isSkillName', () => {
  it('accepts kebab-case names', () => {
    expect(isSkillName('security-review')).toBe(true)
    expect(isSkillName('a')).toBe(true)
    expect(isSkillName('a-b-c')).toBe(true)
  })
  it('rejects invalid names', () => {
    expect(isSkillName('')).toBe(false)
    expect(isSkillName('SecurityReview')).toBe(false)
    expect(isSkillName('security_review')).toBe(false)
    expect(isSkillName('-leading')).toBe(false)
    expect(isSkillName('trailing-')).toBe(false)
    expect(isSkillName('double--dash')).toBe(false)
    expect(isSkillName('with space')).toBe(false)
  })
})
