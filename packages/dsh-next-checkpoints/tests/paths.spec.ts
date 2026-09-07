import { describe, expect, it } from 'vitest'
import { absFromCwd, confineToCwd, normalizePosix, relativeToCwd, toDisplayPath } from '../src/core/paths.ts'

describe('normalizePosix', () => {
  it('collapses dot segments', () => {
    expect(normalizePosix('/repo/./src/../a.ts')).toBe('/repo/a.ts')
    expect(normalizePosix('/repo/foo/../..')).toBe('/')
  })
})

describe('relativeToCwd / absFromCwd', () => {
  it('round-trips a path under cwd', () => {
    expect(relativeToCwd('/repo', '/repo/src/a.ts')).toBe('src/a.ts')
    expect(absFromCwd('/repo', 'src/a.ts')).toBe('/repo/src/a.ts')
    expect(relativeToCwd('/repo', '/repo')).toBe('.')
    expect(absFromCwd('/repo', '.')).toBe('/repo')
    expect(absFromCwd('/repo', '')).toBe('/repo')
  })

  it('keeps paths outside cwd as absolute display paths', () => {
    expect(relativeToCwd('/repo', '/other/a.ts')).toBe('/other/a.ts')
  })

  it('strips a /private prefix so macOS realpaths still relativize', () => {
    expect(relativeToCwd('/tmp/ws', '/private/tmp/ws/README.md')).toBe('README.md')
    expect(toDisplayPath('/Users/me/web', '/Users/me/web/src/a.jsx')).toBe('src/a.jsx')
    expect(toDisplayPath('/Users/me/web', 'src/a.jsx')).toBe('src/a.jsx')
  })
})

describe('confineToCwd', () => {
  it('accepts paths that stay inside the session tree', () => {
    expect(confineToCwd('/repo', 'src/a.ts')).toBe('/repo/src/a.ts')
    expect(confineToCwd('/repo', '/repo/src/a.ts')).toBe('/repo/src/a.ts')
    expect(confineToCwd('/repo', '.')).toBe('/repo')
  })

  it('rejects traversal and absolute paths outside cwd', () => {
    expect(confineToCwd('/repo', '../secrets')).toBeNull()
    expect(confineToCwd('/repo', '/etc/passwd')).toBeNull()
    expect(confineToCwd('/repo', '/repo/../etc/passwd')).toBeNull()
    expect(confineToCwd('', 'a.ts')).toBeNull()
  })
})
