import { describe, expect, it } from 'vitest'
import { highlightLine } from '../src/client/highlight.ts'

describe('highlightLine', () => {
  it('highlights known languages and escapes unknown ones', () => {
    expect(highlightLine('class Foo:', 'python')).toContain('hljs-keyword')
    expect(highlightLine('<b>', null)).toBe('&lt;b&gt;')
    expect(highlightLine('<b>', 'not-a-lang')).toBe('&lt;b&gt;')
  })
})
