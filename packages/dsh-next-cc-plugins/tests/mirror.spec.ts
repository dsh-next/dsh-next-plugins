/**
 * The settings-document mirror: pure render/parse coverage for
 * core/mirror.ts (including the legacy `targets` tolerance), plus
 * service-level write-through (every mutation updates the `cc-plugins`
 * section) and reconcile (a shared document seeds a fresh machine:
 * missing marketplaces added, missing installs installed into their
 * recorded scope, model mappings adopted; removals never inferred).
 */
import { describe, expect, it } from 'vitest'
import type { FetchLike, InstalledPlugin } from '../src/core/types.ts'
import {
  classifyMirrorWorkspace,
  MIRROR_INHERIT,
  parseMirror,
  renderMirror,
  type MirrorSection,
  type SettingsMirror,
} from '../src/core/mirror.ts'
import { CcMarketplaceService } from '../src/host/service.ts'
import { createGhDouble } from './helpers/gh.ts'
import { createMemFs, type MemFs } from './helpers/memfs.ts'

const SKILL = (name: string): string => `---\nname: ${name}\ndescription: does things\n---\nbody\n`

const TEAM_TOOLS: Record<string, string> = {
  '.claude-plugin/marketplace.json': JSON.stringify({
    name: 'acme-tools',
    plugins: [{ name: 'team-tools', description: 'Tools', version: '1.0.0', source: './plugins/team-tools' }],
  }),
  'plugins/team-tools/skills/deploy/SKILL.md': SKILL('deploy'),
}

describe('mirror workspace classification', () => {
  it('separates folder names from absolute paths and drops junk', () => {
    expect(classifyMirrorWorkspace('web')).toEqual({ kind: 'name', name: 'web' })
    expect(classifyMirrorWorkspace('/abs/path')).toEqual({ kind: 'path', path: '/abs/path' })
    expect(classifyMirrorWorkspace('  ')).toBeUndefined()
    expect(classifyMirrorWorkspace('')).toBeUndefined()
  })
})

describe('renderMirror', () => {
  it('sorts marketplaces and installs, omits workspaces for global, words inherit', () => {
    const installed = [
      { marketplaceSpec: 'o/r', pluginName: 'team-tools', scope: { kind: 'global' } },
      { marketplaceSpec: 'o/r', pluginName: 'ws-tools', scope: { kind: 'workspaces', workspacePaths: ['/Users/x/Projects/web', '/Users/x/Projects/data'] } },
    ] as unknown as InstalledPlugin[]
    expect(renderMirror({
      marketplaces: [{ spec: 'o/second' }, { spec: 'o/first' }],
      installed,
      models: { haiku: 'dsh-fast', sonnet: null },
    })).toEqual({
      marketplaces: ['o/first', 'o/second'],
      installs: [
        { marketplace: 'o/r', plugin: 'team-tools' },
        { marketplace: 'o/r', plugin: 'ws-tools', workspaces: ['data', 'web'] },
      ],
      models: { haiku: 'dsh-fast', sonnet: MIRROR_INHERIT },
    })
  })
})

describe('parseMirror', () => {
  it('keeps well-formed entries and drops junk', () => {
    expect(parseMirror({
      marketplaces: ['o/r', 42, ''],
      installs: [
        { marketplace: 'o/r', plugin: 'a', workspaces: ['web', 7, ''] },
        { marketplace: 'o/r' },
        'junk',
      ],
      models: { haiku: 'dsh-fast', sonnet: MIRROR_INHERIT, opus: 42 },
    })).toEqual({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'a', workspaces: ['web'] }],
      models: { haiku: 'dsh-fast', sonnet: MIRROR_INHERIT },
    })
  })

  it('honors legacy targets lists: global wins, otherwise names become the workspace set', () => {
    expect(parseMirror({
      installs: [{ marketplace: 'o/r', plugin: 'mixed', targets: ['global', 'workspace:web'] }],
    }).installs[0]).toEqual({ marketplace: 'o/r', plugin: 'mixed' })
    expect(parseMirror({
      installs: [{ marketplace: 'o/r', plugin: 'ws', targets: ['workspace:web', 'workspace:/abs/data', 'bogus'] }],
    }).installs[0]).toEqual({ marketplace: 'o/r', plugin: 'ws', workspaces: ['data', 'web'] })
    // No workspace entries at all: the install reads as global.
    expect(parseMirror({
      installs: [{ marketplace: 'o/r', plugin: 'g', targets: ['global'] }],
    }).installs[0]).toEqual({ marketplace: 'o/r', plugin: 'g' })
  })

  it('returns an empty section for non-object input', () => {
    for (const raw of [undefined, null, 'x', [], 42]) {
      expect(parseMirror(raw)).toEqual({ marketplaces: [], installs: [], models: {} })
    }
  })
})

