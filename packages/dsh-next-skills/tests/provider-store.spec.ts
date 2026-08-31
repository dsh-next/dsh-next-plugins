import { describe, expect, it } from 'vitest'
import { groupTreeBySkill, ProviderStore } from '../src/host/provider-store.ts'
import { parseCatalog } from '../src/core/catalog.ts'
import { createMemFs } from './helpers/memfs.ts'
import { createGhDouble } from './helpers/gh.ts'

const SKILL_MD = (name: string, description = `${name} skill`) => `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`

const FILES: Record<string, string> = {
  'README.md': '# repo',
  'skills/find-skills/SKILL.md': SKILL_MD('find-skills'),
  'skills/find-skills/references/note.md': 'note',
  'skills/other-skill/SKILL.md': SKILL_MD('other-skill'),
  'nested/deep/third-skill/SKILL.md': SKILL_MD('third-skill'),
  'docs/guide.md': 'guide',
  '.github/workflows/ci.yml': 'ci',
  'site/node_modules/pkg/x.md': 'x',
}

const CACHE = '/home/u/.dsh/skills-market'

function makeStore(opts: { tarballStatus?: number } = {}) {
  const fs = createMemFs()
  const gh = createGhDouble({ files: FILES, tarballStatus: opts.tarballStatus })
  const store = new ProviderStore({ fs, fetch: gh.fetch, cacheRoot: CACHE })
  return { fs, gh, store }
}

describe('ProviderStore provider list', () => {
  it('persists and reloads the configured providers', async () => {
    const { store } = makeStore()
    expect(await store.listProviders()).toEqual([])
    await store.saveProviders([{ id: 'o-r', spec: 'o/r', addedAt: 'x' }])
    expect(await store.listProviders()).toEqual([{ id: 'o-r', spec: 'o/r', addedAt: 'x' }])
  })

  it('degrades to an empty list when the file is missing, corrupt, or malformed', async () => {
    const { fs, store } = makeStore()
    expect(await store.listProviders()).toEqual([])
    await fs.mkdir(CACHE, { recursive: true })
    await fs.writeFile(`${CACHE}/providers.json`, '{not json')
    expect(await store.listProviders()).toEqual([])
    await fs.writeFile(`${CACHE}/providers.json`, JSON.stringify({ providers: 'nope' }))
    expect(await store.listProviders()).toEqual([])
    await fs.writeFile(`${CACHE}/providers.json`, JSON.stringify({ providers: [
      { id: 'ok', spec: 'o/k', addedAt: 'x' },
      { id: '', spec: 'o/k', addedAt: 'x' },
      { id: 'no-spec', spec: '', addedAt: 'x' },
      'junk',
    ] }))
    expect(await store.listProviders()).toEqual([{ id: 'ok', spec: 'o/k', addedAt: 'x' }])
  })
})

describe('groupTreeBySkill', () => {
  const TREE = [
    { path: 'README.md', type: 'blob', sha: 'r1' },
    { path: 'skills/find-skills/SKILL.md', type: 'blob', sha: 's1' },
    { path: 'skills/find-skills/references/note.md', type: 'blob', sha: 'n1' },
    { path: 'skills/other-skill/SKILL.md', type: 'blob', sha: 's2' },
    { path: 'nested/deep/third-skill/SKILL.md', type: 'blob', sha: 's3' },
    { path: 'docs/guide.md', type: 'blob', sha: 'd1' },
    { path: '.github/workflows/ci.yml', type: 'blob', sha: 'g1' },
    { path: 'site/node_modules/pkg/x.md', type: 'blob', sha: 'm1' },
  ]
  it('groups blobs under the nearest SKILL.md directory at any depth', () => {
    const grouped = groupTreeBySkill(TREE)
    expect([...grouped.keys()].sort()).toEqual(['nested/deep/third-skill', 'skills/find-skills', 'skills/other-skill'])
    expect(grouped.get('skills/find-skills')).toEqual([
      { path: 'SKILL.md', sha: 's1' },
      { path: 'references/note.md', sha: 'n1' },
    ])
  })
  it('ignores files outside any skill directory and metadata dirs', () => {
    const grouped = groupTreeBySkill(TREE)
    const all = [...grouped.values()].flat()
    expect(all.some((f) => f.path.includes('guide'))).toBe(false)
    expect(all.some((f) => f.path.includes('ci.yml'))).toBe(false)
    expect(all.some((f) => f.path.includes('node_modules'))).toBe(false)
  })
})

