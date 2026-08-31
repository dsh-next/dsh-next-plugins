import { describe, expect, it } from 'vitest'
import type { FetchLike, SkillsState } from '../src/core/types.ts'
import { SkillsService, MANIFEST_FILE } from '../src/host/skills-service.ts'
import { createMemFs } from './helpers/memfs.ts'
import { createGhDouble } from './helpers/gh.ts'

const SKILL = (name: string, extra = '') => `---\nname: ${name}\ndescription: ${name} skill\n${extra}---\nbody\n`

const FILES: Record<string, string> = {
  'skills/find-skills/SKILL.md': SKILL('find-skills'),
  'skills/find-skills/references/note.md': 'note',
  'skills/other-skill/SKILL.md': SKILL('other-skill'),
}

const PROVIDERS_FILE = '/home/u/.dsh/skills-market/providers.json'

interface Harness {
  fs: ReturnType<typeof createMemFs>
  gh: ReturnType<typeof createGhDouble>
  service: SkillsService
}

/** Pre-seed configured providers (bypassing the network sync). */
async function seedProviders(h: Harness, providers: { id: string; spec: string; addedAt: string }[]): Promise<void> {
  await h.fs.mkdir('/home/u/.dsh/skills-market', { recursive: true })
  await h.fs.writeFile(PROVIDERS_FILE, JSON.stringify({ providers }))
}

