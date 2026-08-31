import { describe, expect, it } from 'vitest'
import {
  SHADOW_MARKER,
  buildShadowSkill,
  isShadowSkill,
  parseSkillFile,
  splitFrontmatter,
  toggleInvocation,
} from '../src/core/frontmatter.ts'

const sample = [
  '---',
  'name: security-review',
  'description: Review code for security issues.',
  'whenToUse: When asked to audit.',
  '---',
  '',
  '# Body',
  '',
].join('\n')

describe('splitFrontmatter', () => {
  it('splits a fenced frontmatter from the body', () => {
    const { yaml, body } = splitFrontmatter(sample)
    expect(yaml).toContain('name: security-review')
    expect(body).toContain('# Body')
  })
  it('returns null yaml when there is no opening fence', () => {
    const { yaml, body } = splitFrontmatter('# just a markdown file')
    expect(yaml).toBeNull()
    expect(body).toBe('# just a markdown file')
  })
  it('returns null yaml when the closing fence is missing', () => {
    const { yaml } = splitFrontmatter('---\nname: x\n')
    expect(yaml).toBeNull()
  })
  it('handles CRLF line endings', () => {
    const content = sample.replace(/\n/g, '\r\n')
    const { yaml } = splitFrontmatter(content)
    expect(yaml).toContain('name: security-review')
  })
})

describe('parseSkillFile', () => {
  it('parses name, description, and defaults', () => {
    const s = parseSkillFile(sample)
    expect(s).toBeDefined()
    expect(s!.name).toBe('security-review')
    expect(s!.description).toBe('Review code for security issues.')
    expect(s!.whenToUse).toBe('When asked to audit.')
    expect(s!.modelInvocable).toBe(true)
    expect(s!.userInvocable).toBe(true)
  })
  it('returns undefined without frontmatter', () => {
    expect(parseSkillFile('# no frontmatter')).toBeUndefined()
  })
  it('returns undefined on malformed YAML', () => {
    expect(parseSkillFile('---\nname: [unclosed\n---\n')).toBeUndefined()
  })
  it('returns undefined when the frontmatter is not an object', () => {
    expect(parseSkillFile('---\n- a\n- b\n---\n')).toBeUndefined()
  })
  it('returns undefined when name is missing', () => {
    expect(parseSkillFile('---\ndescription: d\n---\n')).toBeUndefined()
  })
  it('returns undefined when description is missing', () => {
    expect(parseSkillFile('---\nname: n\n---\n')).toBeUndefined()
  })
  it('honors disable-model-invocation: true', () => {
    const s = parseSkillFile('---\nname: n\ndescription: d\ndisable-model-invocation: true\n---\n')
    expect(s!.modelInvocable).toBe(false)
  })
  it('honors disable-model-invocation: false and string forms', () => {
    expect(parseSkillFile('---\nname: n\ndescription: d\ndisable-model-invocation: false\n---\n')!.modelInvocable).toBe(true)
    expect(parseSkillFile('---\nname: n\ndescription: d\ndisable-model-invocation: "yes"\n---\n')!.modelInvocable).toBe(false)
    expect(parseSkillFile('---\nname: n\ndescription: d\ndisable-model-invocation: "off"\n---\n')!.modelInvocable).toBe(true)
  })
  it('returns undefined on an invalid boolean frontmatter value', () => {
    expect(parseSkillFile('---\nname: n\ndescription: d\ndisable-model-invocation: nope\n---\n')).toBeUndefined()
  })
  it('honors user-invocable: false', () => {
    const s = parseSkillFile('---\nname: n\ndescription: d\nuser-invocable: false\n---\n')
    expect(s!.userInvocable).toBe(false)
  })
  it('parses a metadata object', () => {
    const s = parseSkillFile('---\nname: n\ndescription: d\nmetadata:\n  a: 1\n---\n')
    expect(s!.metadata).toEqual({ a: 1 })
  })
})