// ---------------------------------------------------------------------------
// Service-level: write-through and reconcile
// ---------------------------------------------------------------------------

interface MirrorDouble {
  mirror: SettingsMirror
  writes: MirrorSection[]
  set: (value: unknown) => void
}

function makeMirror(seed: unknown = undefined): MirrorDouble {
  let current = seed
  const writes: MirrorSection[] = []
  return {
    mirror: {
      read: () => current,
      write: async (section) => {
        writes.push(section)
        current = JSON.parse(JSON.stringify(section)) as MirrorSection
      },
    },
    writes,
    set: (value: unknown) => { current = value },
  }
}

interface Fixture {
  fs: MemFs
  gh: ReturnType<typeof createGhDouble>
  service: CcMarketplaceService
  mirror: MirrorDouble
}

function makeFixture(
  seed: Record<string, string> = {},
  over: { resolveWorkspace?: (name: string) => Promise<string | undefined> } = {},
): Fixture {
  const fs = createMemFs(seed)
  const gh = createGhDouble({ 'o/r': TEAM_TOOLS })
  const mirror = makeMirror()
  const service = new CcMarketplaceService({
    fs,
    fetch: gh.fetch as FetchLike,
    dshHome: '/home/u/.dsh',
    agentsHome: '/home/u/.agents',
    home: '/home/u',
    cordisPatchPath: '/home/u/.dsh/cordis.patch.yml',
    settings: mirror.mirror,
    resolveWorkspace: over.resolveWorkspace,
  })
  return { fs, gh, service, mirror }
}

describe('CcMarketplaceService settings mirror write-through', () => {
  it('mirrors marketplaces and installs with their scope after every mutation', async () => {
    const f = makeFixture({ '/w1/.keep': '' })
    await f.service.addMarketplace('o/r')
    expect(f.mirror.writes.at(-1)).toEqual({
      marketplaces: ['o/r'],
      installs: [],
      models: {},
    })

    const ok = await f.service.installPlugin({
      marketplaceId: 'github:o/r',
      plugin: 'team-tools',
      scope: { kind: 'workspaces', workspacePaths: ['/w1'] },
    })
    expect(ok.ok).toBe(true)
    // Workspace scopes mirror as folder names: paths differ per machine.
    expect(f.mirror.writes.at(-1)).toEqual({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools', workspaces: ['w1'] }],
      models: {},
    })

    // Re-scoping to global rewrites the entry without workspaces.
    await f.service.setPluginScope('github:o/r/team-tools', { kind: 'global' })
    expect(f.mirror.writes.at(-1)?.installs).toEqual([{ marketplace: 'o/r', plugin: 'team-tools' }])

    // Uninstall removes the entry.
    await f.service.uninstallPlugin('github:o/r/team-tools')
    expect(f.mirror.writes.at(-1)?.installs).toEqual([])
  })

  it('mirrors model overrides with the inherit word', async () => {
    const f = makeFixture()
    await f.service.setAgentModelOverrides({ haiku: 'dsh-fast', sonnet: null })
    expect(f.mirror.writes.at(-1)?.models).toEqual({ haiku: 'dsh-fast', sonnet: MIRROR_INHERIT })
  })

  it('never fails a mutation when the mirror write fails', async () => {
    const f = makeFixture()
    f.mirror.mirror.write = async () => { throw new Error('document locked') }
    const ok = await f.service.addMarketplace('o/r')
    expect(ok.ok).toBe(true)
  })
})

