import { describe, expect, it } from 'vitest'
import type { FetchLike } from '../src/core/types.ts'
import { MANIFEST_FILE, SkillsService } from '../src/host/skills-service.ts'
import { createMemFs, type MemFs } from './helpers/memfs.ts'
import { createGhDouble, type GhDouble } from './helpers/gh.ts'
import { MemConfigFace } from './helpers/config-face.ts'

const SKILL = (name: string, extra = '') => `---\nname: ${name}\ndescription: ${name} skill\n${extra}---\nbody\n`

const CATALOG_FILES: Record<string, string> = {
  'skills/find-skills/SKILL.md': SKILL('find-skills'),
  'skills/find-skills/references/note.md': 'note',
  'skills/other-skill/SKILL.md': SKILL('other-skill'),
}

interface Harness {
  fs: MemFs
  gh: GhDouble
  service: SkillsService
  config: MemConfigFace
}

function makeHarness(seed: Record<string, string> = {}, configSection: Record<string, unknown> = {}): Harness {
  const fs = createMemFs(seed)
  const gh = createGhDouble({ files: CATALOG_FILES })
  const config = new MemConfigFace()
  config.setSection(configSection)
  const service = new SkillsService({
    fs,
    fetch: gh.fetch as FetchLike,
    dshHome: '/home/u/.dsh',
    agentsHome: '/home/u/.agents',
    config,
  })
  return { fs, gh, service, config }
}

/** Sync the catalog double so the provider cache holds the two skills. */
async function seedCatalog(h: Harness): Promise<void> {
  await h.service.addProvider('o/r')
}

describe('listInstalled / state', () => {
  it('enumerates bundle and flat skills from user roots', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/bundle-skill/SKILL.md': SKILL('bundle-skill'),
      '/home/u/.agents/skills/flat-skill.md': SKILL('flat-skill'),
      '/home/u/.agents/skills/broken/SKILL.md': '# no frontmatter',
    })
    const state = await h.service.state()
    expect(state.installed.map((s) => s.name)).toEqual(['bundle-skill', 'flat-skill'])
    expect(state.installed.find((s) => s.name === 'flat-skill')!.kind).toBe('flat')
    expect(state.installed.find((s) => s.name === 'bundle-skill')!.kind).toBe('bundle')
  })

  it('merges workspace skills above global on name collision', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/shared/SKILL.md': SKILL('shared'),
      '/repo/.agents/skills/shared/SKILL.md': SKILL('shared'),
    })
    const state = await h.service.state(['/repo'])
    const shared = state.installed.find((s) => s.name === 'shared')!
    expect(shared.scope).toBe('workspace')
  })

  it('skips the .system and .trash directories in the user-dsh root', async () => {
    const h = makeHarness({
      '/home/u/.dsh/skills/.system/SKILL.md': SKILL('system-skill'),
      '/home/u/.dsh/skills/.trash/1-x/SKILL.md': SKILL('trashed'),
    })
    const state = await h.service.state()
    expect(state.installed).toHaveLength(0)
  })

  it('a manifest without a settings record is custom, not managed', async () => {
    // settings.yaml is the single source managing installs: the manifest
    // sidecar never confers managed-ness on its own.
    const h = makeHarness({
      '/home/u/.agents/skills/find-skills/SKILL.md': SKILL('find-skills'),
      '/home/u/.agents/skills/find-skills/.dsh-next-provider.json': JSON.stringify({
        providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'old', installedAt: 't',
      }),
    })
    await seedCatalog(h)
    const state = await h.service.state()
    const row = state.installed.find((s) => s.name === 'find-skills')!
    expect(row.managed).toBe(false)
    expect(row.provider).toBeUndefined()
    expect(row.updateAvailable).toBeUndefined()
  })

  it('carries the config scope per name and the settings sections in the envelope', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/s/SKILL.md': SKILL('s'),
    }, {
      scopes: { s: ['repo'] },
    })
    const state = await h.service.state()
    expect(state.installed.find((x) => x.name === 's')!.configScope).toEqual(['repo'])
    expect(state.config.scopes.s).toBeDefined()
    expect(Array.isArray(state.providers)).toBe(true)
    expect(Array.isArray(state.catalog)).toBe(true)
  })

  it('treats a settings record as managed even when the manifest is missing', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/find-skills/SKILL.md': SKILL('find-skills'),
    }, {
      installed: [{ name: 'find-skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'v', installedAt: 't' }],
    })
    await seedCatalog(h)
    const row = (await h.service.state()).installed.find((s) => s.name === 'find-skills')!
    expect(row.managed).toBe(true)
    expect(row.provider).toBe('o/r')
  })
})

