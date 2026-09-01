/**
 * Installed-record migration: current-shape passthrough plus the older
 * registry forms (multi-target `targets` array, legacy single-scope trio)
 * folded into the either/or scope shape. Pure core coverage for
 * `core/records.ts`.
 */
import { describe, expect, it } from 'vitest'
import { normalizeInstalledFile, normalizeInstalledRecord } from '../src/core/records.ts'

const BASE = {
  key: 'github:o/r/team-tools',
  marketplaceId: 'github:o/r',
  marketplaceSpec: 'o/r',
  pluginName: 'team-tools',
  version: '1.0.0',
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  mcpServers: [],
  agents: [],
}

const GLOBAL_SKILLS = [{ name: 'deploy', directory: '/home/u/.agents/skills/deploy' }]
const W1_SKILLS = [{ name: 'deploy', directory: '/w1/.agents/skills/deploy' }]

describe('normalizeInstalledRecord: current shape', () => {
  it('passes a global-scope record through', () => {
    const record = normalizeInstalledRecord({ ...BASE, scope: { kind: 'global' }, skills: GLOBAL_SKILLS, pending: { commands: ['ship'], hookEvents: [] } })
    expect(record?.scope).toEqual({ kind: 'global' })
    expect(record?.skills).toEqual(GLOBAL_SKILLS)
    expect(record?.pending).toEqual({ commands: ['ship'], hookEvents: [] })
  })

  it('passes a workspace-scope record through', () => {
    const record = normalizeInstalledRecord({ ...BASE, scope: { kind: 'workspaces', workspacePaths: ['/w1', '/w2'] }, skills: W1_SKILLS })
    expect(record?.scope).toEqual({ kind: 'workspaces', workspacePaths: ['/w1', '/w2'] })
  })

  it('falls back to the legacy path when the scope object is malformed', () => {
    // A corrupt scope object must not wedge the record: the targets form
    // below still migrates it.
    const record = normalizeInstalledRecord({ ...BASE, scope: 'junk', skills: [], targets: [{ scope: 'global', skills: GLOBAL_SKILLS }] })
    expect(record?.scope).toEqual({ kind: 'global' })
    expect(record?.skills).toEqual(GLOBAL_SKILLS)
  })
})

describe('normalizeInstalledRecord: multi-target migration', () => {
  it('keeps global wins when a record mixed global and workspace targets', () => {
    const record = normalizeInstalledRecord({
      ...BASE,
      targets: [{ scope: 'global', skills: GLOBAL_SKILLS }, { scope: 'workspace', workspacePath: '/w1', skills: W1_SKILLS }],
    })
    expect(record?.scope).toEqual({ kind: 'global' })
    expect(record?.skills).toEqual(GLOBAL_SKILLS)
  })

  it('turns workspace-only targets into a workspace scope', () => {
    const record = normalizeInstalledRecord({
      ...BASE,
      targets: [
        { scope: 'workspace', workspacePath: '/w1', skills: W1_SKILLS },
        { scope: 'workspace', workspacePath: '/w2', skills: [{ name: 'deploy', directory: '/w2/.agents/skills/deploy' }] },
      ],
    })
    expect(record?.scope).toEqual({ kind: 'workspaces', workspacePaths: ['/w1', '/w2'] })
    expect(record?.skills).toHaveLength(2)
  })

  it('drops a pathless workspace target but keeps the record on the rest', () => {
    const record = normalizeInstalledRecord({
      ...BASE,
      targets: [{ scope: 'workspace', skills: [] }, { scope: 'global', skills: GLOBAL_SKILLS }],
    })
    expect(record?.scope).toEqual({ kind: 'global' })
    expect(record?.skills).toEqual(GLOBAL_SKILLS)
  })
})