describe('CcMarketplaceService reconcileFromMirror', () => {
  it('adopts missing marketplaces, installs with their scope, and model mappings', async () => {
    const f = makeFixture({ '/w1/.keep': '' })
    f.mirror.set({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools', workspaces: ['/w1'] }],
      models: { haiku: 'dsh-fast', sonnet: MIRROR_INHERIT },
    })
    const report = await f.service.reconcileFromMirror()
    expect(report).toEqual({ marketplacesAdded: ['o/r'], installed: ['github:o/r/team-tools'], skipped: [] })

    const state = await f.service.state()
    const record = state.installed[0]
    expect(record.scope).toEqual({ kind: 'workspaces', workspacePaths: ['/w1'] })
    expect(f.fs.has('/w1/.agents/skills/deploy/SKILL.md')).toBe(true)
    expect(f.fs.has('/home/u/.agents/skills/deploy/SKILL.md')).toBe(false)
    // Model mappings were adopted, inherit word decoded back to null.
    expect(state.agentModelMap).toEqual({ haiku: 'dsh-fast' })
    expect(state.agentModelOverrides).toEqual({ haiku: 'dsh-fast', sonnet: null })
  })

  it('imports a global install when the entry carries no workspaces', async () => {
    const f = makeFixture({ '/w1/.keep': '' })
    f.mirror.set({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools' }],
      models: {},
    })
    const report = await f.service.reconcileFromMirror()
    expect(report.installed).toEqual(['github:o/r/team-tools'])
    expect((await f.service.state()).installed[0].scope).toEqual({ kind: 'global' })
    expect(f.fs.has('/home/u/.agents/skills/deploy/SKILL.md')).toBe(true)
  })

  it('resolves portable folder names through the workspace registry and skips unknown ones', async () => {
    const f = makeFixture(
      { '/home/u/Projects/web/.keep': '' },
      { resolveWorkspace: async (name) => (name === 'web' ? '/home/u/Projects/web' : undefined) },
    )
    f.mirror.set({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools', workspaces: ['web', 'ghost'] }],
      models: {},
    })
    const report = await f.service.reconcileFromMirror()
    // All-or-nothing: the unknown name skips the whole plugin with a note.
    expect(report.installed).toEqual([])
    expect(report.skipped).toEqual(['plugin team-tools: no workspace "ghost" registered on this machine'])
    expect((await f.service.state()).installed).toEqual([])
    expect((await f.service.state()).importSkipped).toEqual(report.skipped)
  })

  it('uses hand-written absolute workspace paths that exist locally', async () => {
    const f = makeFixture({ '/w1/.keep': '' })
    f.mirror.set({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools', workspaces: ['/w1', '/nope'] }],
      models: {},
    })
    const report = await f.service.reconcileFromMirror()
    expect(report.installed).toEqual([])
    expect(report.skipped.join('\n')).toContain('workspace path missing on this machine')
  })

  it('skips unknown marketplaces and failed adds', async () => {
    const f = makeFixture()
    f.mirror.set({
      marketplaces: ['o/r', 'o/missing'],
      installs: [{ marketplace: 'o/ghost', plugin: 'x' }],
      models: {},
    })
    const report = await f.service.reconcileFromMirror()
    expect(report.marketplacesAdded).toEqual(['o/r'])
    expect(report.installed).toEqual([])
    expect(report.skipped.length).toBe(2)
    expect(report.skipped.join('\n')).toContain('marketplace not configured')
    expect(report.skipped.join('\n')).toContain('o/missing')
    expect((await f.service.state()).importSkipped).toEqual(report.skipped)
  })

  it('is a no-op when everything is already present, and keeps saved models', async () => {
    const f = makeFixture()
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: { kind: 'global' } })
    await f.service.setAgentModelOverrides({ haiku: 'local-choice' })
    const writesBefore = f.mirror.writes.length

    f.mirror.set({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools' }],
      models: { haiku: 'from-document' },
    })
    const report = await f.service.reconcileFromMirror()
    expect(report).toEqual({ marketplacesAdded: [], installed: [], skipped: [] })
    // Nothing to adopt: no mirror write happened and the local model wins.
    expect(f.mirror.writes.length).toBe(writesBefore)
    expect((await f.service.state()).agentModelMap).toEqual({ haiku: 'local-choice' })
  })

  it('backfills an empty document from local state on boot', async () => {
    const f = makeFixture()
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: { kind: 'global' } })
    const writesBefore = f.mirror.writes.length

    // The document carries nothing (fresh machine's yaml, or the section was
    // deleted): reconcile writes the section once from local state.
    f.mirror.set(undefined)
    const report = await f.service.reconcileFromMirror()
    expect(report).toEqual({ marketplacesAdded: [], installed: [], skipped: [] })
    expect(f.mirror.writes.length).toBe(writesBefore + 1)
    expect(f.mirror.writes.at(-1)?.installs).toEqual([
      { marketplace: 'o/r', plugin: 'team-tools' },
    ])

    // The next reconcile sees the backfilled section and writes nothing more.
    await f.service.reconcileFromMirror()
    expect(f.mirror.writes.length).toBe(writesBefore + 1)
  })
})
