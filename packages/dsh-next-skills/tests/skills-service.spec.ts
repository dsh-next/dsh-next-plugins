import { describe, expect, it } from 'vitest'
import type { FetchLike } from '../src/core/types.ts'
import { fingerprintVersion } from '../src/core/provider.ts'
import { TRASH_DIR, SkillsService } from '../src/host/skills-service.ts'
import { createMemFs, type MemFs } from './helpers/memfs.ts'
import { createGhDouble, type GhDouble } from './helpers/gh.ts'
import { MemConfigFace } from './helpers/config-face.ts'

const SKILL = (name: string, extra = '') => `---\nname: ${name}\ndescription: ${name} skill\n${extra}---\nbody\n`

const CATALOG_FILES: Record<string, string> = {
  'skills/find-skills/SKILL.md': SKILL('find-skills'),
  'skills/find-skills/references/note.md': 'note',
  'skills/other-skill/SKILL.md': SKILL('other-skill'),
}

const GLOBAL_DIR = '/home/u/.agents/skills/find-skills'
const CATALOG_CACHE = '/home/u/.dsh/skills-market'

interface Harness {
  fs: MemFs
  gh: GhDouble
  service: SkillsService
  config: MemConfigFace
  warnings: string[]
}

function makeHarness(seed: Record<string, string> = {}, configSection: Record<string, unknown> = {}): Harness {
  const fs = createMemFs(seed)
  const gh = createGhDouble({ files: CATALOG_FILES })
  const config = new MemConfigFace()
  config.setSection(configSection)
  const warnings: string[] = []
  const service = new SkillsService({
    fs,
    fetch: gh.fetch as FetchLike,
    dshHome: '/home/u/.dsh',
    agentsHome: '/home/u/.agents',
    logWarn: (message) => warnings.push(message),
    config,
  })
  return { fs, gh, service, config, warnings }
}

/** Sync the catalog double so the provider cache holds the two skills. */
async function seedCatalog(h: Harness): Promise<void> {
  await h.service.addProvider('o/r')
}

