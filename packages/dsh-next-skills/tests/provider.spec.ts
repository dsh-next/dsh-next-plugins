import { describe, expect, it } from 'vitest'
import { cacheDirSlug, isIgnoredRepoPath, parseProviderSpec, providerId, providerSpec, skillPathFromCacheDir, versionHash } from '../src/core/provider.ts'

describe('parseProviderSpec', () => {
  it('accepts owner/repo', () => {
    expect(parseProviderSpec('vercel-labs/skills')).toEqual({ owner: 'vercel-labs', repo: 'skills' })
  })
  it('accepts a .git suffix', () => {
    expect(parseProviderSpec('vercel-labs/skills.git')).toEqual({ owner: 'vercel-labs', repo: 'skills' })
  })
  it('accepts full GitHub URLs', () => {
    expect(parseProviderSpec('https://github.com/holistics/skills')).toEqual({ owner: 'holistics', repo: 'skills' })
    expect(parseProviderSpec('http://github.com/holistics/skills')).toEqual({ owner: 'holistics', repo: 'skills' })
    expect(parseProviderSpec('https://www.github.com/holistics/skills')).toEqual({ owner: 'holistics', repo: 'skills' })
  })
  it('ignores trailing URL junk', () => {
    expect(parseProviderSpec('https://github.com/vercel-labs/skills/tree/main/skills')).toEqual({ owner: 'vercel-labs', repo: 'skills' })
  })
  it('rejects junk', () => {
    expect(parseProviderSpec('')).toBeUndefined()
    expect(parseProviderSpec('nope')).toBeUndefined()
    expect(parseProviderSpec('https://gitlab.com/a/b')).toBeUndefined()
    expect(parseProviderSpec('https://example.com/a/b')).toBeUndefined()
    expect(parseProviderSpec('a/b/c')).toBeUndefined()
    expect(parseProviderSpec('git@github.com:a/b')).toBeUndefined()
  })
  it('trims whitespace', () => {
    expect(parseProviderSpec('  a/b  ')).toEqual({ owner: 'a', repo: 'b' })
  })
})

describe('providerSpec / providerId', () => {
  it('canonicalizes the spec', () => {
    expect(providerSpec('https://github.com/A/B.git')).toBe('A/B')
    expect(providerSpec('nope')).toBeUndefined()
  })
  it('derives a filesystem-safe id', () => {
    expect(providerId('vercel-labs/skills')).toBe('vercel-labs-skills')
    expect(providerId('https://github.com/Ho.Listic_Repo/x')).toBe('ho-listic-repo-x')
    expect(providerId('nope')).toBeUndefined()
  })
})

describe('cacheDirSlug', () => {
  it('flattens nested skill paths', () => {
    expect(cacheDirSlug('native-skills/default/holistics-common/review-chat')).toBe('native-skills__default__holistics-common__review-chat')
  })
  it('round-trips through skillPathFromCacheDir', () => {
    expect(skillPathFromCacheDir(cacheDirSlug('a/b/c'))).toBe('a/b/c')
  })
})

describe('versionHash', () => {
  it('is deterministic and order-independent', () => {
    const a = [{ path: 'SKILL.md', sha: 's1' }, { path: 'r/n.md', sha: 's2' }]
    const b = [{ path: 'r/n.md', sha: 's2' }, { path: 'SKILL.md', sha: 's1' }]
    expect(versionHash(a)).toBe(versionHash(b))
  })
  it('changes when a sha changes', () => {
    const a = [{ path: 'SKILL.md', sha: 's1' }]
    const b = [{ path: 'SKILL.md', sha: 's2' }]
    expect(versionHash(a)).not.toBe(versionHash(b))
  })
  it('changes when a file is added or renamed', () => {
    const a = [{ path: 'SKILL.md', sha: 's1' }]
    expect(versionHash([...a, { path: 'x.md', sha: 's1' }])).not.toBe(versionHash(a))
    expect(versionHash([{ path: 'SKILL2.md', sha: 's1' }])).not.toBe(versionHash(a))
  })
  it('is a stable hex string', () => {
    expect(versionHash([])).toMatch(/^[0-9a-f]+$/)
    expect(versionHash([{ path: 'SKILL.md', sha: 'abc' }])).toMatch(/^[0-9a-f]+$/)
  })
})

describe('isIgnoredRepoPath', () => {
  it('flags metadata and dependency directories at any depth', () => {
    expect(isIgnoredRepoPath('.github/workflows/ci.yml')).toBe(true)
    expect(isIgnoredRepoPath('site/node_modules/x/SKILL.md')).toBe(true)
    expect(isIgnoredRepoPath('a/.git/config')).toBe(true)
    expect(isIgnoredRepoPath('skills/foo/SKILL.md')).toBe(false)
  })
})
