import { describe, expect, it } from 'vitest'
import {
  SHADOW_MARKER,
  isShadowSkill,
  parseSkillFile,
  splitFrontmatter,
  stripDisabledFlags,
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

describe('stripDisabledFlags (legacy toggle cleanup for the migration)', () => {
  it('removes both legacy toggle lines and keeps everything else', () => {
    const disabled = '---\nname: n\ndescription: d\ndisable-model-invocation: true\nlicense: MIT\nuser-invocable: false\n---\nbody'
    const out = stripDisabledFlags(disabled)
    const yaml = splitFrontmatter(out).yaml!
    expect(yaml).not.toContain('disable-model-invocation')
    expect(yaml).not.toContain('user-invocable')
    expect(yaml).toContain('license: MIT')
    expect(out.endsWith('body')).toBe(true)
    expect(parseSkillFile(out)!.modelInvocable).toBe(true)
  })
  it('leaves other boolean forms untouched (author intent)', () => {
    const author = '---\nname: n\ndescription: d\ndisable-model-invocation: false\nuser-invocable: true\n---\nbody'
    expect(stripDisabledFlags(author)).toBe(author)
  })
  it('returns the input unchanged when there is no frontmatter', () => {
    const plain = '# no frontmatter'
    expect(stripDisabledFlags(plain)).toBe(plain)
  })
  it('preserves CRLF endings', () => {
    const crlf = '---\r\nname: n\r\ndescription: d\r\ndisable-model-invocation: true\r\nuser-invocable: false\r\n---\r\nbody'
    const out = stripDisabledFlags(crlf)
    expect(out.split('\r\n').length).toBeGreaterThan(1)
    expect(out).not.toContain('disable-model-invocation')
  })
})

describe('isShadowSkill (legacy artifact recognition)', () => {
  it('recognizes the legacy shadow marker in the body', () => {
    const shadow = `---\nname: foo\ndescription: d\n---\n<!-- ${SHADOW_MARKER} -->\n`
    expect(isShadowSkill(shadow)).toBe(true)
    expect(isShadowSkill(sample)).toBe(false)
  })
})