describe('normalizeInstalledRecord: legacy single-scope trio', () => {
  it('wraps a legacy global trio into the global scope', () => {
    const record = normalizeInstalledRecord({ ...BASE, scope: 'global', skills: GLOBAL_SKILLS })
    expect(record?.scope).toEqual({ kind: 'global' })
    expect(record?.skills).toEqual(GLOBAL_SKILLS)
  })

  it('wraps a legacy workspace trio into a workspace scope over its path', () => {
    const record = normalizeInstalledRecord({ ...BASE, scope: 'workspace', workspacePath: '/legacy', skills: [{ name: 'deploy', directory: '/legacy/.agents/skills/deploy' }] })
    expect(record?.scope).toEqual({ kind: 'workspaces', workspacePaths: ['/legacy'] })
    expect(record?.skills).toEqual([{ name: 'deploy', directory: '/legacy/.agents/skills/deploy' }])
  })

  it('drops corrupt records and rows with no install form at all', () => {
    expect(normalizeInstalledRecord(null)).toBeUndefined()
    expect(normalizeInstalledRecord('nope')).toBeUndefined()
    expect(normalizeInstalledRecord({ pluginName: 'x' })).toBeUndefined() // no key
    expect(normalizeInstalledRecord({ ...BASE })).toBeUndefined() // no scope, no targets, no trio
  })

  it('keeps a recognized install form alive even with no skills (component-only plugins)', () => {
    // A bare legacy global trio: kept, skills empty.
    const legacy = normalizeInstalledRecord({ ...BASE, scope: 'global', skills: [] })
    expect(legacy?.scope).toEqual({ kind: 'global' })
    expect(legacy?.skills).toEqual([])
    // A current-shape global scope: kept the same way.
    const current = normalizeInstalledRecord({ ...BASE, scope: { kind: 'global' }, skills: [] })
    expect(current?.scope).toEqual({ kind: 'global' })
    expect(current?.skills).toEqual([])
    // A targets-form global entry with empty skills: kept too.
    const target = normalizeInstalledRecord({ ...BASE, targets: [{ scope: 'global', skills: [] }] })
    expect(target?.scope).toEqual({ kind: 'global' })
  })

  it('keeps a record with no install form alive on plugin-level components', () => {
    const record = normalizeInstalledRecord({
      ...BASE,
      mcpServers: [{ rowId: 'r', serverName: 'linear', claudeName: 'linear', def: { transport: 'stdio', command: 'x', args: [], env: {} } }],
    })
    expect(record?.scope).toEqual({ kind: 'global' })
    expect(record?.skills).toEqual([])
    expect(record?.mcpServers).toHaveLength(1)
  })
})

describe('normalizeInstalledRecord field passthrough', () => {
  const base = { ...BASE, scope: { kind: 'global' } as const, skills: GLOBAL_SKILLS }

  it('keeps a string snapshotDigest and drops non-string values', () => {
    expect(normalizeInstalledRecord({ ...base, snapshotDigest: 'd'.repeat(64) })?.snapshotDigest).toBe('d'.repeat(64))
    expect(normalizeInstalledRecord({ ...base, snapshotDigest: 7 })?.snapshotDigest).toBeUndefined()
    expect(normalizeInstalledRecord({ ...base })?.snapshotDigest).toBeUndefined()
  })

  it('keeps string notes and drops non-strings or empty lists', () => {
    expect(normalizeInstalledRecord({ ...base, notes: ['a', 7, 'b'] })?.notes).toEqual(['a', 'b'])
    expect(normalizeInstalledRecord({ ...base, notes: [] })?.notes).toBeUndefined()
    expect(normalizeInstalledRecord({ ...base, notes: 'x' })?.notes).toBeUndefined()
  })
})

describe('normalizeInstalledFile', () => {
  it('returns an empty file for junk and migrates every record', () => {
    expect(normalizeInstalledFile(null)).toEqual({ plugins: [] })
    expect(normalizeInstalledFile([])).toEqual({ plugins: [] })
    expect(normalizeInstalledFile({})).toEqual({ plugins: [] })
    const file = normalizeInstalledFile({
      plugins: [
        { ...BASE, scope: 'global', skills: [] }, // recognized form: kept
        { ...BASE, key: 'k2', pluginName: 'p2', targets: [{ scope: 'global', skills: GLOBAL_SKILLS }] },
        'garbage',
      ],
    })
    expect(file.plugins).toHaveLength(2)
    expect(file.plugins.map((p) => p.key).sort()).toEqual(['github:o/r/team-tools', 'k2'])
    expect(file.plugins[1].scope).toEqual({ kind: 'global' })
  })
})
