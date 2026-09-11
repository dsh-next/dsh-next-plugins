import { describe, expect, it } from 'vitest'
import { SKILLS_NAMESPACE, skillsConfigSchema } from '../src/core/schema.ts'
import { normalizeSkillsConfig } from '../src/core/settings.ts'

// Exercise hand-edited runtime values, not only already-typed configuration.
const validate = skillsConfigSchema as unknown as (input: unknown) => unknown

describe('skills settings schema', () => {
  it('declares only providers and installation provenance, with empty defaults', () => {
    expect(SKILLS_NAMESPACE).toBe('dsh-next-skills')
    expect(Object.keys(skillsConfigSchema.dict ?? {}).sort()).toEqual(['installations', 'providers'])
    expect(validate({})).toEqual({ providers: [], installations: [] })
  })
  it('round-trips providers and installations while normalization ignores old scope data', () => {
    const result = validate({ providers: [{ id: 'o-r', spec: 'o/r' }], installations: [{ name: 'foo', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/foo' }], scopes: { foo: [] } })
    expect(normalizeSkillsConfig(result)).toEqual({ providers: [{ id: 'o-r', spec: 'o/r', addedAt: '' }], installations: [{ name: 'foo', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/foo' }] })
  })
  it('rejects invalid provider and installation field types', () => {
    expect(() => validate({ providers: [{ id: 1, spec: 'o/r' }] })).toThrow()
    expect(() => validate({ installations: [{ name: false }] })).toThrow()
  })
})