/** Seed a second provider's catalog entry + cache files directly (the replica). */
async function seedSecondProvider(h: Harness, skillMd: string, version: string): Promise<void> {
  const catalog = JSON.parse(await h.fs.readFile(`${CATALOG_CACHE}/catalog.json`))
  catalog.providers.push({
    id: 'p-q',
    spec: 'p/q',
    lastRefresh: '2026-01-01T00:00:00.000Z',
    skills: [{
      name: 'find-skills',
      description: 'find-skills skill (p/q)',
      cacheDir: 'native__find-skills',
      skillPath: 'native/find-skills',
      version,
      files: [{ path: 'SKILL.md', sha: 'y' }],
    }],
  })
  await h.fs.writeFile(`${CATALOG_CACHE}/catalog.json`, JSON.stringify(catalog))
  await h.fs.writeFile(`${CATALOG_CACHE}/files/p-q/native__find-skills/SKILL.md`, skillMd)
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

  it('keeps multiple copies of one name (no name-collapse)', async () => {
    const h = makeHarness({
      '/home/u/.dsh/skills/shared/SKILL.md': SKILL('shared'),
      '/home/u/.agents/skills/shared/SKILL.md': SKILL('shared'),
    })
    const state = await h.service.state()
    expect(state.installed).toHaveLength(2)
    const dsh = state.installed.find((s) => s.source === 'user-dsh')!
    const agents = state.installed.find((s) => s.source === 'user-agents')!
    expect(dsh.directory).toBe('/home/u/.dsh/skills/shared')
    expect(agents.directory).toBe('/home/u/.agents/skills/shared')
  })

  it('never lists project/workspace skills — they are hand-managed in the project', async () => {
    const h = makeHarness({
      '/repo/.agents/skills/shared/SKILL.md': SKILL('shared'),
      '/repo/.dsh/skills/other/SKILL.md': SKILL('other'),
      '/home/u/.agents/skills/global-one/SKILL.md': SKILL('global-one'),
    })
    const state = await h.service.state()
    expect(state.installed.map((s) => s.name)).toEqual(['global-one'])
    expect(state.installed.every((s) => s.scope === 'global')).toBe(true)
    // Detail lookup does not serve workspace copies either.
    expect(await h.service.getInstalledSkillDetail({ name: 'shared' })).toBeUndefined()
  })

  it('skips the .system and .trash directories in the user-dsh root', async () => {
    const h = makeHarness({
      '/home/u/.dsh/skills/.system/SKILL.md': SKILL('system-skill'),
      '/home/u/.dsh/skills/.trash/1-x/SKILL.md': SKILL('trashed'),
    })
    const state = await h.service.state()
    expect(state.installed).toHaveLength(0)
  })

  it('a legacy manifest sidecar confers nothing and is skipped by the fingerprint', async () => {
    // settings.yaml is the single source of provenance: the sidecar file
    // neither marks a copy as provider-installed nor falsifies the source
    // compare (it is excluded from the fingerprint). The copy stays
    // unrecorded; its content parity shows up in the source options.
    const h = makeHarness({
      [`${GLOBAL_DIR}/SKILL.md`]: SKILL('find-skills'),
      [`${GLOBAL_DIR}/references/note.md`]: 'note',
      [`${GLOBAL_DIR}/.dsh-next-provider.json`]: JSON.stringify({
        providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'old', installedAt: 't',
      }),
    })
    await seedCatalog(h)
    const state = await h.service.state()
    const row = state.installed.find((s) => s.name === 'find-skills')!
    expect(row.provider).toBeUndefined()
    expect(row.sources).toEqual([
      { providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: expect.any(String), matches: true },
    ])
  })

  it('carries the config scope per name and exposes only the three envelope sections', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/s/SKILL.md': SKILL('s'),
    }, {
      scopes: { s: ['repo'] },
    })
    const state = await h.service.state()
    expect(state.installed.find((x) => x.name === 's')!.configScope).toEqual(['repo'])
    expect(Object.keys(state).sort()).toEqual(['catalog', 'installed', 'providers'])
  })

  it('a settings record attributes provider provenance without any sidecar file', async () => {
    const h = makeHarness({
      [`${GLOBAL_DIR}/SKILL.md`]: SKILL('find-skills'),
      [`${GLOBAL_DIR}/references/note.md`]: 'note',
    }, {
      installations: [{ name: 'find-skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills' }],
    })
    await seedCatalog(h)
    const row = (await h.service.state()).installed.find((s) => s.name === 'find-skills')!
    expect(row.provider).toBe('o/r')
    expect(row.sources).toEqual([
      { providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: expect.any(String), matches: true },
    ])
  })

  it('flags content parity per offering on the copies that have same-name catalog skills', async () => {
    const h = makeHarness({
      // Hand-edited after install: the content no longer matches the catalog.
      [`${GLOBAL_DIR}/SKILL.md`]: SKILL('find-skills', 'local-tweak: true\n'),
      '/home/u/.agents/skills/clean/SKILL.md': SKILL('clean'),
    }, {
      installations: [
        { name: 'find-skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills' },
        { name: 'clean', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/clean' },
      ],
    })
    await seedCatalog(h)
    h.gh.setFiles({ ...CATALOG_FILES, 'skills/clean/SKILL.md': SKILL('clean') })
    await h.service.refreshProvider('o-r')
    const state = await h.service.state()
    const dirty = state.installed.find((s) => s.name === 'find-skills')!
    expect(dirty.sources).toEqual([
      { providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: expect.any(String), matches: false },
    ])
    // Equal content fingerprints flag as matches.
    const clean = state.installed.find((s) => s.name === 'clean')!
    expect(clean.sources).toEqual([
      { providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/clean', version: expect.any(String), matches: true },
    ])
  })

  it('flat and unoffered copies get no source options', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/flat-skill.md': SKILL('flat-skill'),
      '/home/u/.agents/skills/plain/SKILL.md': SKILL('plain'),
    })
    await seedCatalog(h)
    const state = await h.service.state()
    expect(state.installed.find((s) => s.name === 'flat-skill')!.sources).toBeUndefined()
    expect(state.installed.find((s) => s.name === 'plain')!.sources).toBeUndefined()
  })

  it('state() prunes orphan scopes (no discovered copy and no catalog entry)', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/s/SKILL.md': SKILL('s'),
    }, {
      scopes: { s: ['repo'], gone: ['api'] },
    })
    await h.service.state()
    expect(h.config.raw().scopes).toEqual({ s: ['repo'] })
  })
})