describe('ProviderStore.syncProvider (snapshot download)', () => {
  it('extracts every skill from the snapshot and writes the catalog with repo metadata', async () => {
    const { fs, gh, store } = makeStore()
    const provider = await store.syncProvider('o/r')
    expect(provider.spec).toBe('o/r')
    expect(provider.branch).toBe('HEAD')
    expect(provider.description).toBe('Test repository for skills sync')
    expect(provider.stars).toBe(42)
    expect(provider.skills.map((s) => s.name).sort()).toEqual(['find-skills', 'other-skill', 'third-skill'])
    expect(fs.has(`${CACHE}/files/o-r/skills__find-skills/SKILL.md`)).toBe(true)
    expect(fs.has(`${CACHE}/files/o-r/skills__find-skills/references/note.md`)).toBe(true)
    expect(fs.has(`${CACHE}/files/o-r/nested__deep__third-skill/SKILL.md`)).toBe(true)
    // Non-skill files (README, docs, CI, node_modules) are never cached.
    expect(fs.has(`${CACHE}/files/o-r/README.md`)).toBe(false)
    expect(fs.has(`${CACHE}/files/o-r/docs__guide.md`)).toBe(false)
    const catalog = parseCatalog(JSON.parse(await fs.readFile(`${CACHE}/catalog.json`)))
    expect(catalog.providers).toHaveLength(1)
    expect(catalog.providers[0].description).toBe('Test repository for skills sync')
    expect(catalog.providers[0].stars).toBe(42)
    expect(catalog.providers[0].skills.find((s) => s.name === 'find-skills')?.description).toBe('find-skills skill')
    // Metadata (one API call) + one snapshot download — no per-file requests.
    expect(gh.apiCalls()).toBe(1)
    expect(gh.snapshotCalls()).toBe(1)
  })

  it('refreshes repo metadata on every sync', async () => {
    const { fs, gh, store } = makeStore()
    await store.syncProvider('o/r')
    expect(gh.apiCalls()).toBe(1)
    expect(gh.snapshotCalls()).toBe(1)
    await store.syncProvider('o/r')
    expect(gh.apiCalls()).toBe(2)
    expect(gh.snapshotCalls()).toBe(2)
    const catalog = parseCatalog(JSON.parse(await fs.readFile(`${CACHE}/catalog.json`)))
    expect(catalog.providers[0].stars).toBe(42)
  })

  it('keeps versions and cached files stable when the snapshot is unchanged', async () => {
    const { gh, store } = makeStore()
    const first = await store.syncProvider('o/r')
    const versions = Object.fromEntries(first.skills.map((s) => [s.name, s.version]))
    gh.setFiles({ ...FILES })
    const second = await store.syncProvider('o/r')
    for (const skill of second.skills) {
      expect(skill.version).toBe(versions[skill.name])
    }
  })

  it('changes only the edited skill’s version when one file changes', async () => {
    const { gh, store } = makeStore()
    const first = await store.syncProvider('o/r')
    const v1 = first.skills.find((s) => s.name === 'find-skills')!.version
    const otherV1 = first.skills.find((s) => s.name === 'other-skill')!.version
    gh.setFiles({ ...FILES, 'skills/find-skills/SKILL.md': SKILL_MD('find-skills', 'updated') })
    const second = await store.syncProvider('o/r')
    const updated = second.skills.find((s) => s.name === 'find-skills')!
    expect(updated.version).not.toBe(v1)
    expect(updated.description).toBe('updated')
    expect(second.skills.find((s) => s.name === 'other-skill')!.version).toBe(otherV1)
    expect(await store.readCachedFile('o-r', updated, 'SKILL.md')).toContain('updated')
  })

  it('prunes cache files of skills removed upstream', async () => {
    const { fs, gh, store } = makeStore()
    await store.syncProvider('o/r')
    const remaining = Object.fromEntries(Object.entries(FILES).filter(([k]) => !k.startsWith('skills/other-skill')))
    gh.setFiles(remaining)
    await store.syncProvider('o/r')
    expect(fs.has(`${CACHE}/files/o-r/skills__other-skill/SKILL.md`)).toBe(false)
    expect(fs.has(`${CACHE}/files/o-r/skills__find-skills/SKILL.md`)).toBe(true)
  })

  it('rejects an invalid spec', async () => {
    const { store } = makeStore()
    await expect(store.syncProvider('nope')).rejects.toThrow(/invalid provider spec/)
  })

  it('surfaces snapshot download failures', async () => {
    const { store } = makeStore({ tarballStatus: 404 })
    await expect(store.syncProvider('o/r')).rejects.toThrow(/repository not found/)
  })

  it('falls back to the directory name when the SKILL.md has no frontmatter', async () => {
    const fs = createMemFs()
    const gh = createGhDouble({ files: { 'skills/plain/SKILL.md': '# just a body\n' } })
    const store = new ProviderStore({ fs, fetch: gh.fetch, cacheRoot: CACHE })
    const provider = await store.syncProvider('o/r')
    expect(provider.skills[0].name).toBe('plain')
    expect(provider.skills[0].description).toBe('Skill from o/r')
    expect(provider.skills[0].whenToUse).toBeUndefined()
  })

  it('skips an oversized skill group instead of failing the provider', async () => {
    const fs = createMemFs()
    const bloated: Record<string, string> = { 'SKILL.md': SKILL_MD('root-skill') }
    // Subdirectory files without a closer SKILL.md are hoovered into the
    // root group — pushing it over the per-skill file limit.
    for (let i = 0; i < 201; i++) bloated[`docs/file-${i}.md`] = `content ${i}`
    bloated['skills/tiny/SKILL.md'] = SKILL_MD('tiny')
    const gh = createGhDouble({ files: bloated })
    const store = new ProviderStore({ fs, fetch: gh.fetch, cacheRoot: CACHE })
    const provider = await store.syncProvider('o/r')
    // The oversized root group is dropped; the healthy skill still syncs.
    expect(provider.skills.map((s) => s.name)).toEqual(['tiny'])
  })
})