describe('installSkill (global-only)', () => {
  it('copies the skill into the global root, writes the manifest, and records it', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    const result = await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    expect(result.ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/find-skills/SKILL.md')).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/find-skills/references/note.md')).toBe(true)
    const manifest = JSON.parse(await h.fs.readFile(`/home/u/.agents/skills/find-skills/${MANIFEST_FILE}`))
    expect(manifest.providerSpec).toBe('o/r')
    expect(h.config.raw().installed).toEqual([
      expect.objectContaining({ name: 'find-skills', providerSpec: 'o/r', skillPath: 'skills/find-skills' }),
    ])
  })

  it('never installs into a workspace; the scope rides the settings config instead', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    const result = await h.service.installSkill({
      providerId: 'o-r', skillPath: 'skills/find-skills',
      workspaces: ['/Users/x/Projects/repo'],
    })
    expect(result.ok).toBe(true)
    expect(h.fs.has('/repo/.agents/skills/find-skills/SKILL.md')).toBe(false)
    expect((h.config.raw().scopes as Record<string, unknown>)['find-skills']).toEqual(['repo'])
  })

  it('refuses a duplicate install and unknown catalog entries', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    expect((await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })).ok).toBe(true)
    const dupe = await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    expect(dupe).toEqual({ ok: false, error: 'skill "find-skills" is already installed' })
    expect(await h.service.installSkill({ providerId: 'github.com/other/repo', skillPath: 'x' })).toMatchObject({ ok: false })
    expect(await h.service.installSkill({ providerId: 'o-r', skillPath: 'nope' })).toMatchObject({ ok: false })
  })
})

describe('setSkillScope (pure config)', () => {
  it('writes a whitelist scope without touching any file', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/s/SKILL.md': SKILL('s') })
    const before = h.fs.snapshot()
    const result = await h.service.setSkillScope({ name: 's', workspaces: ['/Users/x/Projects/repo'] })
    expect(result.ok).toBe(true)
    expect(h.fs.snapshot()).toEqual(before)
    expect((h.config.raw().scopes as Record<string, unknown>).s).toEqual(['repo'])
  })

  it('a global scope clears the entry (absent means everywhere)', async () => {
    const h = makeHarness({}, { scopes: { s: [] } })
    await h.service.setSkillScope({ name: 's', workspaces: null })
    expect(h.config.raw().scopes).toEqual({})
  })

  it('validates the skill name and workspace paths', async () => {
    const h = makeHarness()
    expect(await h.service.setSkillScope({ name: 'not a name' })).toMatchObject({ ok: false })
    await h.service.setSkillScope({ name: 'ok', workspaces: ['/x/repo', 'repo', 'other'] })
    expect((h.config.raw().scopes as Record<string, unknown>)['ok']).toEqual(['repo', 'other'])
  })
})

