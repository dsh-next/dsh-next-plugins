import { describe, expect, it } from 'vitest'
import type { FetchLike, SkillsState } from '../src/core/types.ts'
import { SkillsService } from '../src/host/skills-service.ts'
import { createMemFs } from './helpers/memfs.ts'
import { createGhDouble } from './helpers/gh.ts'
import { MemConfigFace } from './helpers/config-face.ts'

/**
 * RPC contract test: pins the browser-facing envelopes. `state()` must return
 * the full envelope (installed + providers + catalog), and the mutation
 * methods must answer with the shared `{ ok, error | state }` shape. A
 * `setSkillScope` write must round-trip through the settings scope face so a
 * fresh `getState` observes it — the settings-persistence guarantee the panel
 * and cross-developer sharing rely on.
 */
const SKILL = '---\nname: foo\ndescription: foo skill\n---\nbody\n'

function makeService(): { service: SkillsService; config: MemConfigFace } {
  const gh = createGhDouble({
    files: {
      'skills/find-skills/SKILL.md': '---\nname: find-skills\ndescription: find skills\n---\nbody\n',
      'skills/other-skill/SKILL.md': '---\nname: other-skill\ndescription: other skill\n---\nbody\n',
    },
  })
  const config = new MemConfigFace()
  const service = new SkillsService({
    fs: createMemFs({ '/home/u/.agents/skills/foo/SKILL.md': SKILL }),
    fetch: gh.fetch as FetchLike,
    dshHome: '/home/u/.dsh',
    agentsHome: '/home/u/.agents',
    config,
  })
  return { service, config }
}

describe('skills state() RPC contract', () => {
  it('returns the full envelope: installed, providers, catalog (no config section)', async () => {
    const state = await makeService().service.state()
    expect(Object.keys(state).sort()).toEqual(['catalog', 'installed', 'providers'])
    expect(Array.isArray(state.installed)).toBe(true)
    expect(Array.isArray(state.providers)).toBe(true)
    expect(Array.isArray(state.catalog)).toBe(true)
  })

  it('envelope.installed carries the normalized skill fields', async () => {
    const state = await makeService().service.state()
    expect(state.installed).toHaveLength(1)
    const skill = state.installed[0]
    expect(skill.name).toBe('foo')
    expect(skill.scope).toBe('global')
    expect(Object.keys(skill).sort()).toEqual([
      'description', 'directory', 'kind', 'name', 'path', 'scope', 'source',
    ])
  })

  it('a setSkillScope write persists through the settings scope face and reads back', async () => {
    const { service, config } = makeService()
    const result = await service.setSkillScope({ name: 'foo', workspaces: ['/Users/x/repo'] })
    expect(result).toHaveProperty('ok', true)
    expect(result).toHaveProperty('state')
    // The settings face (settings.yaml section) received the name list.
    expect(config.raw().scopes).toEqual({ foo: ['repo'] })
    // A fresh read observes the write (round-trip) through the envelope's
    // per-copy configScope projection.
    const state = await service.state() as SkillsState
    expect(state.installed.find((s) => s.name === 'foo')!.configScope).toEqual(['repo'])
  })

  it('a null workspaces list clears the scope (distinct from an empty list)', async () => {
    const { service, config } = makeService()
    await service.setSkillScope({ name: 'foo', workspaces: [] })
    expect(config.raw().scopes).toEqual({ foo: [] }) // off everywhere
    // Through the same path the browser uses, null means "clear".
    const cleared = await service.setSkillScope({ name: 'foo', workspaces: null })
    expect(cleared).toHaveProperty('ok', true)
    expect(config.raw().scopes).toEqual({})
  })

  it('mutation failures carry { ok: false, error } and success { ok: true, state }', async () => {
    const { service } = makeService()
    const fail = await service.deleteSkill({ name: 'foo', directory: '/tmp/outside', kind: 'bundle', path: '/tmp/outside/SKILL.md' })
    expect(fail).toEqual({ ok: false, error: 'directory is not inside a managed skill root' })
    const ok = await service.setSkillScope({ name: 'foo', workspaces: null })
    expect(ok).toHaveProperty('ok', true)
    expect(ok).toHaveProperty('state')
  })

  it('detachSkill round-trips: the ledger write persists and reads back as unrecorded', async () => {
    const { service, config } = makeService()
    await service.addProvider('o/r')
    await service.installSkill({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    expect(config.raw().installations).toHaveLength(1)
    const result = await service.detachSkill({ name: 'find-skills', directory: '/home/u/.agents/skills/find-skills' })
    expect(result).toHaveProperty('ok', true)
    expect(result).toHaveProperty('state')
    expect(config.raw().installations).toEqual([])
    const state = await service.state() as SkillsState
    expect(state.installed.find((s) => s.name === 'find-skills')!.provider).toBeUndefined()
  })

  it('state() serves provider rows and catalog skills after a sync', async () => {
    const { service } = makeService()
    await service.addProvider('o/r')
    const state = await service.state()
    expect(state.providers).toHaveLength(1)
    expect(state.providers[0]).toMatchObject({ id: 'o-r', spec: 'o/r' })
    expect(state.catalog.map((s) => s.name)).toEqual(['find-skills', 'other-skill'])
  })
})