describe('installSkill (global-only)', () => {
  it('copies the skill into the global root and records the provenance in settings', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    const result = await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    expect(result.ok).toBe(true)
    expect(h.fs.has(`${GLOBAL_DIR}/SKILL.md`)).toBe(true)
    expect(h.fs.has(`${GLOBAL_DIR}/references/note.md`)).toBe(true)
    // No sidecar is written anymore: settings is the only ledger.
    expect(h.fs.has(`${GLOBAL_DIR}/.dsh-next-provider.json`)).toBe(false)
    expect(h.config.raw().installations).toEqual([
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
    // The skill must exist somewhere (copy or catalog): state() prunes the
    // enablement of an orphan name, so scope for a ghost name cannot persist.
    const h = makeHarness({ '/home/u/.agents/skills/ok/SKILL.md': SKILL('ok') })
    expect(await h.service.setSkillScope({ name: 'not a name' })).toMatchObject({ ok: false })
    await h.service.setSkillScope({ name: 'ok', workspaces: ['/x/repo', 'repo', 'other'] })
    expect((h.config.raw().scopes as Record<string, unknown>)['ok']).toEqual(['repo', 'other'])
  })
})

describe('updateSkill (in place, explicit copy target)', () => {
  async function installedHarness(): Promise<Harness> {
    const h = makeHarness()
    await seedCatalog(h)
    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    return h
  }

  it('overwrites files, prunes dropped upstream files, and refreshes the ledger record', async () => {
    const h = await installedHarness()
    h.gh.setFiles({ 'skills/find-skills/SKILL.md': SKILL('find-skills', 'updated: true\n') })
    await h.service.refreshProvider('o-r')
    const result = await h.service.updateSkill({
      name: 'find-skills', directory: GLOBAL_DIR, providerId: 'o-r', skillPath: 'skills/find-skills',
    })
    expect(result.ok).toBe(true)
    const content = await h.fs.readFile(`${GLOBAL_DIR}/SKILL.md`)
    expect(content).toContain('updated: true')
    expect(h.fs.has(`${GLOBAL_DIR}/references/note.md`)).toBe(false) // pruned
    expect(h.config.raw().installations).toEqual([
      expect.objectContaining({ name: 'find-skills', providerSpec: 'o/r', skillPath: 'skills/find-skills' }),
    ])
    // The refreshed fingerprint matches the catalog again.
    const row = (await h.service.state()).installed.find((s) => s.name === 'find-skills')!
    expect(row.sources!.every((s) => s.matches)).toBe(true)
  })

  it('adopts a hand-created copy: overwrites it and records it in the ledger', async () => {
    const h = makeHarness({
      [`${GLOBAL_DIR}/SKILL.md`]: SKILL('find-skills', 'hand-edited: true\n'),
    })
    await seedCatalog(h)
    const result = await h.service.updateSkill({
      name: 'find-skills', directory: GLOBAL_DIR, providerId: 'o-r', skillPath: 'skills/find-skills',
    })
    expect(result.ok).toBe(true)
    expect(await h.fs.readFile(`${GLOBAL_DIR}/SKILL.md`)).toBe(SKILL('find-skills'))
    expect(h.fs.has(`${GLOBAL_DIR}/references/note.md`)).toBe(true)
    expect(h.config.raw().installations).toEqual([
      expect.objectContaining({ name: 'find-skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills' }),
    ])
  })

  it('picks the requested provider when several catalog skills share the name', async () => {
    const candidateB = SKILL('find-skills', 'from-pq: true\n')
    const h = makeHarness({
      // Local copy differs from both catalog versions.
      [`${GLOBAL_DIR}/SKILL.md`]: SKILL('find-skills', 'local: true\n'),
    })
    await seedCatalog(h)
    await seedSecondProvider(h, candidateB, fingerprintVersion([{ path: 'SKILL.md', content: candidateB }]))
    const row = (await h.service.state()).installed.find((s) => s.name === 'find-skills')!
    // Every offering is a source option, spec-sorted, none matching yet.
    expect(row.sources!.map((s) => s.providerId)).toEqual(['o-r', 'p-q'])
    expect(row.sources!.every((s) => !s.matches)).toBe(true)

    const result = await h.service.updateSkill({
      name: 'find-skills', directory: GLOBAL_DIR, providerId: 'p-q', skillPath: 'native/find-skills',
    })
    expect(result.ok).toBe(true)
    expect(await h.fs.readFile(`${GLOBAL_DIR}/SKILL.md`)).toBe(candidateB)
    expect(h.config.raw().installations).toEqual([
      expect.objectContaining({ name: 'find-skills', providerId: 'p-q', providerSpec: 'p/q', skillPath: 'native/find-skills' }),
    ])
    // The adopted source now matches; the other provider stays listed as a
    // differing option (pinning to the recorded provider is the client's
    // Update-button rule, not a host-side filter).
    const after = (await h.service.state()).installed.find((s) => s.name === 'find-skills')!
    expect(after.provider).toBe('p/q')
    expect(after.sources!.map((s) => [s.providerId, s.matches])).toEqual([['o-r', false], ['p-q', true]])
  })

  it('reports per-provider parity so the client can pin Update to the recorded provider', async () => {
    const candidateB = SKILL('find-skills', 'from-pq: true\n')
    const h = makeHarness()
    await seedCatalog(h)
    await seedSecondProvider(h, candidateB, fingerprintVersion([{ path: 'SKILL.md', content: candidateB }]))
    // Install from o-r: the ledger pins the skill to that provider.
    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    // p-q ships a DIFFERENT same-name version, and o-r moves to v2 — the
    // local copy now differs from both.
    h.gh.setFiles({ 'skills/find-skills/SKILL.md': SKILL('find-skills', 'v2: true\n') })
    await h.service.refreshProvider('o-r')
    const row = (await h.service.state()).installed.find((s) => s.name === 'find-skills')!
    // The client derives Update from the recorded provider's entry only.
    const recorded = row.sources!.find((s) => s.providerSpec === row.provider)
    expect(recorded).toMatchObject({ providerId: 'o-r', matches: false })
    // Updating from the recorded provider restores parity with it; p-q's
    // same-name option remains (a vendor switch, not an update).
    const upd = await h.service.updateSkill({
      name: 'find-skills', directory: GLOBAL_DIR, providerId: 'o-r', skillPath: 'skills/find-skills',
    })
    expect(upd.ok).toBe(true)
    const done = (await h.service.state()).installed.find((s) => s.name === 'find-skills')!
    expect(done.sources!.map((s) => [s.providerId, s.matches])).toEqual([['o-r', true], ['p-q', false]])
  })

  it('externally-owned skills carry no update candidates and reject provider updates', async () => {
    const candidateB = SKILL('find-skills', 'from-pq: true\n')
    const h = makeHarness()
    await seedCatalog(h)
    await seedSecondProvider(h, candidateB, fingerprintVersion([{ path: 'SKILL.md', content: candidateB }]))
    await h.service.installExternalSkills({
      owner: 'cc-plugins', pluginKey: 'github:o/r/team-tools', marketplaceId: 'github:o/r',
      skills: [{ name: 'find-skills', files: { 'SKILL.md': SKILL('find-skills', 'cc: true\n') } }],
    })
    const row = (await h.service.state()).installed.find((s) => s.name === 'find-skills')!
    expect(row.ownership?.pluginKey).toBe('github:o/r/team-tools')
    // Same-name catalog skills exist, yet an owned copy gets no source
    // options (its source is the owning plugin's business).
    expect(row.sources).toBeUndefined()
    // The RPC rejects a provider update onto the owned directory.
    const result = await h.service.updateSkill({
      name: 'find-skills', directory: '/home/u/.agents/skills/find-skills', providerId: 'o-r', skillPath: 'skills/find-skills',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('update it through that plugin')
  })

  it('refuses an unknown directory, unknown provider skills, and name mismatches', async () => {
    const h = await installedHarness()
    expect(await h.service.updateSkill({
      name: 'find-skills', directory: '/tmp/evil/find-skills', providerId: 'o-r', skillPath: 'skills/find-skills',
    })).toEqual({ ok: false, error: 'directory is not inside a managed skill root' })
    expect(await h.service.updateSkill({
      name: 'find-skills', directory: GLOBAL_DIR, providerId: 'none', skillPath: 'skills/find-skills',
    })).toEqual({ ok: false, error: 'provider "none" no longer offers "find-skills"' })
    expect(await h.service.updateSkill({
      name: 'find-skills', directory: GLOBAL_DIR, providerId: 'o-r', skillPath: 'skills/nope',
    })).toEqual({ ok: false, error: 'provider "o-r" no longer offers "find-skills"' })
    // A real bundle directory whose name differs from the requested skill.
    await h.fs.writeFile('/home/u/.agents/skills/other-skill/SKILL.md', SKILL('other-skill'))
    expect(await h.service.updateSkill({
      name: 'other-skill', directory: '/home/u/.agents/skills/other-skill', providerId: 'o-r', skillPath: 'skills/find-skills',
    })).toEqual({ ok: false, error: 'skill "skills/find-skills" has a different name' })
    expect(await h.service.updateSkill({
      name: 'not a name', directory: GLOBAL_DIR, providerId: 'o-r', skillPath: 'skills/find-skills',
    })).toEqual({ ok: false, error: 'invalid skill name "not a name"' })
  })

  it('refuses to update a workspace copy: those are managed by hand in the project', async () => {
    const h = makeHarness({ '/repo/.agents/skills/find-skills/SKILL.md': SKILL('find-skills', 'hand: true\n') })
    await seedCatalog(h)
    const result = await h.service.updateSkill({
      name: 'find-skills', directory: '/repo/.agents/skills/find-skills', providerId: 'o-r', skillPath: 'skills/find-skills',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('by hand in the project')
    // The hand-managed file is untouched and not adopted into the ledger.
    expect(await h.fs.readFile('/repo/.agents/skills/find-skills/SKILL.md')).toContain('hand: true')
    expect(h.config.raw().installations).toEqual([])
  })

  it('refuses a flat copy: its directory is the root itself, and pruning it would wipe the root', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/flat-skill.md': SKILL('flat-skill') })
    await seedCatalog(h)
    const result = await h.service.updateSkill({
      name: 'flat-skill', directory: '/home/u/.agents/skills', providerId: 'o-r', skillPath: 'skills/find-skills',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('not a bundle copy')
    // Nothing in the root was touched.
    expect(await h.fs.readFile('/home/u/.agents/skills/flat-skill.md')).toBe(SKILL('flat-skill'))
    expect(h.fs.has('/home/u/.agents/skills/find-skills/SKILL.md')).toBe(false)
    expect(h.config.raw().installations).toEqual([])
  })
})

describe('detachSkill (config-only provenance drop)', () => {
  it('removes the ledger record and keeps every file; the copy becomes hand-managed', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    await h.service.setSkillScope({ name: 'find-skills', workspaces: ['/Users/x/Projects/repo'] })
    const before = h.fs.snapshot()
    const result = await h.service.detachSkill({ name: 'find-skills', directory: GLOBAL_DIR })
    expect(result.ok).toBe(true)
    expect(h.config.raw().installations).toEqual([])
    // Scope is enablement, not provenance: it survives a detach.
    expect((h.config.raw().scopes as Record<string, unknown>)['find-skills']).toEqual(['repo'])
    expect(h.fs.snapshot()).toEqual(before)
    const row = (await h.service.state()).installed.find((s) => s.name === 'find-skills')!
    expect(row.provider).toBeUndefined()
    // Still switchable: the source options remain.
    expect(row.sources).toEqual([
      { providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: expect.any(String), matches: true },
    ])
  })

  it('refuses an unrecorded copy, an owned copy, an unknown directory, and a bad name', async () => {
    const h = makeHarness({ [`${GLOBAL_DIR}/SKILL.md`]: SKILL('find-skills') })
    await seedCatalog(h)
    expect(await h.service.detachSkill({ name: 'find-skills', directory: GLOBAL_DIR }))
      .toEqual({ ok: false, error: 'skill "find-skills" has no recorded provider to detach from' })
    expect(await h.service.detachSkill({ name: 'find-skills', directory: '/tmp/evil/x' }))
      .toEqual({ ok: false, error: 'directory is not inside a managed skill root' })
    expect(await h.service.detachSkill({ name: 'not a name', directory: GLOBAL_DIR }))
      .toEqual({ ok: false, error: 'invalid skill name "not a name"' })
    // An owned copy cannot be detached out from under its owning plugin.
    await h.service.installExternalSkills({
      owner: 'cc-plugins', pluginKey: 'github:o/r/team-tools', marketplaceId: 'github:o/r',
      skills: [{ name: 'cc-skill', files: { 'SKILL.md': SKILL('cc-skill') } }],
    })
    const owned = await h.service.detachSkill({ name: 'cc-skill', directory: '/home/u/.agents/skills/cc-skill' })
    expect(owned.ok).toBe(false)
    if (!owned.ok) expect(owned.error).toContain('detach it through that plugin')
  })
})

describe('deleteSkill (recoverable, per copy)', () => {
  it('trashes the directory and drops the ledger record and scope on the last copy', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    await h.service.setSkillScope({ name: 'find-skills', workspaces: [] })
    const result = await h.service.deleteSkill({
      name: 'find-skills', directory: GLOBAL_DIR, kind: 'bundle', path: `${GLOBAL_DIR}/SKILL.md`,
    })
    expect(result.ok).toBe(true)
    expect(h.fs.has(`${GLOBAL_DIR}/SKILL.md`)).toBe(false)
    expect(h.fs.has(`/home/u/.agents/skills/${TRASH_DIR}`)).toBe(true)
    expect(h.config.raw().installations).toEqual([])
    expect(h.config.raw().scopes).toEqual({})
  })

  it('keeps the ledger record and scope while another copy of the name remains', async () => {
    const record = { name: 'shared', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/shared' }
    // Two copies in the two GLOBAL roots (workspace copies are protected).
    const h = makeHarness({
      '/home/u/.dsh/skills/shared/SKILL.md': SKILL('shared'),
      '/home/u/.agents/skills/shared/SKILL.md': SKILL('shared'),
    }, {
      installations: [record],
      scopes: { shared: ['repo'] },
    })
    const result = await h.service.deleteSkill({
      name: 'shared', directory: '/home/u/.dsh/skills/shared', kind: 'bundle', path: '/home/u/.dsh/skills/shared/SKILL.md',
    })
    expect(result.ok).toBe(true)
    expect(h.fs.has('/home/u/.dsh/skills/shared/SKILL.md')).toBe(false)
    expect(h.fs.has('/home/u/.agents/skills/shared/SKILL.md')).toBe(true)
    expect(h.config.raw().installations).toEqual([record])
    expect((h.config.raw().scopes as Record<string, unknown>).shared).toEqual(['repo'])
  })

  it('refuses to delete a workspace copy: those are managed by hand in the project', async () => {
    const h = makeHarness({
      '/repo/.agents/skills/shared/SKILL.md': SKILL('shared'),
      '/repo/.dsh/skills/other/SKILL.md': SKILL('other'),
    })
    const bundle = await h.service.deleteSkill({
      name: 'shared', directory: '/repo/.agents/skills/shared', kind: 'bundle', path: '/repo/.agents/skills/shared/SKILL.md',
    })
    expect(bundle.ok).toBe(false)
    if (!bundle.ok) expect(bundle.error).toContain('by hand in the project')
    expect(h.fs.has('/repo/.agents/skills/shared/SKILL.md')).toBe(true)
    // The .dsh project convention is protected the same way.
    const dshRoot = await h.service.deleteSkill({
      name: 'other', directory: '/repo/.dsh/skills/other', kind: 'bundle', path: '/repo/.dsh/skills/other/SKILL.md',
    })
    expect(dshRoot.ok).toBe(false)
    expect(h.fs.has('/repo/.dsh/skills/other/SKILL.md')).toBe(true)
  })

  it('trashes a flat skill file in place', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/flat-skill.md': SKILL('flat-skill') })
    const result = await h.service.deleteSkill({
      name: 'flat-skill', directory: '/home/u/.agents/skills', kind: 'flat', path: '/home/u/.agents/skills/flat-skill.md',
    })
    expect(result.ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/flat-skill.md')).toBe(false)
    expect(h.fs.has(`/home/u/.agents/skills/${TRASH_DIR}`)).toBe(true)
  })

  it('removes any copy from a known root, even a hand-created one', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/hand/SKILL.md': SKILL('hand') })
    const result = await h.service.deleteSkill({
      name: 'hand', directory: '/home/u/.agents/skills/hand', kind: 'bundle', path: '/home/u/.agents/skills/hand/SKILL.md',
    })
    expect(result.ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/hand/SKILL.md')).toBe(false)
  })

  it('rejects directories outside a known skill root and invalid names', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/hand/SKILL.md': SKILL('hand') })
    expect(await h.service.deleteSkill({
      name: 'hand', directory: '/tmp/evil/hand', kind: 'bundle', path: '/tmp/evil/hand/SKILL.md',
    })).toEqual({ ok: false, error: 'directory is not inside a managed skill root' })
    expect(h.fs.has('/home/u/.agents/skills/hand/SKILL.md')).toBe(true)
    expect(await h.service.deleteSkill({
      name: 'not a name', directory: '/home/u/.agents/skills/hand', kind: 'bundle', path: '/home/u/.agents/skills/hand/SKILL.md',
    })).toEqual({ ok: false, error: 'invalid skill name "not a name"' })
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
    await h.config.replace({ providers: [], installations: [], scopes: {} })
    expect((await h.service.state()).providers).toEqual([])
    // A settings provider without a synced snapshot renders as never synced.
    await h.config.replace({
      providers: [{ id: 'o-r', spec: 'o/r', addedAt: 't' }, { id: 'x-y', spec: 'x/y', addedAt: 't' }],
      installations: [],
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

  it('logs a warning when a provider error cannot be persisted', async () => {
    const h = makeHarness()
    h.gh.setRepoStatus(500)
    // Force the catalog write inside markProviderError to fail, so the
    // diagnostic sink is the only place the failure can surface.
    const originalWrite = h.fs.writeFile
    h.fs.writeFile = async (p: string, content: string) => {
      if (p.endsWith('catalog.json')) throw new Error('disk full')
      return originalWrite(p, content)
    }
    const fail = await h.service.addProvider('o/r')
    expect(fail).toMatchObject({ ok: false })
    expect(h.warnings.some((w) => w.includes('could not persist provider error'))).toBe(true)
  })

  it('refreshAll reports a failure when any provider fails', async () => {
    const h = makeHarness({}, {
      providers: [
        { id: 'o-r', spec: 'o/r', addedAt: 't' },
        { id: 'x-y', spec: 'x/y', addedAt: 't' },
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
    await h.fs.rm(GLOBAL_DIR, { recursive: true, force: true })
    const result = await h.service.refreshProvider('o-r')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warning).toContain('find-skills')
      expect(result.warning).toContain('reinstalled from o/r')
    }
    expect(h.fs.has(`${GLOBAL_DIR}/SKILL.md`)).toBe(true)
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

describe('reconcileInstalled (the sharing payoff)', () => {
  it('reinstalls recorded skills whose global files are missing', async () => {
    const h = makeHarness()
    await seedCatalog(h)
    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    await h.fs.rm(GLOBAL_DIR, { recursive: true, force: true })
    const notes = await h.service.reconcileInstalled()
    expect(notes).toEqual(['"find-skills" reinstalled from o/r'])
    expect(h.fs.has(`${GLOBAL_DIR}/SKILL.md`)).toBe(true)
    expect(h.fs.has(`${GLOBAL_DIR}/references/note.md`)).toBe(true)
  })

  it('notes providers that are not synced yet and skips present skills', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/find-skills/SKILL.md': SKILL('find-skills'),
    }, {
      installations: [
        { name: 'find-skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills' },
        { name: 'missing', providerId: 'none', providerSpec: 'none/none', skillPath: 'skills/missing' },
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

  it('serves installed details from any listed global copy', async () => {
    const h = makeHarness({ '/home/u/.dsh/skills/w/SKILL.md': SKILL('w') })
    const detail = await h.service.getInstalledSkillDetail({ name: 'w' })
    expect(detail).toMatchObject({ name: 'w' })
  })

  it('resolves the detail by copy path when the name has several copies', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/dup/SKILL.md': '---\nname: dup\ndescription: agents\n---\nAGENTS-BODY\n',
      '/home/u/.dsh/skills/dup/SKILL.md': '---\nname: dup\ndescription: dsh\n---\nDSH-BODY\n',
    })
    const agents = await h.service.getInstalledSkillDetail({
      name: 'dup',
      path: '/home/u/.agents/skills/dup/SKILL.md',
    })
    const dsh = await h.service.getInstalledSkillDetail({
      name: 'dup',
      path: '/home/u/.dsh/skills/dup/SKILL.md',
    })
    expect(agents!.body).toBe('AGENTS-BODY\n')
    expect(dsh!.body).toBe('DSH-BODY\n')
    // A path that does not match the name is not served.
    expect(await h.service.getInstalledSkillDetail({ name: 'dup', path: '/home/u/.agents/skills/other/SKILL.md' })).toBeUndefined()
  })
})

describe('external skill handoff (cc-plugins bridge)', () => {
  const owner = 'cc-plugins'

  it('installs skills global-only with an ownership sidecar and records enablement', async () => {
    const h = makeHarness()
    const result = await h.service.installExternalSkills({
      owner,
      pluginKey: 'github:o/r/team-tools',
      marketplaceId: 'github:o/r',
      skills: [{ name: 'deploy', files: { 'SKILL.md': SKILL('deploy'), 'run.sh': 'echo deploy' } }],
      workspaces: ['/w1', '/w2'],
    })
    expect(result.ok).toBe(true)

    expect(h.fs.has('/home/u/.agents/skills/deploy/SKILL.md')).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/deploy/run.sh')).toBe(true)
    expect(h.fs.has('/w1/.agents/skills/deploy/SKILL.md')).toBe(false) // global-only
    const sidecar = await h.fs.readFile('/home/u/.agents/skills/deploy/.dsh-next-skill-owner.json')
    expect(JSON.parse(sidecar)).toEqual({ owner, pluginKey: 'github:o/r/team-tools', marketplaceId: 'github:o/r', skillName: 'deploy' })

    // Discovery surfaces the ownership and the config scope.
    const state = await h.service.state()
    const row = state.installed.find((s) => s.name === 'deploy')!
    expect(row.ownership?.pluginKey).toBe('github:o/r/team-tools')
    expect(row.configScope).toEqual(['w1', 'w2'])
  })

  it('rejects a same-name skill owned by someone else, but overwrites its own in place', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/deploy/SKILL.md': SKILL('deploy') })
    // Hand-created skill (no sidecar): collision.
    const clash = await h.service.installExternalSkills({
      owner, pluginKey: 'github:o/r/a', marketplaceId: 'github:o/r',
      skills: [{ name: 'deploy', files: { 'SKILL.md': SKILL('deploy', 'v1') } }],
    })
    expect(clash.ok).toBe(false)
    if (!clash.ok) expect(clash.error).toContain('already exists')

    // A plugin-owned skill updates in place for the same pluginKey.
    const first = await h.service.installExternalSkills({
      owner, pluginKey: 'github:x/team', marketplaceId: 'github:x',
      skills: [{ name: 'fresh', files: { 'SKILL.md': SKILL('fresh', 'v1'), 'a.txt': 'a' } }],
    })
    expect(first.ok).toBe(true)
    const second = await h.service.installExternalSkills({
      owner, pluginKey: 'github:x/team', marketplaceId: 'github:x',
      skills: [{ name: 'fresh', files: { 'SKILL.md': SKILL('fresh', 'v2') } }],
    })
    expect(second.ok).toBe(true)
    // Stale file pruned, content overwritten.
    expect(h.fs.has('/home/u/.agents/skills/fresh/a.txt')).toBe(false)
    expect(await h.fs.readFile('/home/u/.agents/skills/fresh/SKILL.md')).toContain('v2')
  })

  it('setExternalSkillScope and removeExternalSkills drive scope and recoverable removal', async () => {
    const h = makeHarness()
    await h.service.installExternalSkills({
      owner, pluginKey: 'github:o/r/team-tools', marketplaceId: 'github:o/r',
      skills: [{ name: 'deploy', files: { 'SKILL.md': SKILL('deploy') } }],
    })

    const scope = await h.service.setExternalSkillScope({ owner, name: 'deploy', workspaces: ['web'] })
    expect(scope.ok).toBe(true)
    expect((await h.service.state()).installed.find((s) => s.name === 'deploy')!.configScope).toEqual(['web'])

    // Remove only one skill name: recoverable trash, ownership gone from discovery.
    const remove = await h.service.removeExternalSkills({ owner, pluginKey: 'github:o/r/team-tools', skillNames: ['deploy'] })
    expect(remove.ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/deploy/SKILL.md')).toBe(false)
    expect((await h.service.state()).installed.find((s) => s.name === 'deploy')).toBeUndefined()
  })

  it('guards deleteSkill and setSkillScope against externally-owned skills', async () => {
    const h = makeHarness()
    await h.service.installExternalSkills({
      owner, pluginKey: 'github:o/r/team-tools', marketplaceId: 'github:o/r',
      skills: [{ name: 'deploy', files: { 'SKILL.md': SKILL('deploy') } }],
    })

    const del = await h.service.deleteSkill({ name: 'deploy', directory: '/home/u/.agents/skills/deploy', kind: 'bundle', path: '/home/u/.agents/skills/deploy/SKILL.md' })
    expect(del.ok).toBe(false)
    if (!del.ok) expect(del.error).toContain('managed by')

    const scope = await h.service.setSkillScope({ name: 'deploy', workspaces: ['web'] })
    expect(scope.ok).toBe(false)
    if (!scope.ok) expect(scope.error).toContain('external plugin')
  })

  it('rejects invalid names and a missing SKILL.md', async () => {
    const h = makeHarness()
    const badName = await h.service.installExternalSkills({
      owner, pluginKey: 'k', marketplaceId: 'm',
      skills: [{ name: 'Not-Kebab', files: { 'SKILL.md': SKILL('not-kebab') } }],
    })
    expect(badName.ok).toBe(false)
    if (!badName.ok) expect(badName.error).toContain('invalid skill name')

    const missing = await h.service.installExternalSkills({
      owner, pluginKey: 'k', marketplaceId: 'm',
      skills: [{ name: 'deploy', files: { 'run.sh': 'echo' } }],
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('no SKILL.md')
  })
})