describe('updateSkill (managed, global)', () => {
  async function installedHarness(): Promise<Harness> {
    const h = makeHarness()
    await seedCatalog(h)
    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    return h
  }

  it('overwrites files, prunes dropped upstream files, and refreshes the record', async () => {
    const h = await installedHarness()
    h.gh.setFiles({ 'skills/find-skills/SKILL.md': SKILL('find-skills', 'updated: true\n') })
    await h.service.refreshProvider('o-r')
    expect((await h.service.updateSkill({ name: 'find-skills' })).ok).toBe(true)
    const content = await h.fs.readFile('/home/u/.agents/skills/find-skills/SKILL.md')
    expect(content).toContain('updated: true')
    expect(h.fs.has('/home/u/.agents/skills/find-skills/references/note.md')).toBe(false) // pruned
    const record = (h.config.raw().installed as Array<{ name: string; version: string }>)[0]
    expect(record.name).toBe('find-skills')
    const manifest = JSON.parse(await h.fs.readFile(`/home/u/.agents/skills/find-skills/${MANIFEST_FILE}`))
    expect(manifest.version).toBe(record.version)
  })

  it('refuses skills the settings section does not record', async () => {
    // A manifest sidecar alone proves nothing: the settings record is the
    // only proof of a plugin install.
    const h = makeHarness({
      '/home/u/.agents/skills/hand/SKILL.md': SKILL('hand'),
      '/home/u/.agents/skills/hand/.dsh-next-provider.json': JSON.stringify({
        providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'v', installedAt: 't',
      }),
    })
    await seedCatalog(h)
    expect(await h.service.updateSkill({ name: 'hand' })).toEqual({ ok: false, error: 'skill "hand" was not installed by the plugin' })
    expect(await h.service.updateSkill({ name: 'ghost' })).toEqual({ ok: false, error: 'skill "ghost" not found' })
    expect(await h.service.uninstallSkill({ name: 'hand' })).toEqual({ ok: false, error: 'skill "hand" was not installed by the plugin' })
  })
})

describe('remove (managed, global, recoverable)', () => {
  it('trashes the directory and drops the record and scope', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    await h.service.setSkillScope({ name: 'find-skills', workspaces: [] })
    await h.service.setSkillScope({ name: 'find-skills', workspaces: [] })
    expect((await h.service.uninstallSkill({ name: 'find-skills' })).ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/find-skills/SKILL.md')).toBe(false)
    expect(h.fs.has('/home/u/.agents/skills/.trash')).toBe(true)
    expect(h.config.raw().installed).toEqual([])
    expect(h.config.raw().scopes).toEqual({})
  })

  it('removes a legacy shadow outright', async () => {
    const shadow = `---\nname: s\ndescription: s skill\ndisable-model-invocation: true\nuser-invocable: false\n---\n<!-- dsh-next-skills:workspace-shadow -->\n`
    const h = makeHarness({
      '/home/u/.agents/skills/s/SKILL.md': shadow,
    }, { installed: [{ name: 's', providerId: 'p', providerSpec: 'o/r', skillPath: 'skills/s', version: 'v', installedAt: 't' }] })
    expect((await h.service.uninstallSkill({ name: 's' })).ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/s')).toBe(false)
  })

  it('refuses unmanaged skills (hand-created files are never touched)', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/hand/SKILL.md': SKILL('hand') })
    expect(await h.service.uninstallSkill({ name: 'hand' })).toEqual({ ok: false, error: 'skill "hand" was not installed by the plugin' })
    expect(h.fs.has('/home/u/.agents/skills/hand/SKILL.md')).toBe(true)
    expect(await h.service.uninstallSkill({ name: 'ghost' })).toEqual({ ok: false, error: 'skill "ghost" not found' })
  })
})

