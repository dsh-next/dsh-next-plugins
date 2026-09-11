import { describe, expect, it, vi } from 'vitest'
import { discoverRoot, SkillsService } from '../src/host/skills-service.ts'
import { resolveSkillRoots } from '../src/core/scope.ts'
import { createMemFs } from './helpers/memfs.ts'
import { createGhDouble } from './helpers/gh.ts'
import { MemConfigFace } from './helpers/config-face.ts'

const skill = (name: string, flags = '') => '---\nname: ' + name + '\ndescription: skill\n' + flags + '---\nbody\n'
const root = '/a/skills'

function harness() {
  const fs = createMemFs()
  const config = new MemConfigFace()
  const gh = createGhDouble({ files: { 'skills/foo/SKILL.md': skill('foo') } })
  // Mirrors the native registry's completed-catalog cache. The filesystem
  // provider itself rescans on list; deliberately no watcher or timers here.
  let cached: Awaited<ReturnType<typeof discoverRoot>> | undefined
  const nativeList = async () => cached ??= (await Promise.all(resolveSkillRoots({ dshHome: '/d', agentsHome: '/a' }).map((r) => discoverRoot(fs, r)))).flat()
  const invalidate = vi.fn(() => { cached = undefined })
  const service = new SkillsService({ fs, config, fetch: gh.fetch, dshHome: '/d', agentsHome: '/a', onInstalledChanged: invalidate })
  const install = () => service.installSkill({ providerId: 'o-r', skillPath: 'skills/foo' })
  const external = (names: string[]) => service.installExternalSkills({ owner: 'cc', pluginKey: 'k', marketplaceId: 'm', skills: names.map((name) => ({ name, files: { 'SKILL.md': skill(name) } })) })
  return { fs, config, gh, service, nativeList, invalidate, install, external }
}

