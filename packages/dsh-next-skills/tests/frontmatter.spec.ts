import { describe, expect, it } from 'vitest'
import {
  parseSkillFile,
  splitFrontmatter,
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