describe('provider management on the settings config', () => {
  it('adds to settings, syncs the cache, and removes cleanly', async () => {
    const h = makeHarness()
    expect((await h.service.addProvider('o/r')).ok).toBe(true)
    expect(h.config.raw().providers).toEqual([expect.objectContaining({ id: 'o-r', spec: 'o/r' })])
    // Duplicate add does not duplicate the record.
    await h.service.addProvider('o/r')
    expect(h.config.raw().providers as unknown[]).toHaveLength(1)
    expect((await h.service.removeProvider('o-r')).ok).toBe(true)
    expect(h.config.raw().providers).toEqual([])
    expect(await h.service.removeProvider('o-r')).toEqual({ ok: false, error: 'provider "o-r" is not configured' })
  })

  it('provider rows derive from the settings section, not the catalog cache', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    await h.service.addProvider('o/r')
    // A cache entry whose settings record is gone is invisible: the cache is
    // a replica, never a source.
    await h.config.replace({ providers: [], installed: [], scopes: {} })
    expect((await h.service.state()).providers).toEqual([])
    // A settings provider without a synced snapshot renders as never synced.
    await h.config.replace({
      providers: [{ id: 'o-r', spec: 'o/r', addedAt: 't' }, { id: 'x-y', spec: 'x/y', addedAt: 't' }],
      installed: [],
      scopes: {},
    })
    const rows = (await h.service.state()).providers
    expect(rows.map((r) => [r.spec, r.error ?? ''])).toEqual([['o/r', ''], ['x/y', 'never synced']])
    expect(rows[0].lastRefresh).not.toBe('')
  })

  it('rejects invalid specs and records sync failures on the catalog row', async () => {
    const h = makeHarness()
    expect(await h.service.addProvider('not a spec')).toMatchObject({ ok: false })
    h.gh.setRepoStatus(500)
    const fail = await h.service.addProvider('o/r')
    expect(fail).toMatchObject({ ok: false })
    const state = await h.service.state()
    expect(state.providers.find((p) => p.id === 'o-r')?.error).toBeTruthy()
  })

  it('refreshAll reports a failure when any provider fails', async () => {
    const h = makeHarness({}, {
      providers: [
        { id: 'o-r', spec: 'o/r', addedAt: 't' },
        { id: 'github.com/x/y', spec: 'x/y', addedAt: 't' },
      ],
    })
    h.gh.setRepoStatus(500)
    const result = await h.service.refreshProviders()
    expect(result).toMatchObject({ ok: false })
  })

  it('refreshProvider refuses unknown providers', async () => {
    const h = makeHarness()
    expect(await h.service.refreshProvider('o-r')).toEqual({ ok: false, error: 'provider "o-r" is not configured' })
  })

  it('refreshProvider heals the replica: a recorded-but-missing skill reinstalls', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    // The clone-sharing failure mode: the settings record exists but the
    // files (or the whole global root) are missing until the cache syncs.
    await h.fs.rm('/home/u/.agents/skills/find-skills', { recursive: true, force: true })
    const result = await h.service.refreshProvider('o-r')
    expect(result.ok).toBe(true)
    expect(result.warning).toContain('find-skills')
    expect(result.warning).toContain('reinstalled from o/r')
    expect(h.fs.has('/home/u/.agents/skills/find-skills/SKILL.md')).toBe(true)
  })

  it('reconcile with nothing missing answers without a warning', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    const result = await h.service.reconcile()
    expect(result).toMatchObject({ ok: true })
    expect(result).not.toHaveProperty('warning')
  })
})

describe('ensureDefaultProviders', () => {
  it('seeds a fresh install and refuses when providers already exist', async () => {
    const h = makeHarness()
    expect(await h.service.ensureDefaultProviders(['o/r'])).toBe(true)
    expect(h.config.raw().providers).toHaveLength(1)
    expect(await h.service.ensureDefaultProviders(['o/r'])).toBe(false)
  })

  it('never seeds when a legacy providers.json exists (migration owns it)', async () => {
    const h = makeHarness()
    await h.fs.mkdir('/home/u/.dsh/skills-market', { recursive: true })
    await h.fs.writeFile('/home/u/.dsh/skills-market/providers.json', JSON.stringify({ providers: [] }))
    expect(await h.service.ensureDefaultProviders(['o/r'])).toBe(false)
    expect(h.config.raw()).toEqual({})
  })
})

