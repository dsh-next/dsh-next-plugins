import { describe, expect, it } from 'vitest'
import type { FetchLike } from '../src/core/types.ts'
import { SkillsService } from '../src/host/skills-service.ts'
import { createMemFs } from './helpers/memfs.ts'
import { createGhDouble } from './helpers/gh.ts'

/**
 * RPC contract test: the Host `state()` must return the full browser-facing
 * envelope (`installed` only — the manager has no settings anymore), and the
 * mutation methods must answer with the shared `{ ok, error | state }` shape.
 * This pins the regression class where a silent payload-shape mismatch returns
 * HTTP 200 yet renders nothing.
 */
const SKILL = '---\nname: foo\ndescription: foo skill\n---\nbody\n'

function makeService(): SkillsService {
  const gh = createGhDouble()
  return new SkillsService({
    fs: createMemFs({ '/home/u/.agents/skills/foo/SKILL.md': SKILL }),
    fetch: gh.fetch as FetchLike,
    dshHome: '/home/u/.dsh',
    agentsHome: '/home/u/.agents',
  })
}

describe('skills state() RPC contract', () => {
  it('returns the envelope, not the raw config', async () => {
    const state = await makeService().state()
    expect(state).toHaveProperty('installed')
    // Raw config keys must NOT sit at the envelope's top level.
    expect(state).not.toHaveProperty('enabled')
    expect(state).not.toHaveProperty('providers')
    expect(state).not.toHaveProperty('githubToken')
    expect(state).not.toHaveProperty('config')
  })

  it('envelope.installed carries the normalized skill fields', async () => {
    const state = await makeService().state()
    expect(state.installed).toHaveLength(1)
    const skill = state.installed[0]
    expect(skill.name).toBe('foo')
    expect(skill.enabled).toBe(true)
    expect(skill.scope).toBe('global')
    expect(Object.keys(skill).sort()).toEqual(['description', 'directory', 'enabled', 'kind', 'name', 'path', 'scope', 'source', 'userInvocable'])
  })

  it('installedMap serves the global root plus each requested workspace', async () => {
    const service = makeService()
    const map = await service.installedMap(['/repo'])
    expect(map.global.map((s) => s.name)).toEqual(['foo'])
    // The workspace list covers only that workspace's own roots: the global
    // copy above does not leak into it.
    expect(map.workspaces).toEqual([{ workspacePath: '/repo', installed: [] }])
  })

  it('mutation failures carry { ok: false, error } and success { ok: true, state }', async () => {
    const service = makeService()
    const fail = await service.remove({ name: 'missing', scope: 'global' })
    expect(fail).toEqual({ ok: false, error: 'skill "missing" not found' })
    const ok = await service.setEnabled({ name: 'foo', scope: 'global', enabled: false })
    expect(ok).toHaveProperty('ok', true)
    expect(ok).toHaveProperty('state')
  })

  it('marketplace() serves catalog skills and provider rows', async () => {
    const service = makeService()
    const view = await service.marketplace()
    expect(view).toEqual({ skills: [], providers: [] })
  })

  it('updateAllCopies follows the same envelope and reports outcomes', async () => {
    const gh = createGhDouble({ files: { 'skills/foo/SKILL.md': SKILL } })
    const service = new SkillsService({
      fs: createMemFs({}),
      fetch: gh.fetch as FetchLike,
      dshHome: '/home/u/.dsh',
      agentsHome: '/home/u/.agents',
    })
    // Not installed anywhere: the plain { ok: false, error } envelope.
    expect(await service.updateAllCopies({ name: 'foo', workspacePaths: ['/repo'] }))
      .toEqual({ ok: false, error: 'skill "foo" not found' })
    expect((await service.addProvider('o/r')).ok).toBe(true)
    expect((await service.installSkill({ providerId: 'o-r', skillPath: 'skills/foo', scope: 'global' })).ok).toBe(true)
    // Already current: success without a warning key.
    const ok = await service.updateAllCopies({ name: 'foo', workspacePaths: ['/repo'] })
    expect(ok).toHaveProperty('ok', true)
    expect(ok).toHaveProperty('state')
    expect(ok).not.toHaveProperty('warning')
    // The provider moves ahead: update-all clears the stale flag.
    gh.setFiles({ 'skills/foo/SKILL.md': SKILL.replace('body', 'new body') })
    await service.refreshProviders()
    expect((await service.state()).installed.find((s) => s.name === 'foo')!.updateAvailable).toBe(true)
    expect((await service.updateAllCopies({ name: 'foo', workspacePaths: ['/repo'] })).ok).toBe(true)
    expect((await service.state()).installed.find((s) => s.name === 'foo')!.updateAvailable).toBe(false)
  })
})
