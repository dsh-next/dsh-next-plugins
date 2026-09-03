import { describe, expect, it } from 'vitest'
import type { SkillCandidate, SkillLookupOptions } from '@deepseek-ai/dsh-skill'
import { createManagedSkillProvider, MANAGED_PROVIDER_NAME } from '../src/host/skills-provider.ts'
import { createMemFs, type MemFs } from './helpers/memfs.ts'
import { MemConfigFace } from './helpers/config-face.ts'
import type { FsLike } from '../src/core/types.ts'

const SKILL = (name: string, extra = '') => `---\nname: ${name}\ndescription: ${name} skill\n${extra}---\nbody\n`

function makeProvider(fsSeed: Record<string, string>, scopes: Record<string, unknown> = {}) {
  const fs: MemFs & FsLike = createMemFs(fsSeed)
  const config = new MemConfigFace()
  config.setSection({ scopes })
  const provider = createManagedSkillProvider({
    fs,
    dshHome: '/home/u/.dsh',
    agentsHome: '/home/u/.agents',
    config,
  })
  return { fs, config, provider }
}

const lookup = (cwd?: string): SkillLookupOptions => ({ cwd })

async function listNames(provider: ReturnType<typeof createManagedSkillProvider>, cwd?: string): Promise<string[]> {
  const candidates = await provider.list(lookup(cwd)) as readonly SkillCandidate[]
  return candidates.map((c) => c.name)
}

describe('createManagedSkillProvider', () => {
  it('reports the reserved provider name', () => {
    const { provider } = makeProvider({})
    expect(provider.name).toBe(MANAGED_PROVIDER_NAME)
  })

  it('lists skills from the user roots with rank lowered by one', async () => {
    const { provider } = makeProvider({
      '/home/u/.agents/skills/g/SKILL.md': SKILL('g'),
      '/home/u/.dsh/skills/d.md': SKILL('d'),
    })
    const candidates = await provider.list(lookup()) as readonly SkillCandidate[]
    const byName = new Map(candidates.map((c) => [c.name, c]))
    expect(byName.get('g')!.rank).toBe(499)
    expect(byName.get('d')!.rank).toBe(399)
    expect(byName.get('g')!.source).toBe('user-agents')
    expect(byName.get('d')!.source).toBe('user-dsh')
    expect(byName.get('d')!.path).toBe('/home/u/.dsh/skills/d.md')
  })

  it('never lists project/workspace skills, whatever the lookup cwd', async () => {
    const { provider } = makeProvider({
      '/repo/.agents/skills/p/SKILL.md': SKILL('p'),
      '/repo/.dsh/skills/q/SKILL.md': SKILL('q'),
      '/home/u/.agents/skills/g/SKILL.md': SKILL('g'),
    })
    // The lookup cwd is irrelevant now: project roots stay with the native
    // filesystem provider; only global-root skills are re-published.
    expect(await listNames(provider)).toEqual(['g'])
    const withCwd = await provider.list(lookup('/repo')) as readonly SkillCandidate[]
    expect(withCwd.map((c) => c.name)).toEqual(['g'])
    expect(withCwd[0]!.source).toBe('user-agents')
  })

  it('disabled scopes blank both invocation flags; enabled scopes pass the file flags through', async () => {
    const { provider } = makeProvider({
      '/home/u/.agents/skills/off/SKILL.md': SKILL('off'),
      '/home/u/.agents/skills/restricted/SKILL.md': SKILL('restricted', 'user-invocable: false\n'),
    }, {
      off: [],
    })
    const candidates = await provider.list(lookup()) as readonly SkillCandidate[]
    const byName = new Map(candidates.map((c) => [c.name, c]))
    // Disabled by config: invisible to both surfaces.
    expect(byName.get('off')!.invocation).toEqual({ modelInvocable: false, userInvocable: false })
    // Author intent (user-invocable: false) passes through untouched.
    expect(byName.get('restricted')!.invocation).toEqual({ modelInvocable: true, userInvocable: false })
  })

  it('a name whitelist disables the skill outside matching workspace folders', async () => {
    const { provider } = makeProvider({
      '/home/u/.agents/skills/w/SKILL.md': SKILL('w'),
    }, {
      w: ['a'],
    })
    const inScope = await provider.list(lookup('/repo/a')) as readonly SkillCandidate[]
    const outScope = await provider.list(lookup('/repo/b')) as readonly SkillCandidate[]
    expect(inScope.find((c) => c.name === 'w')!.invocation.modelInvocable).toBe(true)
    expect(outScope.find((c) => c.name === 'w')!.invocation.modelInvocable).toBe(false)
  })

  it('get() loads the body, reports the resource base, and applies the scope policy', async () => {
    const { provider, config } = makeProvider({
      '/home/u/.agents/skills/g/SKILL.md': SKILL('g'),
      '/home/u/.agents/skills/g/extra.txt': 'asset',
    })
    const candidate = ((await provider.list(lookup())) as readonly SkillCandidate[])[0]
    const loaded = await provider.get(candidate, lookup())
    expect(loaded).toBeDefined()
    expect(loaded!.name).toBe('g')
    expect(loaded!.content).toBe('body\n')
    expect(loaded!.resourceBase).toEqual({ kind: 'directory', path: '/home/u/.agents/skills/g' })
    expect(loaded!.provider).toBe(MANAGED_PROVIDER_NAME)

    // Flip the scope off; get() must honor it at load time.
    config.setSection({ scopes: { g: [] } })
    const disabled = await provider.get(candidate, lookup())
    expect(disabled!.invocation).toEqual({ modelInvocable: false, userInvocable: false })
  })

  it('get() returns undefined when the file vanished', async () => {
    const { provider, fs } = makeProvider({ '/home/u/.agents/skills/g/SKILL.md': SKILL('g') })
    const candidate = ((await provider.list(lookup())) as readonly SkillCandidate[])[0]
    await fs.rm('/home/u/.agents/skills/g/SKILL.md', { force: true })
    expect(await provider.get(candidate, lookup())).toBeUndefined()
  })

  it('preserves precedence between duplicate names across the global roots', async () => {
    const { provider } = makeProvider({
      '/home/u/.agents/skills/shared/SKILL.md': SKILL('shared'),
      '/home/u/.dsh/skills/shared/SKILL.md': SKILL('shared'),
    })
    const candidates = await provider.list(lookup('/repo')) as readonly SkillCandidate[]
    const shared = candidates.filter((c) => c.name === 'shared').sort((a, b) => a.rank - b.rank)
    // user-dsh outranks user-agents; the rank-1 shift keeps the ordering.
    expect(shared[0].source).toBe('user-dsh')
    expect(shared[0].path).toBe('/home/u/.dsh/skills/shared/SKILL.md')
  })
})
