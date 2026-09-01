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
  it('parses workspaces whitelists and trims/dedupes paths', () => {
    const scope = parseScopeSetting({ kind: 'workspaces', workspacePaths: [' /a ', '/a', '', '/b'] })
    expect(scope).toEqual({ kind: 'workspaces', workspacePaths: ['/a', '/b'] })
  })
  it('falls back to global for junk shapes', () => {
    expect(parseScopeSetting(undefined)).toEqual({ kind: 'global' })
    expect(parseScopeSetting(null)).toEqual({ kind: 'global' })
    expect(parseScopeSetting({ kind: 'galaxy' })).toEqual({ kind: 'global' })
    expect(parseScopeSetting({ kind: 'workspaces' })).toEqual({ kind: 'workspaces', workspacePaths: [] })
    expect(parseScopeSetting({ kind: 'workspaces', workspacePaths: 'nope' })).toEqual({ kind: 'workspaces', workspacePaths: [] })
  })
})

describe('isScopeEnabled', () => {
  it('treats absent and global scopes as enabled everywhere', () => {
    expect(isScopeEnabled(undefined, '/a')).toBe(true)
    expect(isScopeEnabled(undefined, undefined)).toBe(true)
    expect(isScopeEnabled({ kind: 'global' }, '/a')).toBe(true)
    expect(isScopeEnabled({ kind: 'global' }, undefined)).toBe(true)
  })
  it('enables a whitelist only inside its workspaces', () => {
    const scope = { kind: 'workspaces' as const, workspacePaths: ['/repo/a', '/repo/b'] }
    expect(isScopeEnabled(scope, '/repo/a')).toBe(true)
    expect(isScopeEnabled(scope, '/repo/b/')).toBe(true)
    expect(isScopeEnabled(scope, '/repo/c')).toBe(false)
  })
  it('an empty whitelist disables everywhere, including without a cwd', () => {
    const scope = { kind: 'workspaces' as const, workspacePaths: [] }
    expect(isScopeEnabled(scope, '/repo/a')).toBe(false)
    expect(isScopeEnabled(scope, undefined)).toBe(false)
  })
  it('a whitelist never enables for an undefined cwd', () => {
    const scope = { kind: 'workspaces' as const, workspacePaths: ['/repo/a'] }
    expect(isScopeEnabled(scope, undefined)).toBe(false)
    expect(isScopeEnabled(scope, '')).toBe(false)
  })
  it('normalizes trailing slashes for comparisons', () => {
    expect(normalizePathForCompare('/repo/a/')).toBe('/repo/a')
    expect(isScopeEnabled({ kind: 'workspaces', workspacePaths: ['/repo/a/'] }, '/repo/a')).toBe(true)
  })
})

describe('scopeForName', () => {
  it('reads the stored scope and normalizes it', () => {
    const scopes = { foo: { kind: 'workspaces', workspacePaths: ['/a', 42] } } as unknown as SkillsConfig['scopes']
    expect(scopeForName(scopes, 'foo')).toEqual({ kind: 'workspaces', workspacePaths: ['/a'] })
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
        { id: 'github.com/o/r', spec: 'o/r', addedAt: 't' },
        { id: '', spec: 'x' },
        { spec: 'no-id' },
        'junk',
      ],
    })
    expect(config.providers).toEqual([{ id: 'github.com/o/r', spec: 'o/r', addedAt: 't' }])
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
  it('keeps only workspaces whitelist scopes', () => {
    const config = normalizeSkillsConfig({
      scopes: {
        off: { kind: 'workspaces', workspacePaths: [] },
        junk: { kind: 'wat' },
        fine: { kind: 'global' },
      },
    })
    expect(config.scopes).toEqual({ off: { kind: 'workspaces', workspacePaths: [] } })
  })
  it('drops installed records whose provider vanished is NOT done here (records are independent)', () => {
    const config = normalizeSkillsConfig({
      providers: [],
      installed: [{ name: 'a', providerId: 'p', providerSpec: 'o/r', skillPath: 's', version: 'v', installedAt: 't' }],
    })
    expect(config.installed).toHaveLength(1)
  })
})

describe('withScope', () => {
  it('sets, replaces, and clears entries without mutating the input', () => {
    const base = { a: { kind: 'workspaces', workspacePaths: ['/a'] } } as SkillsConfig['scopes']
    const withB = withScope(base, 'b', { kind: 'global' })
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
      scopes: { k: { kind: 'workspaces', workspacePaths: ['/a'] } },
    })
    expect(stored.providers.map((p) => p.id)).toEqual(['a', 'b'])
    expect(stored.installed.map((r) => r.name)).toEqual(['a', 'z'])
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