describe('native catalog invalidation before mutation responses', () => {
  it('catalog install and update immediately replace a warm native snapshot', async () => {
    const h = harness()
    await h.service.addProvider('o/r')
    expect(await h.nativeList()).toEqual([])
    expect((await h.install()).ok).toBe(true)
    expect((await h.nativeList()).map((r) => r.name)).toEqual(['foo'])
    h.gh.setFiles({ 'skills/foo/SKILL.md': skill('foo', 'user-invocable: false\n') })
    await h.service.refreshProvider('o-r')
    expect((await h.nativeList())[0].fileUserInvocable).toBe(true)
    await h.service.updateSkill({ name: 'foo', directory: root + '/foo', providerId: 'o-r', skillPath: 'skills/foo' })
    expect((await h.nativeList())[0].fileUserInvocable).toBe(false)
  })

  it('deleting one duplicate copy invalidates even though its ledger entry survives', async () => {
    const h = harness()
    await h.service.addProvider('o/r')
    await h.install()
    await h.fs.writeFile('/d/skills/foo/SKILL.md', skill('foo', 'user-invocable: false\n'))
    expect(await h.nativeList()).toHaveLength(2)
    await h.service.deleteSkill({ name: 'foo', directory: '/d/skills/foo', kind: 'bundle', path: '/d/skills/foo/SKILL.md' })
    const remaining = await h.nativeList()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].source).toBe('user-agents')
    expect(h.config.raw().installations).toHaveLength(1)
  })

  it('external installs, updates, and filtered removals invalidate before returning', async () => {
    const h = harness()
    expect(await h.nativeList()).toEqual([])
    expect(await h.external(['one', 'two'])).toEqual({ ok: true })
    expect((await h.nativeList()).map((r) => r.name)).toEqual(['one', 'two'])
    await h.service.installExternalSkills({ owner: 'cc', pluginKey: 'k', marketplaceId: 'm', skills: [{ name: 'one', files: { 'SKILL.md': skill('one', 'disable-model-invocation: true\n') } }] })
    expect((await h.nativeList())[0].fileModelInvocable).toBe(false)
    await h.service.removeExternalSkills({ owner: 'cc', pluginKey: 'k', skillNames: ['one'] })
    expect((await h.nativeList()).map((r) => r.name)).toEqual(['two'])
    await h.service.removeExternalSkills({ owner: 'cc', pluginKey: 'k' })
    expect(await h.nativeList()).toEqual([])
  })

  it('reconcile clears a cached missing skill without waiting for filesystem events', async () => {
    const h = harness()
    await h.service.addProvider('o/r')
    await h.install()
    await h.fs.rm(root + '/foo', { recursive: true })
    expect(await h.nativeList()).toEqual([])
    await h.service.reconcileInstalled()
    expect((await h.nativeList()).map((r) => r.name)).toEqual(['foo'])
  })

  it('flat deletion invalidates immediately while reads and metadata-only edits do not', async () => {
    const h = harness()
    await h.service.addProvider('o/r')
    await h.install()
    h.invalidate.mockClear()
    await h.service.state()
    await h.service.detachSkill({ name: 'foo', directory: root + '/foo' })
    await h.service.removeProvider('o-r')
    await h.service.removeExternalSkills({ owner: 'missing', pluginKey: 'none' })
    expect(await h.install()).toMatchObject({ ok: false, error: expect.stringContaining('not configured') })
    expect(h.invalidate).not.toHaveBeenCalled()
    await h.fs.writeFile(root + '/flat.md', skill('flat'))
    expect(await h.nativeList()).toHaveLength(2)
    await h.service.deleteSkill({ name: 'flat', directory: root, path: root + '/flat.md', kind: 'flat' })
    expect((await h.nativeList()).map((r) => r.name)).toEqual(['foo'])
  })

  it('invalidates partial catalog writes and rollback before returning an error', async () => {
    const h = harness()
    await h.service.addProvider('o/r')
    await h.install()
    expect(await h.nativeList()).toHaveLength(1)
    const write = h.fs.writeFile
    h.fs.writeFile = async (path, content) => {
      if (path.startsWith(root)) throw new Error('disk full')
      await write(path, content)
    }
    expect(await h.service.updateSkill({ name: 'foo', directory: root + '/foo', providerId: 'o-r', skillPath: 'skills/foo' })).toMatchObject({ ok: false, error: expect.stringContaining('disk full') })
    expect(await h.nativeList()).toEqual([])
  })

  it('invalidates partially successful external install and removal failures', async () => {
    const h = harness()
    expect(await h.nativeList()).toEqual([])
    const write = h.fs.writeFile
    h.fs.writeFile = async (path, content) => {
      if (path.includes('/two/')) throw new Error('disk full')
      await write(path, content)
    }
    expect(await h.external(['one', 'two'])).toMatchObject({ ok: false })
    expect((await h.nativeList()).map((r) => r.name)).toEqual(['one'])
    const rename = h.fs.rename
    h.fs.rename = async (from, to) => { await rename(from, to); throw new Error('rename reported failure') }
    await expect(h.service.removeExternalSkills({ owner: 'cc', pluginKey: 'k' })).rejects.toThrow('rename reported failure')
    expect(await h.nativeList()).toEqual([])
  })

  it('observer and warning-sink failures cannot veto writes or mask their errors', async () => {
    const fs = createMemFs()
    const onInstalledChanged = vi.fn(() => { throw new Error('observer failed') })
    const logWarn = vi.fn(() => { throw new Error('logger failed') })
    const service = new SkillsService({ fs, config: new MemConfigFace(), fetch: createGhDouble({ files: {} }).fetch, dshHome: '/d', agentsHome: '/a', onInstalledChanged, logWarn })
    const args = { owner: 'cc', pluginKey: 'k', marketplaceId: 'm', skills: [{ name: 'foo', files: { 'SKILL.md': skill('foo') } }] }
    expect(await service.installExternalSkills(args)).toEqual({ ok: true })
    expect(fs.has(root + '/foo/SKILL.md')).toBe(true)
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('observer failed'))
    fs.writeFile = async () => { throw new Error('disk full') }
    expect(await service.installExternalSkills(args)).toMatchObject({ ok: false, error: expect.stringContaining('disk full') })
    expect(onInstalledChanged).toHaveBeenCalledTimes(2)
  })
})
