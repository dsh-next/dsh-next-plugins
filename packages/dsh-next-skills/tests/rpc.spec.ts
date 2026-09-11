import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { registerRpc } from '../src/host/rpc.ts'
import { SkillsService } from '../src/host/skills-service.ts'
import { createMemFs } from './helpers/memfs.ts'
import { createGhDouble } from './helpers/gh.ts'
import { MemConfigFace } from './helpers/config-face.ts'

function harness(serviceOverride?: SkillsService) {
  const fs = createMemFs()
  const config = new MemConfigFace()
  const service = serviceOverride ?? new SkillsService({ fs, config, dshHome: '/d', agentsHome: '/a', fetch: createGhDouble({ files: { 'skills/foo/SKILL.md': '---\nname: foo\ndescription: foo skill\n---\nbody\n' } }).fetch })
  let route!: { kind: string; path: string; handler(req: IncomingMessage, res: ServerResponse): void }
  let dispose!: () => void
  const off = vi.fn()
  registerRpc({ get: () => ({ register: (value: typeof route) => { route = value; return off } }), effect: (fn: () => () => void) => { dispose = fn() } } as unknown as Context, service)
  async function raw(body: string, method = 'POST') {
    let status = 0
    const req = Object.assign(new EventEmitter(), { method, destroy: vi.fn() })
    return new Promise<{ status: number; body: string; destroyed: boolean }>((resolve) => {
      const res = { writableEnded: false, writeHead: (code: number) => { status = code }, end: (text = '') => {
        res.writableEnded = true
        queueMicrotask(() => resolve({ status, body: text, destroyed: req.destroy.mock.calls.length > 0 }))
      } }
      route.handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
      req.emit('data', body)
      req.emit('end')
    })
  }
  const call = async (method: string, args?: unknown) => {
    const result = await raw(JSON.stringify({ method, args }))
    return { ...result, value: result.status === 200 || result.status === 500 ? JSON.parse(result.body) : result.body }
  }
  return { fs, config, service, route, raw, call, dispose: () => dispose(), off }
}

describe('registered skills RPC', () => {
  it('registers the exact route and disposes it', () => {
    const h = harness()
    expect(h.route).toMatchObject({ kind: 'exact', path: '/dsh-next-skills/rpc' })
    h.dispose()
    expect(h.off).toHaveBeenCalledOnce()
  })

  it('does nothing without a web server', () => {
    const effect = vi.fn()
    for (const server of [undefined, {}]) registerRpc({ get: () => server, effect } as unknown as Context, {} as SkillsService)
    expect(effect).not.toHaveBeenCalled()
  })

  it.each(['setSkillScope', 'setExternalSkillScope', 'listWorkspaces', 'toString', '__proto__'])('does not expose removed or inherited method %s', async (method) => {
    const h = harness()
    expect(await h.call(method, { name: 'foo', workspaces: [] })).toMatchObject({ status: 404, body: 'no such method: ' + method })
    expect(h.config.raw()).toEqual({})
    expect(h.fs.snapshot()).toEqual({})
  })

  it('passes only catalog identifiers to the install service', async () => {
    const h = harness()
    const install = vi.spyOn(h.service, 'installSkill').mockResolvedValue({ ok: false, error: 'not configured' })
    await h.call('installSkill', { providerId: 'o-r', skillPath: 'skills/foo', scope: { kind: 'workspaces' }, workspaces: ['web'], unrelated: true })
    expect(install).toHaveBeenCalledExactlyOnceWith({ providerId: 'o-r', skillPath: 'skills/foo' })
  })

  it('round-trips a global install through RPC and settings', async () => {
    const h = harness()
    h.config.setSection({ scopes: { foo: [] } })
    expect(await h.call('addProvider', { spec: 'o/r' })).toMatchObject({ status: 200, value: { ok: true } })
    const installed = await h.call('installSkill', { providerId: 'o-r', skillPath: 'skills/foo' })
    expect(installed).toMatchObject({ status: 200, value: { ok: true } })
    expect(Object.keys(h.config.raw()).sort()).toEqual(['installations', 'providers'])
    expect(h.config.raw().installations).toEqual([{ name: 'foo', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/foo' }])
    expect(h.config.updateCalls).toBe(0)
    expect(h.fs.has('/a/skills/foo/SKILL.md')).toBe(true)
    const state = (await h.call('getState')).value
    expect(Object.keys(state).sort()).toEqual(['catalog', 'installed', 'providers'])
    expect(state).toEqual(installed.value.state)
    expect(state.installed[0]).not.toHaveProperty('scope')
    expect(state.installed[0]).not.toHaveProperty('configScope')
  })

  it('preserves detail, update, detach, delete, refresh, reconcile, and provider removal dispatch', async () => {
    const h = harness()
    await h.call('addProvider', { spec: 'o/r' })
    await h.call('installSkill', { providerId: 'o-r', skillPath: 'skills/foo' })
    expect((await h.call('getCatalogSkillDetail', { providerId: 'o-r', skillPath: 'skills/foo' })).value).toMatchObject({ name: 'foo', modelInvocable: true, userInvocable: true, body: 'body\n' })
    expect((await h.call('getInstalledSkillDetail', { name: 'foo', path: '/a/skills/foo/SKILL.md' })).value).toMatchObject({ name: 'foo' })
    expect((await h.call('getInstalledSkillDetail', { name: 'foo', path: '' })).value).toMatchObject({ name: 'foo' })
    expect((await h.call('getInstalledSkillDetail', { name: 'missing' })).value).toBeNull()
    for (const [method, args] of [
      ['updateSkill', { name: 'foo', directory: '/a/skills/foo', providerId: 'o-r', skillPath: 'skills/foo' }],
      ['detachSkill', { name: 'foo', directory: '/a/skills/foo' }],
      ['deleteSkill', { name: 'foo', directory: '/a/skills/foo', path: '/a/skills/foo/SKILL.md', kind: 'bundle' }],
      ['refreshProvider', { providerId: 'o-r' }], ['reconcileInstalled', {}], ['removeProvider', { providerId: 'o-r' }],
    ] as const) expect((await h.call(method, args)).value).toMatchObject({ ok: true })
    await h.fs.writeFile('/a/skills/flat.md', '---\nname: flat\ndescription: flat skill\n---\nbody\n')
    expect((await h.call('deleteSkill', { name: 'flat', directory: '/a/skills', path: '/a/skills/flat.md', kind: 'flat' })).value).toMatchObject({ ok: true })
  })

  it('handles malformed requests, oversized bodies, non-POST, and thrown service errors', async () => {
    const h = harness()
    expect(await h.raw('{}', 'GET')).toMatchObject({ status: 405 })
    expect(await h.raw('{')).toMatchObject({ status: 400 })
    for (const raw of ['', 'null', '[]', '1', '{}']) expect(await h.raw(raw)).toMatchObject({ status: 404 })
    expect(await h.raw('x'.repeat(1048577))).toMatchObject({ status: 413, destroyed: true })
    expect((await h.call('addProvider', { spec: 1 })).value).toMatchObject({ ok: false })
    for (const args of [null, [], 1]) expect((await h.call('installSkill', args)).value).toMatchObject({ ok: false })
    for (const error of [new Error('broken'), 'broken']) {
      const broken = harness({ state: () => { throw error } } as unknown as SkillsService)
      expect(await broken.call('getState')).toMatchObject({ status: 500, value: { error: 'broken' } })
    }
  })
})
