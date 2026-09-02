import { describe, expect, it } from 'vitest'
import {
  configForStorage,
  emptySkillsConfig,
  isScopeEnabled,
  normalizeSkillsConfig,
  parseInstalledRecord,
  parseProviderRecord,
  parseScopeSetting,
  pruneOrphanScopes,
  scopeForName,
  withScope,
  type SkillsConfig,
} from '../src/core/settings.ts'

describe('parseScopeSetting', () => {
  it('normalizes entries to deduped directory names', () => {
    expect(parseScopeSetting(['web', ' api ', 'web', ''])).toEqual(['web', 'api'])
  })
  it('accepts full paths and keeps only the directory name (portable scope keys)', () => {
    expect(parseScopeSetting(['/Users/x/Projects/web', '/home/other/api'])).toEqual(['web', 'api'])
  })
  it('reads the legacy { kind, workspacePaths } shape', () => {
    expect(parseScopeSetting({ kind: 'workspaces', workspacePaths: ['/a/b/one', 'two'] })).toEqual(['one', 'two'])
  })
  it('returns undefined for everywhere-meaning values', () => {
    expect(parseScopeSetting(undefined)).toBeUndefined()
    expect(parseScopeSetting(null)).toBeUndefined()
    expect(parseScopeSetting({ kind: 'global' })).toBeUndefined()
    expect(parseScopeSetting({ kind: 'galaxy' })).toBeUndefined()
    expect(parseScopeSetting('nope')).toBeUndefined()
  })
  it('keeps an empty list (off everywhere)', () => {
    expect(parseScopeSetting([])).toEqual([])
    expect(parseScopeSetting({ kind: 'workspaces', workspacePaths: [] })).toEqual([])
  })
})

describe('isScopeEnabled', () => {
  it('treats an absent scope as enabled everywhere', () => {
    expect(isScopeEnabled(undefined, '/a')).toBe(true)
    expect(isScopeEnabled(undefined, undefined)).toBe(true)
  })
  it('matches the workspace directory basename against the stored names', () => {
    const scope = ['web', 'api']
    expect(isScopeEnabled(scope, '/Users/x/Projects/web')).toBe(true)
    expect(isScopeEnabled(scope, '/home/dev/api/')).toBe(true)
    expect(isScopeEnabled(scope, '/Users/x/Projects/other')).toBe(false)
  })
  it('a name matches regardless of where the checkout lives (portability)', () => {
    const scope = ['web']
    expect(isScopeEnabled(scope, '/Users/rok/Projects/web')).toBe(true)
    expect(isScopeEnabled(scope, '/home/teammate/code/web')).toBe(true)
  })
  it('an empty list disables everywhere, including without a cwd', () => {
    expect(isScopeEnabled([], '/repo/a')).toBe(false)
    expect(isScopeEnabled([], undefined)).toBe(false)
  })
  it('a whitelist never enables for an undefined cwd', () => {
    expect(isScopeEnabled(['web'], undefined)).toBe(false)
    expect(isScopeEnabled(['web'], '')).toBe(false)
  })
  it('ignores trailing slashes when matching (basename compare)', () => {
    expect(isScopeEnabled(['a'], '/repo/a/')).toBe(true)
  })
})

describe('scopeForName', () => {
  it('reads the stored scope list', () => {
    const scopes = { foo: ['one', 'two'] } as SkillsConfig['scopes']
    expect(scopeForName(scopes, 'foo')).toEqual(['one', 'two'])
    expect(scopeForName(scopes, 'bar')).toBeUndefined()
  })
})