function makeHarness(seed: Record<string, string> = {}): Harness {
  const fs = createMemFs(seed)
  const gh = createGhDouble({ files: FILES })
  const service = new SkillsService({
    fs,
    fetch: gh.fetch as FetchLike,
    dshHome: '/home/u/.dsh',
    agentsHome: '/home/u/.agents',
  })
  return { fs, gh, service }
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
      '/home/u/.agents/skills/shared/SKILL.md': SKILL('shared', 'disable-model-invocation: true\n'),
      '/repo/.agents/skills/shared/SKILL.md': SKILL('shared'),
    })
    const state = await h.service.state('/repo')
    const shared = state.installed.find((s) => s.name === 'shared')!
    expect(shared.scope).toBe('workspace')
    expect(shared.enabled).toBe(true)
  })
  it('skips the .system directory in the user-dsh root', async () => {
    const h = makeHarness({ '/home/u/.dsh/skills/.system/SKILL.md': SKILL('system-skill') })
    const state = await h.service.state()
    expect(state.installed).toHaveLength(0)
  })
  it('flags workspace shadows so the UI can tell them from real installs', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo') })
    await h.service.setEnabled({ name: 'foo', scope: 'workspace', enabled: false, workspacePath: '/repo', description: 'foo skill' })
    const state = await h.service.state('/repo')
    const shadow = state.installed.find((s) => s.name === 'foo')!
    expect(shadow.scope).toBe('workspace')
    expect(shadow.enabled).toBe(false)
    expect(shadow.shadow).toBe(true)
    // Without the workspace in scope the plain global copy shows, unshadowed.
    const globalView = await h.service.state()
    expect(globalView.installed.find((s) => s.name === 'foo')!.shadow).toBeUndefined()
  })
  it('writes shadows that stay parseable for multi-line descriptions', async () => {
    // The old writer interpolated raw text: multi-line descriptions produced
    // invalid YAML, the scanner dropped the shadow, and Disable did nothing.
    const h = makeHarness({ '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo', 'disable-model-invocation: true\n') })
    await h.service.setEnabled({
      name: 'foo', scope: 'workspace', enabled: false, workspacePath: '/repo',
      description: 'Throwaway skill for the marker.\nSecond line of the description.',
    })
    const state = await h.service.state('/repo')
    const shadow = state.installed.find((s) => s.name === 'foo')!
    expect(shadow).toBeTruthy()
    expect(shadow.enabled).toBe(false)
    expect(shadow.shadow).toBe(true)
    expect(shadow.description).toBe('Throwaway skill for the marker.\nSecond line of the description.')
  })
  it('repairs a corrupted shadow when the disable is issued again', async () => {
    // A shadow written by the old raw-interpolation writer: unparseable, so
    // invisible to the scanner. Re-disabling must overwrite it with a valid one.
    const broken = [
      '---',
      'name: foo',
      'description: Throwaway skill for the marker.',
      'Multi-line to exercise block-scalar descriptions.',
      'disable-model-invocation: true',
      'user-invocable: false',
      '---',
      '',
      '# Disabled in this workspace',
      '',
    ].join('\n')
    const h = makeHarness({
      '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo'),
      '/repo/.agents/skills/foo/SKILL.md': broken,
    })
    // The corrupted shadow is invisible: the merged view shows the global copy.
    expect((await h.service.state('/repo')).installed.find((s) => s.name === 'foo')!.scope).toBe('global')
    await h.service.setEnabled({
      name: 'foo', scope: 'workspace', enabled: false, workspacePath: '/repo',
      description: 'Throwaway skill for the marker.\nMulti-line to exercise block-scalar descriptions.',
    })
    const shadow = (await h.service.state('/repo')).installed.find((s) => s.name === 'foo')!
    expect(shadow.scope).toBe('workspace')
    expect(shadow.enabled).toBe(false)
    expect(shadow.shadow).toBe(true)
    expect(shadow.description).toBe('Throwaway skill for the marker.\nMulti-line to exercise block-scalar descriptions.')
  })
  it('installedMap reports the global root and every workspace independently', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo'),
      '/repo-a/.agents/skills/bar/SKILL.md': SKILL('bar'),
      '/repo-b/.agents/skills/baz/SKILL.md': SKILL('baz'),
    })
    const map = await h.service.installedMap(['/repo-a', '/repo-b'])
    expect(map.global.map((s) => s.name)).toEqual(['foo'])
    expect(map.workspaces).toHaveLength(2)
    expect(map.workspaces[0]).toMatchObject({ workspacePath: '/repo-a' })
    expect(map.workspaces[0].installed.map((s) => s.name)).toEqual(['bar'])
    expect(map.workspaces[1].installed.map((s) => s.name)).toEqual(['baz'])
  })
  it('installedMap never lets a global copy leak into a workspace list', async () => {
    const h = makeHarness({
      '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo'),
      '/repo-a/.agents/skills/foo/SKILL.md': SKILL('foo'),
    })
    let map = await h.service.installedMap(['/repo-a', '/repo-b'])
    expect(map.workspaces[0].installed.map((s) => s.name)).toContain('foo')
    expect(map.workspaces[1].installed.map((s) => s.name)).toEqual([])
    // After removing the workspace copy, only the global presence remains.
    await h.service.remove({ name: 'foo', scope: 'workspace', workspacePath: '/repo-a' })
    map = await h.service.installedMap(['/repo-a', '/repo-b'])
    expect(map.workspaces[0].installed.map((s) => s.name)).toEqual([])
    expect(map.global.map((s) => s.name)).toEqual(['foo'])
  })
  it('installedMap dedupes and drops empty paths', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo') })
    const map = await h.service.installedMap(['/repo', '/repo', '', '/repo-b'])
    expect(map.workspaces.map((w) => w.workspacePath)).toEqual(['/repo', '/repo-b'])
  })
  it('the same skill installs into multiple workspaces independently', async () => {
    const h = makeHarness()
    await h.service.addProvider('o/r')
    const a = await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'workspace', workspacePath: '/repo-a' })
    const b = await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'workspace', workspacePath: '/repo-b' })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(h.fs.has('/repo-a/.agents/skills/find-skills/SKILL.md')).toBe(true)
    expect(h.fs.has('/repo-b/.agents/skills/find-skills/SKILL.md')).toBe(true)
    // Removing the copy in A leaves B untouched (and recoverably trashed in A).
    const rm = await h.service.remove({ name: 'find-skills', scope: 'workspace', workspacePath: '/repo-a' })
    expect(rm.ok).toBe(true)
    expect(Object.keys(h.fs.snapshot()).some((p) => p.startsWith('/repo-a/.agents/skills/.trash/'))).toBe(true)
    expect(h.fs.has('/repo-b/.agents/skills/find-skills/SKILL.md')).toBe(true)
    const map = await h.service.installedMap(['/repo-a', '/repo-b'])
    expect(map.workspaces[0].installed.map((s) => s.name)).not.toContain('find-skills')
    expect(map.workspaces[1].installed.map((s) => s.name)).toContain('find-skills')
  })
})

