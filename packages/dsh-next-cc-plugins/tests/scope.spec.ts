/**
 * Install-scope helpers: RPC-argument validation and scope comparison.
 * Pure core coverage for `core/scope.ts`.
 */
import { describe, expect, it } from 'vitest'
import { parseScope, sameScope } from '../src/core/scope.ts'

describe('parseScope', () => {
  it('defaults absent and null input to global', () => {
    expect(parseScope(undefined)).toEqual({ scope: { kind: 'global' } })
    expect(parseScope(null)).toEqual({ scope: { kind: 'global' } })
  })

  it('accepts the global kind and falls back to global for unknown kinds', () => {
    expect(parseScope({ kind: 'global' })).toEqual({ scope: { kind: 'global' } })
    expect(parseScope({ kind: 'mystery' })).toEqual({ scope: { kind: 'global' } })
    expect(parseScope({})).toEqual({ scope: { kind: 'global' } })
  })

  it('accepts a workspace list and preserves order', () => {
    expect(parseScope({ kind: 'workspaces', workspacePaths: ['/w1', '/w2'] })).toEqual({
      scope: { kind: 'workspaces', workspacePaths: ['/w1', '/w2'] },
    })
  })

  it('rejects non-objects and malformed workspace lists', () => {
    expect('error' in parseScope('global')).toBe(true)
    expect('error' in parseScope(42)).toBe(true)
    expect('error' in parseScope([])).toBe(true)
    expect('error' in parseScope({ kind: 'workspaces' })).toBe(true)
    expect('error' in parseScope({ kind: 'workspaces', workspacePaths: [] })).toBe(true)
    expect('error' in parseScope({ kind: 'workspaces', workspacePaths: ['/w1', ''] })).toBe(true)
    expect('error' in parseScope({ kind: 'workspaces', workspacePaths: ['/w1', '/w1'] })).toBe(true)
    expect('error' in parseScope({ kind: 'workspaces', workspacePaths: '/w1' })).toBe(true)
  })
})

describe('sameScope', () => {
  it('matches global scopes and order-insensitive workspace sets', () => {
    expect(sameScope({ kind: 'global' }, { kind: 'global' })).toBe(true)
    expect(sameScope(
      { kind: 'workspaces', workspacePaths: ['/w1', '/w2'] },
      { kind: 'workspaces', workspacePaths: ['/w2', '/w1'] },
    )).toBe(true)
  })

  it('separates modes and differing sets', () => {
    expect(sameScope({ kind: 'global' }, { kind: 'workspaces', workspacePaths: ['/w1'] })).toBe(false)
    expect(sameScope(
      { kind: 'workspaces', workspacePaths: ['/w1'] },
      { kind: 'workspaces', workspacePaths: ['/w1', '/w2'] },
    )).toBe(false)
  })
})