describe('normalizeSkillsConfig', () => {
  it('returns the empty config for junk input', () => {
    expect(normalizeSkillsConfig(undefined)).toEqual(emptySkillsConfig())
    expect(normalizeSkillsConfig('nope')).toEqual(emptySkillsConfig())
    expect(normalizeSkillsConfig([])).toEqual(emptySkillsConfig())
  })
  it('keeps valid providers and drops broken ones', () => {
    const config = normalizeSkillsConfig({
      providers: [
        { id: 'o-r', spec: 'o/r', addedAt: 't' },
        { id: '', spec: 'x' },
        { spec: 'no-id' },
        'junk',
      ],
    })
    expect(config.providers).toEqual([{ id: 'o-r', spec: 'o/r', addedAt: 't' }])
  })
  it('reads the installations key, dedupes by name (last wins), and drops unusable records', () => {
    const config = normalizeSkillsConfig({
      installations: [
        { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 'skills/a' },
        'junk',
        { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 'skills/a2' },
        { name: '', providerId: 'p', providerSpec: 'o/r', skillPath: 's' },
        { name: 'b', providerId: 'p', providerSpec: 'o/r' },
      ],
    })
    expect(config.installations).toEqual([
      { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 'skills/a2' },
    ])
  })
  it('still normalizes the legacy installed key (one-time compatibility read)', () => {
    const config = normalizeSkillsConfig({
      installed: [{ name: 'legacy', providerId: 'p', providerSpec: 'o/r', skillPath: 'skills/legacy' }],
    })
    expect(config.installations).toEqual([
      { name: 'legacy', providerId: 'p', providerSpec: 'o/r', skillPath: 'skills/legacy' },
    ])
  })
  it('prefers installations when both keys are present', () => {
    const config = normalizeSkillsConfig({
      installed: [{ name: 'old', providerId: 'p', providerSpec: 'o/r', skillPath: 's' }],
      installations: [{ name: 'new', providerId: 'p', providerSpec: 'o/r', skillPath: 's' }],
    })
    expect(config.installations.map((r) => r.name)).toEqual(['new'])
  })
  it('normalizes scopes to name lists and drops everywhere-meaning values', () => {
    const config = normalizeSkillsConfig({
      scopes: {
        off: [],
        legacy: { kind: 'workspaces', workspacePaths: ['/x/legacy'] },
        junk: { kind: 'wat' },
        globalMarker: { kind: 'global' },
      },
    })
    expect(config.scopes).toEqual({ off: [], legacy: ['legacy'] })
  })
})

describe('pruneOrphanScopes', () => {
  const base: SkillsConfig = {
    providers: [],
    installations: [],
    scopes: { live: ['web'], 'also-live': [], gone: ['api'], renamed: [] },
  }

  it('drops scope entries whose name has neither a copy nor a catalog skill', () => {
    const pruned = pruneOrphanScopes(base, ['live', 'also-live'], ['renamed'])
    expect(Object.keys(pruned.scopes).sort()).toEqual(['also-live', 'live', 'renamed'])
  })
  it('keeps every name that is installed or in the catalog', () => {
    const pruned = pruneOrphanScopes(base, ['live', 'also-live'], ['gone', 'renamed'])
    expect(pruned.scopes).toEqual(base.scopes)
  })
  it('returns the same config untouched when nothing is orphaned (no-op)', () => {
    const config: SkillsConfig = { providers: [], installations: [], scopes: { a: ['x'] } }
    expect(pruneOrphanScopes(config, ['a'], [])).toBe(config)
  })
  it('never mutates the input config', () => {
    pruneOrphanScopes(base, ['live'], [])
    expect(Object.keys(base.scopes).sort()).toEqual(['also-live', 'gone', 'live', 'renamed'])
  })
  it('an empty scopes map stays empty', () => {
    const config: SkillsConfig = { providers: [], installations: [], scopes: {} }
    expect(pruneOrphanScopes(config, [], []).scopes).toEqual({})
  })
})

describe('withScope', () => {
  it('sets, replaces, and clears entries without mutating the input', () => {
    const base = { a: ['x'] } as SkillsConfig['scopes']
    const withB = withScope(base, 'b', ['y'])
    expect(Object.keys(withB)).toEqual(['a', 'b'])
    const cleared = withScope(withB, 'a', undefined)
    expect('a' in cleared).toBe(false)
    expect('a' in base).toBe(true)
  })
})

describe('configForStorage', () => {
  it('produces sorted, JSON-able sections', () => {
    const stored = configForStorage({
      providers: [{ id: 'b', spec: 'b/r', addedAt: '' }, { id: 'a', spec: 'a/r', addedAt: '' }],
      installations: [
        { name: 'z', providerId: 'p', providerSpec: 'o/r', skillPath: 's' },
        { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 's' },
      ],
      scopes: { k: ['web', 'api'] },
    })
    expect(stored.providers.map((p) => p.id)).toEqual(['a', 'b'])
    expect(stored.installations.map((r) => r.name)).toEqual(['a', 'z'])
    expect(stored.scopes).toEqual({ k: ['web', 'api'] })
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored)
  })
})

describe('record parsers', () => {
  it('parseProviderRecord defaults addedAt to empty', () => {
    expect(parseProviderRecord({ id: 'a', spec: 'a/r' })).toEqual({ id: 'a', spec: 'a/r', addedAt: '' })
    expect(parseProviderRecord({ id: 'a' })).toBeUndefined()
  })
  it('parseInstalledRecord requires every field and keeps only the provenance four', () => {
    const good = { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 's' }
    expect(parseInstalledRecord(good)).toEqual(good)
    expect(parseInstalledRecord({ ...good, version: 'v', installedAt: 't' })).toEqual(good)
    for (const key of Object.keys(good)) {
      const broken = { ...good }
      delete (broken as Record<string, unknown>)[key]
      expect(parseInstalledRecord(broken)).toBeUndefined()
    }
  })
})