describe('providers', () => {
  it('addProvider persists the provider and syncs the cache', async () => {
    const h = makeHarness()
    const r = await h.service.addProvider('https://github.com/o/r')
    expect(r.ok).toBe(true)
    const persisted = JSON.parse(await h.fs.readFile(PROVIDERS_FILE))
    expect(persisted).toMatchObject({ providers: [{ id: 'o-r', spec: 'o/r' }] })
    expect(h.fs.has('/home/u/.dsh/skills-market/files/o-r/skills__find-skills/SKILL.md')).toBe(true)
    const market = await h.service.marketplace()
    expect(market.providers).toHaveLength(1)
    expect(market.skills.map((s) => s.name).sort()).toEqual(['find-skills', 'other-skill'])
  })
  it('rejects an invalid spec', async () => {
    const h = makeHarness()
    expect(await h.service.addProvider('nope')).toEqual({ ok: false, error: 'invalid provider spec "nope" (expected owner/repo or a GitHub URL)' })
  })
  it('reports a sync failure without losing the provider config', async () => {
    const fs = createMemFs()
    const gh404 = createGhDouble({ repoStatus: 404 })
    const service = new SkillsService({ fs, fetch: gh404.fetch, dshHome: '/d', agentsHome: '/a' })
    const r = await service.addProvider('o/r')
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toMatch(/repository not found/)
  })
  it('removeProvider drops the config row and the cache', async () => {
    const h = makeHarness()
    await h.service.addProvider('o/r')
    const r = await h.service.removeProvider('o-r')
    expect(r.ok).toBe(true)
    expect(h.fs.has('/home/u/.dsh/skills-market/files/o-r/skills__find-skills/SKILL.md')).toBe(false)
    expect((await h.service.marketplace()).providers).toHaveLength(0)
  })
  it('removeProvider errors for an unknown provider', async () => {
    const h = makeHarness()
    expect(await h.service.removeProvider('nope')).toEqual({ ok: false, error: 'provider "nope" is not configured' })
  })
  it('refreshProviders re-syncs and reports per-provider failures', async () => {
    const h = makeHarness()
    await h.service.addProvider('o/r')
    const ok = await h.service.refreshProviders()
    expect(ok.ok).toBe(true)
    // Break the snapshot download: the next sync must fail with a clear message.
    h.gh.setTarballStatus(404)
    const failed = await h.service.refreshProviders()
    expect(failed.ok).toBe(false)
    expect((failed as { error: string }).error).toContain('o/r')
    const market = await h.service.marketplace()
    expect(market.providers[0].error).toBeTruthy()
  })
  it('refreshProviders succeeds with no providers configured', async () => {
    const h = makeHarness()
    expect((await h.service.refreshProviders()).ok).toBe(true)
  })
  it('refreshProvider re-syncs exactly one provider', async () => {
    const h = makeHarness()
    await seedProviders(h, [
      { id: 'o-r', spec: 'o/r', addedAt: 'x' },
      { id: 'never-synced', spec: 'other/repo', addedAt: 'x' },
    ])
    // The gh double only serves o/r; other/repo would 404, so a bulk refresh
    // would fail while the single-provider refresh must succeed.
    const r = await h.service.refreshProvider('o-r')
    expect(r.ok).toBe(true)
    const market = await h.service.marketplace()
    // The never-synced provider still gets a row (refreshable/removable).
    expect(market.providers.map((p) => p.id)).toEqual(['o-r', 'never-synced'])
    expect(market.providers[1]).toMatchObject({ spec: 'other/repo', skillCount: 0, error: 'never synced' })
    expect(market.skills.every((s) => s.providerId === 'o-r')).toBe(true)
    expect((await h.service.refreshProvider('missing')).ok).toBe(false)
  })
  it('refreshProvider reports the sync failure for a broken provider', async () => {
    const fs = createMemFs()
    const gh404 = createGhDouble({ repoStatus: 404 })
    const service = new SkillsService({ fs, fetch: gh404.fetch, dshHome: '/d', agentsHome: '/a' })
    await fs.mkdir('/d/skills-market', { recursive: true })
    await fs.writeFile('/d/skills-market/providers.json', JSON.stringify({ providers: [{ id: 'o-r', spec: 'o/r', addedAt: 'x' }] }))
    const r = await service.refreshProvider('o-r')
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toMatch(/repository not found/)
  })
})

