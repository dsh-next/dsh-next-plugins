import { describe, expect, it } from 'vitest'
import { dirnamePath, isSafeRelativePath, joinPath } from '../src/core/path.ts'

describe('joinPath', () => {
  it('joins segments with single slashes', () => {
    expect(joinPath('/a', 'b', 'c')).toBe('/a/b/c')
  })
  it('collapses duplicate slashes', () => {
    expect(joinPath('/a/', '/b/')).toBe('/a/b')
  })
  it('preserves a leading slash from the first part', () => {
    expect(joinPath('/', 'home', 'user')).toBe('/home/user')
  })
  it('produces relative paths when no part is absolute', () => {
    expect(joinPath('a', 'b')).toBe('a/b')
  })
  it('drops a trailing slash', () => {
    expect(joinPath('/a', 'b', '/')).toBe('/a/b')
  })
})

describe('dirnamePath', () => {
  it('returns the parent directory', () => {
    expect(dirnamePath('/a/b/c')).toBe('/a/b')
  })
  it('returns / for a single-segment absolute path', () => {
    expect(dirnamePath('/a')).toBe('/')
  })
  it('returns . for a bare name', () => {
    expect(dirnamePath('a')).toBe('.')
  })
})

describe('isSafeRelativePath', () => {
  it('accepts a normal relative path', () => {
    expect(isSafeRelativePath('SKILL.md')).toBe(true)
    expect(isSafeRelativePath('references/a.md')).toBe(true)
  })
  it('rejects empty and absolute paths', () => {
    expect(isSafeRelativePath('')).toBe(false)
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
  })
  it('rejects traversal segments', () => {
    expect(isSafeRelativePath('../x')).toBe(false)
    expect(isSafeRelativePath('a/../../b')).toBe(false)
  })
  it('rejects dot and empty segments', () => {
    expect(isSafeRelativePath('.')).toBe(false)
    expect(isSafeRelativePath('a//b')).toBe(false)
    expect(isSafeRelativePath('./a')).toBe(false)
  })
})
