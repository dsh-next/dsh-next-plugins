import { describe, expect, it } from 'vitest'
import {
  configForStorage,
  emptySkillsConfig,
  isScopeEnabled,
  normalizePathForCompare,
  normalizeSkillsConfig,
  parseInstalledRecord,
  parseProviderRecord,
  parseScopeSetting,
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
  it('normalizes trailing slashes for comparisons', () => {
    expect(normalizePathForCompare('/repo/a/')).toBe('/repo/a')
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
  it('dedupes installed records by name (last wins) and drops unusable ones', () => {
    const config = normalizeSkillsConfig({
      installed: [
        { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 'skills/a', version: 'v1', installedAt: 't1' },
        'junk',
        { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 'skills/a', version: 'v2', installedAt: 't2' },
        { name: '', providerId: 'p', providerSpec: 'o/r', skillPath: 's', version: 'v', installedAt: 't' },
      ],
    })
    expect(config.installed).toEqual([
      { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 'skills/a', version: 'v2', installedAt: 't2' },
    ])
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
      installed: [
        { name: 'z', providerId: 'p', providerSpec: 'o/r', skillPath: 's', version: 'v', installedAt: 't' },
        { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 's', version: 'v', installedAt: 't' },
      ],
      scopes: { k: ['web', 'api'] },
    })
    expect(stored.providers.map((p) => p.id)).toEqual(['a', 'b'])
    expect(stored.installed.map((r) => r.name)).toEqual(['a', 'z'])
    expect(stored.scopes).toEqual({ k: ['web', 'api'] })
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored)
  })
})

describe('record parsers', () => {
  it('parseProviderRecord defaults addedAt to empty', () => {
    expect(parseProviderRecord({ id: 'a', spec: 'a/r' })).toEqual({ id: 'a', spec: 'a/r', addedAt: '' })
    expect(parseProviderRecord({ id: 'a' })).toBeUndefined()
  })
  it('parseInstalledRecord requires every field', () => {
    const good = { name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 's', version: 'v', installedAt: 't' }
    expect(parseInstalledRecord(good)).toEqual(good)
    for (const key of Object.keys(good)) {
      const broken = { ...good }
      delete (broken as Record<string, unknown>)[key]
      expect(parseInstalledRecord(broken)).toBeUndefined()
    }
  })
})