describe('default providers and skill details', () => {
  it('seeds the default providers on first launch and never again', async () => {
    const h = makeHarness()
    expect(await h.service.ensureDefaultProviders()).toBe(true)
    const providers = JSON.parse(await h.fs.readFile(PROVIDERS_FILE)).providers as { id: string; spec: string }[]
    expect(providers.map((p) => p.spec)).toEqual([
      'anthropics/skills',
      'openclaw/openclaw',
      'mattpocock/skills',
      'muratcankoylan/Agent-Skills-for-Context-Engineering',
      'affaan-m/ecc',
      'nextlevelbuilder/ui-ux-pro-max-skill',
      'addyosmani/agent-skills',
      'Leonxlnx/taste-skill',
    ])
    // A removal persists; seeding never runs again once providers.json exists.
    await h.service.removeProvider('anthropics-skills')
    expect(await h.service.ensureDefaultProviders()).toBe(false)
    const after = JSON.parse(await h.fs.readFile(PROVIDERS_FILE)).providers as { id: string }[]
    expect(after.some((p) => p.id === 'anthropics-skills')).toBe(false)
  })

  it('serves the full SKILL.md configuration for catalog and installed skills', async () => {
    const h = makeHarness()
    expect(await h.service.getCatalogSkillDetail({ providerId: 'o-r', skillPath: 'skills/find-skills' })).toBeUndefined()
    await h.service.addProvider('o/r')
    const detail = await h.service.getCatalogSkillDetail({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    expect(detail).toMatchObject({ name: 'find-skills', description: 'find-skills skill', modelInvocable: true, userInvocable: true })
    expect(detail!.body).toContain('body')
    expect(await h.service.getCatalogSkillDetail({ providerId: 'o-r', skillPath: 'missing' })).toBeUndefined()
    await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'global' })
    const installed = await h.service.getInstalledSkillDetail({ name: 'find-skills', scope: 'global' })
    expect(installed).toMatchObject({ name: 'find-skills', description: 'find-skills skill' })
    expect(installed!.body).toContain('body')
    expect(await h.service.getInstalledSkillDetail({ name: 'missing', scope: 'global' })).toBeUndefined()
    expect(await h.service.getInstalledSkillDetail({ name: 'foo', scope: 'workspace' })).toBeUndefined()
  })
})

