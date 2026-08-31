/**
 * The settings-document mirror: pure render/parse/encode coverage for
 * core/mirror.ts, plus service-level write-through (every mutation updates
 * the `cc-plugins` section) and reconcile (a shared document seeds a fresh
 * machine: missing marketplaces added, missing installs installed, model
 * mappings adopted; removals never inferred).
 */
import { describe, expect, it } from 'vitest'
import type { FetchLike, InstalledPlugin } from '../src/core/types.ts'
import {
  decodeTarget,
  encodeTarget,
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

describe('mirror target encoding', () => {
  it('round-trips global and workspace targets', () => {
    expect(encodeTarget({ scope: 'global' })).toBe('global')
    expect(encodeTarget({ scope: 'workspace', workspacePath: '/w1' })).toBe('workspace:/w1')
    expect(decodeTarget('global')).toEqual({ scope: 'global' })
    expect(decodeTarget('workspace:/w1')).toEqual({ scope: 'workspace', workspacePath: '/w1' })
  })

  it('rejects malformed target strings', () => {
    expect(decodeTarget('workspace:')).toBeUndefined()
    expect(decodeTarget('nonsense')).toBeUndefined()
    expect(decodeTarget('')).toBeUndefined()
  })
})

describe('renderMirror', () => {
  const installed = [{
    key: 'github:o/r/team-tools',
    marketplaceSpec: 'o/r',
    pluginName: 'team-tools',
    targets: [
      { scope: 'workspace', workspacePath: '/w1', skills: [] },
      { scope: 'global', skills: [] },
    ],
  }] as unknown as InstalledPlugin[]

  it('sorts marketplaces and installs, encodes targets, words inherit', () => {
    expect(renderMirror({
      marketplaces: [{ spec: 'o/second' }, { spec: 'o/first' }],
      installed,
      models: { haiku: 'dsh-fast', sonnet: null },
    })).toEqual({
      marketplaces: ['o/first', 'o/second'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools', targets: ['global', 'workspace:/w1'] }],
      models: { haiku: 'dsh-fast', sonnet: MIRROR_INHERIT },
    })
  })
})

describe('parseMirror', () => {
  it('keeps well-formed entries and drops junk', () => {
    expect(parseMirror({
      marketplaces: ['o/r', 42, ''],
      installs: [
        { marketplace: 'o/r', plugin: 'a', targets: ['global', 7] },
        { marketplace: 'o/r' },
        'junk',
      ],
      models: { haiku: 'dsh-fast', sonnet: MIRROR_INHERIT, opus: 42 },
    })).toEqual({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'a', targets: ['global'] }],
      models: { haiku: 'dsh-fast', sonnet: MIRROR_INHERIT },
    })
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

function makeFixture(seed: Record<string, string> = {}): Fixture {
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
  })
  return { fs, gh, service, mirror }
}

describe('CcMarketplaceService settings mirror write-through', () => {
  it('mirrors marketplaces and installs after every mutation', async () => {
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
      targets: [{ scope: 'global' }, { scope: 'workspace', workspacePath: '/w1' }],
    })
    expect(ok.ok).toBe(true)
    expect(f.mirror.writes.at(-1)).toEqual({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools', targets: ['global', 'workspace:/w1'] }],
      models: {},
    })

    // A per-target uninstall shrinks the mirrored targets; the last one
    // removes the entry.
    await f.service.uninstallPlugin('github:o/r/team-tools', { scope: 'global' })
    expect(f.mirror.writes.at(-1)?.installs[0].targets).toEqual(['workspace:/w1'])
    await f.service.uninstallPlugin('github:o/r/team-tools', { scope: 'workspace', workspacePath: '/w1' })
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
  it('adopts missing marketplaces, installs, and model mappings', async () => {
    const f = makeFixture({ '/w1/.keep': '' })
    f.mirror.set({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools', targets: ['global', 'workspace:/w1'] }],
      models: { haiku: 'dsh-fast', sonnet: MIRROR_INHERIT },
    })
    const report = await f.service.reconcileFromMirror()
    expect(report).toEqual({ marketplacesAdded: ['o/r'], installed: ['github:o/r/team-tools'], skipped: [] })

    const state = await f.service.state()
    expect(state.marketplaces).toHaveLength(1)
    const record = state.installed[0]
    expect(record.targets).toHaveLength(2)
    expect(record.targets.map((t) => (t.scope === 'global' ? 'global' : t.workspacePath)).sort()).toEqual(['/w1', 'global'])
    expect(f.fs.has('/home/u/.agents/skills/deploy/SKILL.md')).toBe(true)
    expect(f.fs.has('/w1/.agents/skills/deploy/SKILL.md')).toBe(true)
    // Model mappings were adopted, inherit word decoded back to null.
    expect(state.agentModelMap).toEqual({ haiku: 'dsh-fast' })
    expect(state.agentModelOverrides).toEqual({ haiku: 'dsh-fast', sonnet: null })
  })

  it('skips missing workspace paths, unknown marketplaces, and failed adds', async () => {
    const f = makeFixture()
    f.mirror.set({
      marketplaces: ['o/r', 'o/missing'],
      installs: [
        { marketplace: 'o/r', plugin: 'team-tools', targets: ['workspace:/nope'] },
        { marketplace: 'o/ghost', plugin: 'x', targets: ['global'] },
      ],
      models: {},
    })
    const report = await f.service.reconcileFromMirror()
    expect(report.marketplacesAdded).toEqual(['o/r'])
    expect(report.installed).toEqual([])
    expect(report.skipped.length).toBe(4)
    expect(report.skipped.join('\n')).toContain('workspace path missing')
    expect(report.skipped.join('\n')).toContain('no usable targets')
    expect(report.skipped.join('\n')).toContain('marketplace not configured')
    expect(report.skipped.join('\n')).toContain('o/missing')
    expect((await f.service.state()).installed).toEqual([])
  })

  it('is a no-op when everything is already present, and keeps saved models', async () => {
    const f = makeFixture({ '/w1/.keep': '' })
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    await f.service.setAgentModelOverrides({ haiku: 'local-choice' })
    const writesBefore = f.mirror.writes.length

    f.mirror.set({
      marketplaces: ['o/r'],
      installs: [{ marketplace: 'o/r', plugin: 'team-tools', targets: ['global'] }],
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
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    const writesBefore = f.mirror.writes.length

    // The document carries nothing (fresh machine's yaml, or the section was
    // deleted): reconcile writes the section once from local state.
    f.mirror.set(undefined)
    const report = await f.service.reconcileFromMirror()
    expect(report).toEqual({ marketplacesAdded: [], installed: [], skipped: [] })
    expect(f.mirror.writes.length).toBe(writesBefore + 1)
    expect(f.mirror.writes.at(-1)?.installs).toEqual([
      { marketplace: 'o/r', plugin: 'team-tools', targets: ['global'] },
    ])

    // The next reconcile sees the backfilled section and writes nothing more.
    await f.service.reconcileFromMirror()
    expect(f.mirror.writes.length).toBe(writesBefore + 1)
  })
})