describe('toggleInvocation', () => {
  it('disabling inserts both invocation flags', () => {
    const out = toggleInvocation(sample, false)
    const { yaml } = splitFrontmatter(out)
    expect(yaml).toContain('disable-model-invocation: true')
    expect(yaml).toContain('user-invocable: false')
    const parsed = parseSkillFile(out)
    expect(parsed!.modelInvocable).toBe(false)
    expect(parsed!.userInvocable).toBe(false)
    expect(out).toContain('description: Review code for security issues.')
    expect(out).toContain('# Body')
  })
  it('does not corrupt a block-scalar description', () => {
    const block = '---\nname: n\ndescription: |\n  line one\n  line two\nlicense: MIT\n---\nbody'
    const out = toggleInvocation(block, false)
    const parsed = parseSkillFile(out)
    expect(parsed).toBeDefined()
    expect(parsed!.description).toContain('line one')
    expect(parsed!.description).toContain('line two')
    expect(parsed!.modelInvocable).toBe(false)
    expect(parsed!.userInvocable).toBe(false)
  })
  it('enabling removes both flags', () => {
    const disabled = toggleInvocation(sample, false)
    const enabled = toggleInvocation(disabled, true)
    expect(splitFrontmatter(enabled).yaml).not.toContain('disable-model-invocation')
    expect(splitFrontmatter(enabled).yaml).not.toContain('user-invocable')
    expect(parseSkillFile(enabled)!.modelInvocable).toBe(true)
    expect(parseSkillFile(enabled)!.userInvocable).toBe(true)
  })
  it('replaces an existing false/true value when disabling', () => {
    const withValues = '---\nname: n\ndescription: d\ndisable-model-invocation: false\nuser-invocable: true\n---\nbody'
    const out = toggleInvocation(withValues, false)
    expect(splitFrontmatter(out).yaml).toContain('disable-model-invocation: true')
    expect(splitFrontmatter(out).yaml).toContain('user-invocable: false')
    expect((splitFrontmatter(out).yaml!.match(/disable-model-invocation/g) ?? []).length).toBe(1)
    expect((splitFrontmatter(out).yaml!.match(/user-invocable/g) ?? []).length).toBe(1)
  })
  it('does not duplicate a key already present with the disabling value', () => {
    const already = '---\nname: n\ndescription: d\ndisable-model-invocation: true\nuser-invocable: false\n---\nbody'
    const out = toggleInvocation(already, false)
    expect((splitFrontmatter(out).yaml!.match(/disable-model-invocation/g) ?? []).length).toBe(1)
    expect((splitFrontmatter(out).yaml!.match(/user-invocable/g) ?? []).length).toBe(1)
  })
  it('appends missing keys at the end while keeping existing ones in place', () => {
    const onlyModel = '---\nname: n\ndescription: d\ndisable-model-invocation: true\n---\nbody'
    const out = toggleInvocation(onlyModel, false)
    const yaml = splitFrontmatter(out).yaml!
    expect(yaml).toContain('disable-model-invocation: true')
    expect(yaml).toContain('user-invocable: false')
    expect(yaml.indexOf('disable-model-invocation')).toBeLessThan(yaml.indexOf('user-invocable'))
  })
  it('returns the input unchanged when there is no frontmatter', () => {
    const plain = '# no frontmatter'
    expect(toggleInvocation(plain, false)).toBe(plain)
  })
  it('preserves CRLF endings', () => {
    const crlf = sample.replace(/\n/g, '\r\n')
    const out = toggleInvocation(crlf, false)
    expect(out.split('\r\n').length).toBeGreaterThan(1)
    const parsed = parseSkillFile(out)
    expect(parsed!.modelInvocable).toBe(false)
    expect(parsed!.userInvocable).toBe(false)
  })
})

describe('buildShadowSkill / isShadowSkill', () => {
  it('builds a disabled shadow with the marker', () => {
    const s = buildShadowSkill('foo', 'A foo skill')
    expect(parseSkillFile(s)!.modelInvocable).toBe(false)
    expect(parseSkillFile(s)!.userInvocable).toBe(false)
    expect(parseSkillFile(s)!.name).toBe('foo')
    expect(s).toContain(SHADOW_MARKER)
    expect(isShadowSkill(s)).toBe(true)
  })
  it('round-trips a multi-line description (raw interpolation used to corrupt the YAML)', () => {
    const description = 'Throwaway skill for the skills marker.\nMulti-line to exercise block-scalar descriptions.'
    const s = buildShadowSkill('foo', description)
    const parsed = parseSkillFile(s)
    expect(parsed).not.toBeUndefined()
    expect(parsed!.name).toBe('foo')
    expect(parsed!.description).toBe(description)
    expect(parsed!.modelInvocable).toBe(false)
    expect(parsed!.userInvocable).toBe(false)
    expect(isShadowSkill(s)).toBe(true)
  })
  it('round-trips a description containing ": " (raw interpolation used to corrupt the YAML)', () => {
    const description = 'Review changes along two axes: Standards (does the code follow this?) and Spec.'
    const s = buildShadowSkill('foo', description)
    const parsed = parseSkillFile(s)
    expect(parsed).not.toBeUndefined()
    expect(parsed!.description).toBe(description)
    expect(isShadowSkill(s)).toBe(true)
  })
  it('does not flag a normal skill as a shadow', () => {
    expect(isShadowSkill(sample)).toBe(false)
  })
})