describe('installSkill', () => {
  it('installs globally into the agents skills root with a manifest', async () => {
    const h = makeHarness()
    await h.service.addProvider('o/r')
    const r = await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'global' })
    expect(r.ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/find-skills/SKILL.md')).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/find-skills/references/note.md')).toBe(true)
    const manifest = JSON.parse(await h.fs.readFile(`/home/u/.agents/skills/find-skills/${MANIFEST_FILE}`))
    expect(manifest).toMatchObject({ providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills' })
    const state = await h.service.state()
    const installed = state.installed.find((s) => s.name === 'find-skills')!
    expect(installed.provider).toBe('o/r')
    expect(installed.updateAvailable).toBe(false)
  })
  it('installs into a workspace root', async () => {
    const h = makeHarness()
    await h.service.addProvider('o/r')
    const r = await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'workspace', workspacePath: '/repo' })
    expect(r.ok).toBe(true)
    expect(h.fs.has('/repo/.agents/skills/find-skills/SKILL.md')).toBe(true)
  })
  it('refuses to overwrite an installed skill', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/find-skills/SKILL.md': SKILL('find-skills') })
    await h.service.addProvider('o/r')
    expect(await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'global' }))
      .toEqual({ ok: false, error: 'skill "find-skills" is already installed' })
  })
  it('errors for an unknown provider or skill', async () => {
    const h = makeHarness()
    await h.service.addProvider('o/r')
    expect(await h.service.installSkill({ providerId: 'nope', skillPath: 'x', scope: 'global' }))
      .toEqual({ ok: false, error: 'provider "nope" is not configured' })
    expect(await h.service.installSkill({ providerId: 'o-r', skillPath: 'missing', scope: 'global' }))
      .toEqual({ ok: false, error: 'skill "missing" is not in the o/r catalog' })
  })
  it('requires a workspacePath for workspace scope', async () => {
    const h = makeHarness()
    await h.service.addProvider('o/r')
    expect(await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'workspace' }))
      .toEqual({ ok: false, error: 'workspace scope requires a workspacePath' })
  })
})

describe('updateSkill', () => {
  async function installV1(h: Harness): Promise<void> {
    await h.service.addProvider('o/r')
    const r = await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'global' })
    expect(r.ok).toBe(true)
  }

  it('updates files, the manifest, and flags the version change', async () => {
    const h = makeHarness()
    await installV1(h)
    h.gh.setFiles({ ...FILES, 'skills/find-skills/SKILL.md': SKILL('find-skills').replace('body', 'new body') })
    await h.service.refreshProviders()
    let state = await h.service.state()
    expect(state.installed.find((s) => s.name === 'find-skills')!.updateAvailable).toBe(true)
    const r = await h.service.updateSkill({ name: 'find-skills', scope: 'global' })
    expect(r.ok).toBe(true)
    expect(await h.fs.readFile('/home/u/.agents/skills/find-skills/SKILL.md')).toContain('new body')
    state = await h.service.state()
    expect(state.installed.find((s) => s.name === 'find-skills')!.updateAvailable).toBe(false)
    const manifest = JSON.parse(await h.fs.readFile(`/home/u/.agents/skills/find-skills/${MANIFEST_FILE}`))
    expect(manifest.version).toBeTruthy()
  })
  it('preserves the disabled state across an update', async () => {
    const h = makeHarness()
    await installV1(h)
    await h.service.setEnabled({ name: 'find-skills', scope: 'global', enabled: false })
    h.gh.setFiles({ ...FILES, 'skills/find-skills/SKILL.md': SKILL('find-skills').replace('body', 'new body') })
    await h.service.refreshProviders()
    const r = await h.service.updateSkill({ name: 'find-skills', scope: 'global' })
    expect(r.ok).toBe(true)
    const content = await h.fs.readFile('/home/u/.agents/skills/find-skills/SKILL.md')
    expect(content).toContain('new body')
    expect(content).toContain('disable-model-invocation: true')
    expect(content).toContain('user-invocable: false')
    const state = await h.service.state()
    expect(state.installed.find((s) => s.name === 'find-skills')!.enabled).toBe(false)
  })
  it('prunes files that disappeared upstream but keeps the manifest', async () => {
    const h = makeHarness()
    await installV1(h)
    expect(h.fs.has('/home/u/.agents/skills/find-skills/references/note.md')).toBe(true)
    h.gh.setFiles({ 'skills/find-skills/SKILL.md': FILES['skills/find-skills/SKILL.md']!, 'skills/other-skill/SKILL.md': FILES['skills/other-skill/SKILL.md']! })
    await h.service.refreshProviders()
    const r = await h.service.updateSkill({ name: 'find-skills', scope: 'global' })
    expect(r.ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/find-skills/references/note.md')).toBe(false)
    expect(h.fs.has(`/home/u/.agents/skills/find-skills/${MANIFEST_FILE}`)).toBe(true)
  })
  it('refuses skills not installed from a provider', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo'), '/home/u/.agents/skills/bar.md': SKILL('bar') })
    expect(await h.service.updateSkill({ name: 'foo', scope: 'global' }))
      .toEqual({ ok: false, error: 'skill "foo" was not installed from a provider' })
    expect(await h.service.updateSkill({ name: 'bar', scope: 'global' }))
      .toEqual({ ok: false, error: 'skill "bar" was not installed from a provider' })
    expect(await h.service.updateSkill({ name: 'missing', scope: 'global' }))
      .toEqual({ ok: false, error: 'skill "missing" not found' })
  })
  it('errors when the provider no longer offers the skill', async () => {
    const h = makeHarness()
    await installV1(h)
    h.gh.setFiles({ 'skills/other-skill/SKILL.md': FILES['skills/other-skill/SKILL.md']! })
    await h.service.refreshProviders()
    const r = await h.service.updateSkill({ name: 'find-skills', scope: 'global' })
    expect(r).toEqual({ ok: false, error: 'provider "o/r" no longer offers "find-skills"' })
  })
})

