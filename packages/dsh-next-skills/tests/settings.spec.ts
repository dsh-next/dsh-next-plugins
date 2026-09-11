import { describe, expect, it } from 'vitest'
import {
  configForStorage,
  emptySkillsConfig,
  normalizeSkillsConfig,
  parseInstalledRecord,
  parseProviderRecord,
} from '../src/core/settings.ts'

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
  it('ignores every legacy scope shape', () => {
    const config = normalizeSkillsConfig({
      scopes: {
        off: [],
        legacy: { kind: 'workspaces', workspacePaths: ['/x/legacy'] },
        junk: { kind: 'wat' },
        globalMarker: { kind: 'global' },
      },
    })
    expect(config).toEqual({ providers: [], installations: [] })
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
    })
    expect(stored.providers.map((p) => p.id)).toEqual(['a', 'b'])
    expect(stored.installations.map((r) => r.name)).toEqual(['a', 'z'])
    expect(Object.keys(stored).sort()).toEqual(['installations', 'providers'])
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored)
  })
})

describe('defensive settings boundaries', () => {
  it.each([null, undefined, false, 1, 'junk', []])('rejects non-record input %j', (raw) => {
    expect(parseProviderRecord(raw)).toBeUndefined()
    expect(parseInstalledRecord(raw)).toBeUndefined()
    expect(normalizeSkillsConfig(raw)).toEqual(emptySkillsConfig())
  })
  it('normalizes invalid sections and keeps each fresh configuration independent', () => {
    expect(normalizeSkillsConfig({ providers: {}, installations: 'junk', scopes: ['off'] })).toEqual(emptySkillsConfig())
    const first = emptySkillsConfig()
    first.providers.push({ id: 'o-r', spec: 'o/r', addedAt: '' })
    expect(emptySkillsConfig()).toEqual({ providers: [], installations: [] })
  })
  it('sorts copies without mutating input and strips stale scope data on storage', () => {
    const raw = {
      providers: [{ id: 'z', spec: 'z/r', addedAt: '' }, { id: 'a', spec: 'a/r', addedAt: '' }],
      installations: [{ name: 'z', providerId: 'z', providerSpec: 'z/r', skillPath: 'z' }, { name: 'a', providerId: 'a', providerSpec: 'a/r', skillPath: 'a' }],
      scopes: { z: [] },
    }
    const before = JSON.stringify(raw)
    expect(normalizeSkillsConfig(raw).installations.map((r) => r.name)).toEqual(['a', 'z'])
    expect(configForStorage(raw)).not.toHaveProperty('scopes')
    expect(JSON.stringify(raw)).toBe(before)
  })
  it('rejects empty or wrongly typed required fields, defaulting only addedAt', () => {
    for (const bad of ['', null, 1, false, []]) {
      for (const key of ['id', 'spec']) expect(parseProviderRecord({ id: 'o-r', spec: 'o/r', [key]: bad })).toBeUndefined()
      for (const key of ['name', 'providerId', 'providerSpec', 'skillPath']) expect(parseInstalledRecord({ name: 'foo', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'foo', [key]: bad })).toBeUndefined()
    }
    expect(parseProviderRecord({ id: 'o-r', spec: 'o/r', addedAt: 1 })).toEqual({ id: 'o-r', spec: 'o/r', addedAt: '' })
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