describe('migrateLegacy', () => {
  it('is a no-op when the settings section already holds configuration', async () => {
    const h = makeHarness({}, { providers: [{ id: 'p', spec: 'o/r', addedAt: 't' }] })
    const result = await h.service.migrateLegacy([])
    expect(result).toEqual({ migrated: false, notes: [] })
  })

  it('migrates providers, moves a managed workspace copy, deletes shadows, and un-toggles disabled skills', async () => {
    const legacyProviders = '/home/u/.dsh/skills-market/providers.json'
    const h = makeHarness({
      [legacyProviders]: JSON.stringify({ providers: [{ id: 'o-r', spec: 'o/r', addedAt: 't0' }] }),
      // Managed global skill the old panel disabled (both toggle lines).
      '/home/u/.agents/skills/g/SKILL.md': SKILL('g', 'disable-model-invocation: true\nuser-invocable: false\n'),
      [`/home/u/.agents/skills/g/${MANIFEST_FILE}`]: JSON.stringify({
        providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/g', version: 'v1', installedAt: 't',
      }),
      // Managed workspace copy to move into the global root.
      '/repo/.agents/skills/m/SKILL.md': SKILL('m'),
      [`/repo/.agents/skills/m/${MANIFEST_FILE}`]: JSON.stringify({
        providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/m', version: 'v2', installedAt: 't',
      }),
      // Legacy workspace shadow.
      '/repo/.agents/skills/shadow/SKILL.md': '---\nname: shadow\ndescription: shadow skill\ndisable-model-invocation: true\nuser-invocable: false\n---\n\n<!-- dsh-next-skills:workspace-shadow -->\n',
      // Hand-created skills: never touched.
      '/repo/.agents/skills/manual/SKILL.md': SKILL('manual'),
    })
    const result = await h.service.migrateLegacy(['/repo'])
    expect(result.migrated).toBe(true)

    const config = h.config.raw()
    expect(config.providers).toEqual([{ id: 'o-r', spec: 'o/r', addedAt: 't0' }])
    expect(config.installed as Array<{ name: string }>).toEqual([
      expect.objectContaining({ name: 'g' }),
      expect.objectContaining({ name: 'm' }),
    ])
    expect(config.scopes as Record<string, unknown>).toEqual({
      g: [],
      shadow: [],
    })
    // The moved copy landed globally; the shadow is gone; the manual skill stayed.
    expect(h.fs.has('/home/u/.agents/skills/m/SKILL.md')).toBe(true)
    expect(h.fs.has('/repo/.agents/skills/m')).toBe(false)
    expect(h.fs.has('/repo/.agents/skills/shadow')).toBe(false)
    expect(h.fs.has('/repo/.agents/skills/manual/SKILL.md')).toBe(true)
    // The disabled global skill's toggle lines were stripped so a re-enable shows it.
    const g = await h.fs.readFile('/home/u/.agents/skills/g/SKILL.md')
    expect(g).not.toContain('disable-model-invocation')
    expect(g).not.toContain('user-invocable: false')
  })
})

describe('reconcileInstalled (the sharing payoff)', () => {
  it('reinstalls recorded skills whose global files are missing', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    const config = h.config.raw()
    config.installed = [{ name: 'find-skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'v', installedAt: 't' }]
    h.config.setSection(config)
    const notes = await h.service.reconcileInstalled()
    expect(notes).toEqual(['"find-skills" reinstalled from o/r'])
    expect(h.fs.has('/home/u/.agents/skills/find-skills/SKILL.md')).toBe(true)
    expect(h.fs.has(`/home/u/.agents/skills/find-skills/${MANIFEST_FILE}`)).toBe(true)
  })

  it('notes providers that are not synced yet and skips present skills', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/find-skills/SKILL.md': SKILL('find-skills'),
    }, {
      installed: [
        { name: 'find-skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'v', installedAt: 't' },
        { name: 'missing', providerId: 'github.com/none/none', providerSpec: 'none/none', skillPath: 'skills/missing', version: 'v', installedAt: 't' },
      ],
    })
    const notes = await h.service.reconcileInstalled()
    expect(notes).toEqual(['"missing": provider "none/none" is not synced yet'])
    expect(h.fs.has('/home/u/.agents/skills/find-skills/SKILL.md')).toBe(true)
  })

  it('returns no notes for an empty record list', async () => {
    const h = makeHarness()
    expect(await h.service.reconcileInstalled()).toEqual([])
  })
})

describe('detail payloads', () => {
  it('serves catalog and installed skill details', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    const fromCatalog = await h.service.getCatalogSkillDetail({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    expect(fromCatalog).toMatchObject({ name: 'find-skills', modelInvocable: true })
    expect(fromCatalog!.body).toBe('body\n')
    expect(await h.service.getCatalogSkillDetail({ providerId: 'none', skillPath: 'x' })).toBeUndefined()

    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    const installed = await h.service.getInstalledSkillDetail({ name: 'find-skills' })
    expect(installed).toMatchObject({ name: 'find-skills' })
    expect(await h.service.getInstalledSkillDetail({ name: 'ghost' })).toBeUndefined()
  })

  it('serves installed details from workspace copies too', async () => {
    const h = makeHarness({ '/repo/.agents/skills/w/SKILL.md': SKILL('w') })
    const detail = await h.service.getInstalledSkillDetail({ name: 'w', workspacePaths: ['/repo'] })
    expect(detail).toMatchObject({ name: 'w' })
  })
})