describe('updateAllCopies', () => {
  /** Move the provider ahead and re-sync so every installed copy is outdated. */
  async function bumpProvider(h: Harness): Promise<void> {
    h.gh.setFiles({ ...FILES, 'skills/find-skills/SKILL.md': SKILL('find-skills').replace('body', 'new body') })
    await h.service.refreshProviders()
  }

  async function installEverywhere(h: Harness): Promise<void> {
    await h.service.addProvider('o/r')
    expect((await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'global' })).ok).toBe(true)
    expect((await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'workspace', workspacePath: '/repo-a' })).ok).toBe(true)
    expect((await h.service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'workspace', workspacePath: '/repo-b' })).ok).toBe(true)
  }

  it('updates the global copy plus every workspace copy in one call', async () => {
    const h = makeHarness()
    await installEverywhere(h)
    await bumpProvider(h)
    const r = await h.service.updateAllCopies({ name: 'find-skills', workspacePaths: ['/repo-a', '/repo-b'] })
    expect(r).toEqual({ ok: true, state: expect.objectContaining({ installed: expect.anything() }) })
    expect(r).not.toHaveProperty('warning')
    const content = await h.fs.readFile('/home/u/.agents/skills/find-skills/SKILL.md')
    expect(content).toContain('new body')
    expect(await h.fs.readFile('/repo-a/.agents/skills/find-skills/SKILL.md')).toContain('new body')
    expect(await h.fs.readFile('/repo-b/.agents/skills/find-skills/SKILL.md')).toContain('new body')
    const state = await h.service.state('/repo-a')
    for (const copy of state.installed.filter((s) => s.name === 'find-skills')) {
      expect(copy.updateAvailable).toBe(false)
    }
  })

  it('preserves each copy’s own disabled state', async () => {
    const h = makeHarness()
    await installEverywhere(h)
    await h.service.setEnabled({ name: 'find-skills', scope: 'workspace', enabled: false, workspacePath: '/repo-a' })
    await bumpProvider(h)
    const r = await h.service.updateAllCopies({ name: 'find-skills', workspacePaths: ['/repo-a', '/repo-b'] })
    expect(r.ok).toBe(true)
    const a = await h.fs.readFile('/repo-a/.agents/skills/find-skills/SKILL.md')
    expect(a).toContain('new body')
    expect(a).toContain('disable-model-invocation: true')
    const b = await h.fs.readFile('/repo-b/.agents/skills/find-skills/SKILL.md')
    expect(b).toContain('new body')
    expect(b).not.toContain('disable-model-invocation: true')
  })

  it('warns and skips a non-provider copy while updating the rest', async () => {
    const h = makeHarness()
    await installEverywhere(h)
    // Strip the global copy's manifest: it is no longer provider-installed.
    await h.fs.rm(`/home/u/.agents/skills/find-skills/${MANIFEST_FILE}`, { force: true })
    await bumpProvider(h)
    const r = await h.service.updateAllCopies({ name: 'find-skills', workspacePaths: ['/repo-a'] })
    expect(r.ok).toBe(true)
    expect(r).toHaveProperty('warning', 'updated 1 copy of "find-skills"; skipped global (not provider-installed)')
    expect(await h.fs.readFile('/repo-a/.agents/skills/find-skills/SKILL.md')).toContain('new body')
  })

  it('skips workspace shadows (they are not real installs)', async () => {
    const h = makeHarness()
    await installEverywhere(h)
    await h.service.setEnabled({ name: 'find-skills', scope: 'workspace', enabled: false, workspacePath: '/repo-c', description: 'find-skills skill' })
    await bumpProvider(h)
    const r = await h.service.updateAllCopies({ name: 'find-skills', workspacePaths: ['/repo-c'] })
    expect(r.ok).toBe(true)
    expect(r).toHaveProperty('warning', 'updated 1 copy of "find-skills"; skipped workspace /repo-c (shadow)')
    expect(h.fs.has('/repo-c/.agents/skills/find-skills/SKILL.md')).toBe(true)
  })

  it('fails with all per-copy errors when every copy fails', async () => {
    const h = makeHarness()
    await installEverywhere(h)
    await bumpProvider(h)
    // The provider drops the skill: every copy now points at a missing catalog entry.
    h.gh.setFiles({ 'skills/other-skill/SKILL.md': FILES['skills/other-skill/SKILL.md']! })
    await h.service.refreshProviders()
    const r = await h.service.updateAllCopies({ name: 'find-skills', workspacePaths: ['/repo-a'] })
    expect(r).toEqual({ ok: false, error: 'failed to update "find-skills": global: provider "o/r" no longer offers "find-skills"; workspace /repo-a: provider "o/r" no longer offers "find-skills"' })
  })

  it('reports not found when no copy exists', async () => {
    const h = makeHarness()
    expect(await h.service.updateAllCopies({ name: 'missing', workspacePaths: ['/repo-a'] }))
      .toEqual({ ok: false, error: 'skill "missing" not found' })
  })

  it('rejects an invalid name', async () => {
    const h = makeHarness()
    expect(await h.service.updateAllCopies({ name: 'Bad Name' }))
      .toEqual({ ok: false, error: 'invalid skill name "Bad Name"' })
  })
})

