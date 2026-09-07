import { describe, expect, it } from 'vitest'
import { languageFromPath } from '../src/core/lang.ts'

describe('languageFromPath', () => {
  it('maps common extensions and Dockerfile, and returns null when unknown', () => {
    expect(languageFromPath('src/app.tsx')).toBe('typescript')
    expect(languageFromPath('tests/test_settings.py')).toBe('python')
    expect(languageFromPath('Dockerfile')).toBe('dockerfile')
    expect(languageFromPath('a.bin')).toBeNull()
    expect(languageFromPath('README')).toBeNull()
  })
})
