/**
 * Install-target helpers: identity, RPC argument validation, and the
 * migration of pre-targets registry records. Pure core coverage for
 * `core/targets.ts`.
 */
import { describe, expect, it } from 'vitest'
import { normalizeInstalledFile, normalizeInstalledRecord, parseTargets, targetId, targetLabel } from '../src/core/targets.ts'

describe('targetId / targetLabel', () => {
  it('identifies global as the empty string and workspace by path', () => {
    expect(targetId({ scope: 'global' })).toBe('')
    expect(targetId({ scope: 'workspace', workspacePath: '/w1' })).toBe('/w1')
    expect(targetId({ scope: 'workspace' })).toBe('')
  })

  it('labels Global and resolves workspace titles', () => {
    const ws = [{ path: '/w1', title: 'Project One' }]
    expect(targetLabel('', ws)).toBe('Global')
    expect(targetLabel('/w1', ws)).toBe('Project One')
    expect(targetLabel('/unknown', ws)).toBe('/unknown')
  })
})

describe('parseTargets', () => {
  it('accepts a mixed global/workspace list in order', () => {
    expect(parseTargets([{ scope: 'global' }, { scope: 'workspace', workspacePath: '/w1' }])).toEqual({
      targets: [{ scope: 'global' }, { scope: 'workspace', workspacePath: '/w1' }],
    })
  })

  it('rejects an empty list, non-arrays, and workspace targets without a path', () => {
    expect('error' in parseTargets([])).toBe(true)
    expect('error' in parseTargets('global')).toBe(true)
    expect('error' in parseTargets([{ scope: 'workspace' }])).toBe(true)
    expect('error' in parseTargets([42])).toBe(true)
  })

  it('rejects duplicate targets', () => {
    expect('error' in parseTargets([{ scope: 'global' }, { scope: 'global' }])).toBe(true)
    expect('error' in parseTargets([
      { scope: 'workspace', workspacePath: '/w1' },
      { scope: 'workspace', workspacePath: '/w1' },
    ])).toBe(true)
  })
})

describe('normalizeInstalledRecord', () => {
  const LEGACY = {
    key: 'github:o/r/team-tools',
    marketplaceId: 'github:o/r',
    marketplaceSpec: 'o/r',
    pluginName: 'team-tools',
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scope: 'workspace',
    workspacePath: '/w1',
    skills: [{ name: 'deploy', directory: '/w1/.agents/skills/deploy' }],
    mcpServers: [],
    agents: [],
    pending: { commands: ['ship'], hookEvents: [] },
  }

  it('wraps a legacy single-scope record into one target', () => {
    const record = normalizeInstalledRecord(LEGACY)
    expect(record?.targets).toEqual([{ scope: 'workspace', workspacePath: '/w1', skills: LEGACY.skills }])
    expect(record?.pending).toEqual({ commands: ['ship'], hookEvents: [] })
  })

  it('keeps an already-migrated record intact', () => {
    const migrated = { ...LEGACY, targets: [{ scope: 'global', skills: [] }] }
    const record = normalizeInstalledRecord(migrated)
    expect(record?.targets).toEqual([{ scope: 'global', skills: [] }])
  })

  it('drops corrupt records and non-objects', () => {
    expect(normalizeInstalledRecord(null)).toBeUndefined()
    expect(normalizeInstalledRecord('nope')).toBeUndefined()
    expect(normalizeInstalledRecord({ pluginName: 'x' })).toBeUndefined() // no key
    // A workspace target without a path is dropped; the record survives on
    // its remaining target.
    const mixed = normalizeInstalledRecord({ ...LEGACY, targets: [{ scope: 'workspace', skills: [] }, { scope: 'global', skills: [] }] })
    expect(mixed?.targets).toEqual([{ scope: 'global', skills: [] }])
  })
})

describe('normalizeInstalledFile', () => {
  it('returns an empty file for junk and migrates every record', () => {
    expect(normalizeInstalledFile(null)).toEqual({ plugins: [] })
    expect(normalizeInstalledFile([])).toEqual({ plugins: [] })
    expect(normalizeInstalledFile({})).toEqual({ plugins: [] })
    const file = normalizeInstalledFile({
      plugins: [
        { key: 'k', pluginName: 'p', scope: 'global', skills: [] },
        'garbage',
      ],
    })
    expect(file.plugins).toHaveLength(1)
    expect(file.plugins[0].targets).toEqual([{ scope: 'global', skills: [] }])
  })
})