describe('setEnabled', () => {
  it('disables then re-enables a global skill via the frontmatter flags', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo') })
    const off = await h.service.setEnabled({ name: 'foo', scope: 'global', enabled: false })
    expect(off.ok).toBe(true)
    const offState = (off as { state: SkillsState }).state.installed.find((s) => s.name === 'foo')!
    expect(offState.enabled).toBe(false)
    expect(offState.userInvocable).toBe(false)
    const on = await h.service.setEnabled({ name: 'foo', scope: 'global', enabled: true })
    const onState = (on as { state: SkillsState }).state.installed.find((s) => s.name === 'foo')!
    expect(onState.enabled).toBe(true)
    expect(onState.userInvocable).toBe(true)
  })
  it('returns not found for a missing global skill', async () => {
    const h = makeHarness()
    const r = await h.service.setEnabled({ name: 'missing', scope: 'global', enabled: false })
    expect(r).toEqual({ ok: false, error: 'skill "missing" not found' })
  })
  it('creates a shadow when disabling a global-only skill in a workspace', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo') })
    const r = await h.service.setEnabled({ name: 'foo', scope: 'workspace', enabled: false, workspacePath: '/repo', description: 'foo skill' })
    expect(r.ok).toBe(true)
    const shadow = await h.fs.readFile('/repo/.agents/skills/foo/SKILL.md')
    expect(shadow).toContain('disable-model-invocation: true')
    expect(shadow).toContain('user-invocable: false')
    expect(shadow).toContain('dsh-next-skills:workspace-shadow')
  })
  it('re-enabling removes the workspace shadow', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo') })
    await h.service.setEnabled({ name: 'foo', scope: 'workspace', enabled: false, workspacePath: '/repo', description: 'foo skill' })
    const r = await h.service.setEnabled({ name: 'foo', scope: 'workspace', enabled: true, workspacePath: '/repo', description: 'foo skill' })
    expect(r.ok).toBe(true)
    expect(h.fs.has('/repo/.agents/skills/foo/SKILL.md')).toBe(false)
    const state = await h.service.state('/repo')
    expect(state.installed.find((s) => s.name === 'foo')!.scope).toBe('global')
  })
  it('requires a workspacePath for workspace scope', async () => {
    const h = makeHarness()
    const r = await h.service.setEnabled({ name: 'foo', scope: 'workspace', enabled: false })
    expect(r).toEqual({ ok: false, error: 'workspace scope requires a workspacePath' })
  })
  it('rejects an invalid skill name', async () => {
    const h = makeHarness()
    const r = await h.service.setEnabled({ name: 'Bad Name', scope: 'global', enabled: false })
    expect(r).toEqual({ ok: false, error: 'invalid skill name "Bad Name"' })
  })
})

