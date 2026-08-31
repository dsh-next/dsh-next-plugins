/**
 * Marketplace source-spec parsing: every accepted form, every rejection
 * branch. Pure core coverage for `parseMarketplaceSpec`.
 */
import { describe, expect, it } from 'vitest'
import { expandHome, parseMarketplaceSpec } from '../src/core/source.ts'

describe('parseMarketplaceSpec', () => {
  it('accepts GitHub owner/repo shorthand', () => {
    expect(parseMarketplaceSpec('anthropics/claude-code')).toEqual({
      source: { kind: 'github', owner: 'anthropics', repo: 'claude-code' },
      canonical: 'anthropics/claude-code',
      id: 'github:anthropics/claude-code',
    })
  })

  it('accepts GitHub HTTPS URLs with and without .git', () => {
    for (const spec of ['https://github.com/my-org/plugins', 'https://github.com/my-org/plugins.git', 'https://github.com/my-org/plugins/']) {
      expect(parseMarketplaceSpec(spec)).toEqual({
        source: { kind: 'github', owner: 'my-org', repo: 'plugins' },
        canonical: 'my-org/plugins',
        id: 'github:my-org/plugins',
      })
    }
  })

  it('accepts GitHub SSH URLs', () => {
    expect(parseMarketplaceSpec('git@github.com:my-org/plugins.git')).toEqual({
      source: { kind: 'github', owner: 'my-org', repo: 'plugins' },
      canonical: 'my-org/plugins',
      id: 'github:my-org/plugins',
    })
  })

  it('accepts local paths (absolute, relative, home)', () => {
    for (const spec of ['/tmp/my-marketplace', './my-marketplace', '../shared/marketplace', '~/dev/my-plugins', '~']) {
      const result = parseMarketplaceSpec(spec)
      expect('error' in result).toBe(false)
      if (!('error' in result)) expect(result.source.kind).toBe('local')
    }
  })

  it('rejects empty and whitespace-only specs', () => {
    expect(parseMarketplaceSpec('')).toEqual({ error: 'empty marketplace spec' })
    expect(parseMarketplaceSpec('   ')).toEqual({ error: 'empty marketplace spec' })
  })

  it('rejects non-GitHub git URLs with an actionable message', () => {
    const result = parseMarketplaceSpec('https://gitlab.com/acme/plugins.git')
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toContain('must be GitHub')
  })

  it('rejects SSH-style non-GitHub URLs', () => {
    expect('error' in parseMarketplaceSpec('git@gitlab.com:acme/plugins.git')).toBe(true)
    expect('error' in parseMarketplaceSpec('ssh://git@gitlab.com/acme/plugins.git')).toBe(true)
  })

  it('rejects malformed shorthand', () => {
    expect('error' in parseMarketplaceSpec('not a spec')).toBe(true)
    expect('error' in parseMarketplaceSpec('owner/')).toBe(true)
    // A leading slash makes `/repo` a local absolute path, not shorthand.
    const abs = parseMarketplaceSpec('/repo')
    expect('error' in abs).toBe(false)
    if (!('error' in abs)) expect(abs.source).toEqual({ kind: 'local', path: '/repo' })
  })
})

describe('expandHome', () => {
  it('expands ~ and ~/prefixed paths, leaves others alone', () => {
    expect(expandHome('~', '/home/u')).toBe('/home/u')
    expect(expandHome('~/dev/x', '/home/u')).toBe('/home/u/dev/x')
    expect(expandHome('/opt/x', '/home/u')).toBe('/opt/x')
    expect(expandHome('./x', '/home/u')).toBe('./x')
  })
})