describe('ProviderStore errors and removal', () => {
  it('records a sync error on the catalog row and keeps the last good cache', async () => {
    const { fs, gh, store } = makeStore()
    await store.syncProvider('o/r')
    gh.setTarballStatus(404)
    await expect(store.syncProvider('o/r')).rejects.toThrow()
    await store.markProviderError('o-r', 'boom')
    const catalog = parseCatalog(JSON.parse(await fs.readFile(`${CACHE}/catalog.json`)))
    expect(catalog.providers[0].error).toBe('boom')
    // The last good cache survives the failed sync.
    expect(fs.has(`${CACHE}/files/o-r/skills__find-skills/SKILL.md`)).toBe(true)
  })

  it('records the error for a never-synced provider (no more swallowed failures)', async () => {
    const { fs, store } = makeStore()
    await store.saveProviders([{ id: 'never-synced', spec: 'other/repo', addedAt: 'x' }])
    await store.markProviderError('never-synced', 'boom')
    const catalog = parseCatalog(JSON.parse(await fs.readFile(`${CACHE}/catalog.json`)))
    expect(catalog.providers).toHaveLength(1)
    expect(catalog.providers[0]).toMatchObject({ id: 'never-synced', spec: 'other/repo', error: 'boom' })
    const view = (await store.listProviders()).find((p) => p.id === 'never-synced')
    expect(view).toBeTruthy()
  })

  it('removes the catalog entry and cached files', async () => {
    const { fs, store } = makeStore()
    await store.syncProvider('o/r')
    await store.removeProvider('o-r')
    const catalog = parseCatalog(JSON.parse(await fs.readFile(`${CACHE}/catalog.json`)))
    expect(catalog.providers).toHaveLength(0)
    expect(fs.has(`${CACHE}/files/o-r/skills__find-skills/SKILL.md`)).toBe(false)
  })

  it('readCatalog degrades to empty when the file is missing', async () => {
    const { store } = makeStore()
    expect(await store.readCatalog()).toEqual({ providers: [] })
  })
})