describe('remove (recoverable)', () => {
  it('moves a bundle skill into the .trash sibling and out of discovery', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo') })
    const r = await h.service.remove({ name: 'foo', scope: 'global' })
    expect(r.ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/foo')).toBe(false)
    const trashed = Object.keys(h.fs.snapshot()).filter((p) => p.startsWith('/home/u/.agents/skills/.trash/'))
    expect(trashed).toHaveLength(1)
    expect(trashed[0]).toMatch(/\.trash\/\d+-foo\/SKILL\.md$/)
    expect((await h.service.state()).installed).toHaveLength(0)
  })
  it('moves a flat skill file into .trash too', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/foo.md': SKILL('foo') })
    const r = await h.service.remove({ name: 'foo', scope: 'global' })
    expect(r.ok).toBe(true)
    expect(h.fs.has('/home/u/.agents/skills/foo.md')).toBe(false)
    const trashed = Object.keys(h.fs.snapshot()).filter((p) => p.startsWith('/home/u/.agents/skills/.trash/'))
    expect(trashed).toHaveLength(1)
  })
  it('deletes a plugin-generated workspace shadow outright', async () => {
    const h = makeHarness({ '/home/u/.agents/skills/foo/SKILL.md': SKILL('foo') })
    await h.service.setEnabled({ name: 'foo', scope: 'workspace', enabled: false, workspacePath: '/repo', description: 'foo skill' })
    const r = await h.service.remove({ name: 'foo', scope: 'workspace', workspacePath: '/repo' })
    expect(r.ok).toBe(true)
    // No shadow anywhere: not in place, not in trash.
    expect(Object.keys(h.fs.snapshot()).some((p) => p.includes('.trash'))).toBe(false)
    // The global skill is untouched.
    expect(h.fs.has('/home/u/.agents/skills/foo/SKILL.md')).toBe(true)
  })
  it('returns not found for a missing skill', async () => {
    const h = makeHarness()
    expect(await h.service.remove({ name: 'foo', scope: 'global' })).toEqual({ ok: false, error: 'skill "foo" not found' })
  })
})

