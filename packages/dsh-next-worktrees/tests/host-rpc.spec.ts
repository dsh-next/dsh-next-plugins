import { describe, expect, it, vi, type Mock } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createHandlers, registerRpc, RPC_PATH } from '../src/host/rpc.ts'
import { WorktreesService } from '../src/host/service.ts'

/**
 * RPC contract: the handler map is the wire surface. Every method must
 * exist, validate its input, and translate WorktreeFlowError into the
 * stable envelope the client renders.
 */
function serviceWith(spies: Record<string, Mock>): WorktreesService {
  return spies as unknown as WorktreesService
}

describe('createHandlers', () => {
  it('routes preflight with the cwd', async () => {
    const preflight = vi.fn().mockResolvedValue({ ok: true })
    const handlers = createHandlers(serviceWith({ preflight }))
    await handlers.preflight!({ cwd: '/repos/wt-repo' })
    expect(preflight).toHaveBeenCalledWith('/repos/wt-repo')
  })

  it('routes create with name and baseRef', async () => {
    const create = vi.fn().mockResolvedValue({})
    const handlers = createHandlers(serviceWith({ create }))
    await handlers.create!({ cwd: '/r', name: 'fix login', baseRef: 'main' })
    expect(create).toHaveBeenCalledWith({ cwd: '/r', name: 'fix login', baseRef: 'main' })
  })

  it('routes setup with cwd and slug', async () => {
    const setup = vi.fn().mockResolvedValue(undefined)
    const handlers = createHandlers(serviceWith({ setup }))
    await handlers.setup!({ cwd: '/r/.dsh/worktrees/swift-01', slug: 'swift-01' })
    expect(setup).toHaveBeenCalledWith({ cwd: '/r/.dsh/worktrees/swift-01', slug: 'swift-01' })
  })

  it('routes bind and status with the session id', async () => {
    const bind = vi.fn().mockResolvedValue({})
    const status = vi.fn().mockResolvedValue({})
    const handlers = createHandlers(serviceWith({ bind, status }))
    await handlers.bind!({ sessionId: 's1' })
    await handlers.status!({ sessionId: 's1' })
    expect(bind).toHaveBeenCalledWith('s1')
    expect(status).toHaveBeenCalledWith('s1')
  })

  it('routes reclaim with from and to', async () => {
    const reclaim = vi.fn().mockResolvedValue({ claimed: true })
    const handlers = createHandlers(serviceWith({ reclaim }))
    await handlers.reclaim!({ from: 'old', to: 'next' })
    expect(reclaim).toHaveBeenCalledWith('old', 'next')
  })

  it('routes remove passing only a literal true as force', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const handlers = createHandlers(serviceWith({ remove }))
    await handlers.remove!({ cwd: '/r', slug: 'swift-01', force: true })
    expect(remove).toHaveBeenCalledWith({ cwd: '/r', slug: 'swift-01', force: true })
    await handlers.remove!({ cwd: '/r', slug: 'swift-01', force: 1 })
    expect(remove).toHaveBeenLastCalledWith({ cwd: '/r', slug: 'swift-01', force: false })
  })

  it('routes topology with a filtered cwd array', async () => {
    const topology = vi.fn().mockResolvedValue({ repos: [] })
    const handlers = createHandlers(serviceWith({ topology }))
    await handlers.topology!({ cwds: ['/r', 42, ''] })
    expect(topology).toHaveBeenCalledWith(['/r'])
  })

  it('routes both merge methods with cwd and slug', async () => {
    const mergePreflight = vi.fn().mockResolvedValue({})
    const mergeExecute = vi.fn().mockResolvedValue({})
    const handlers = createHandlers(serviceWith({ mergePreflight, mergeExecute }))
    await handlers['merge/preflight']!({ cwd: '/r', slug: 'swift-01' })
    await handlers['merge/execute']!({ cwd: '/r', slug: 'swift-01' })
    expect(mergePreflight).toHaveBeenCalledWith({ cwd: '/r', slug: 'swift-01' })
    expect(mergeExecute).toHaveBeenCalledWith({ cwd: '/r', slug: 'swift-01' })
  })

  it('routes update preflight, execute, and abort with cwd and slug', async () => {
    const updatePreflight = vi.fn().mockResolvedValue({})
    const updateExecute = vi.fn().mockResolvedValue({})
    const updateAbort = vi.fn().mockResolvedValue(undefined)
    const handlers = createHandlers(serviceWith({ updatePreflight, updateExecute, updateAbort }))
    await handlers['update/preflight']!({ cwd: '/r', slug: 'swift-01' })
    await handlers['update/execute']!({ cwd: '/r', slug: 'swift-01' })
    await handlers['update/abort']!({ cwd: '/r', slug: 'swift-01' })
    expect(updatePreflight).toHaveBeenCalledWith({ cwd: '/r', slug: 'swift-01' })
    expect(updateExecute).toHaveBeenCalledWith({ cwd: '/r', slug: 'swift-01' })
    expect(updateAbort).toHaveBeenCalledWith({ cwd: '/r', slug: 'swift-01' })
  })

  it('answers suggestName with a two-word string', async () => {
    const handlers = createHandlers(serviceWith({}))
    const value = await handlers.suggestName!(null) as string
    expect(value.split(' ')).toHaveLength(2)
  })

  it('rejects missing required fields as bad-request', async () => {
    const handlers = createHandlers(serviceWith({}))
    await expect(handlers.preflight!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.create!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.setup!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.bind!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.reclaim!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.status!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.remove!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers['merge/preflight']!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers['merge/execute']!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers['update/preflight']!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers['update/execute']!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers['update/abort']!({})).rejects.toMatchObject({ code: 'bad-request' })
  })

  it('rejects non-object payloads as bad-request', async () => {
    const handlers = createHandlers(serviceWith({}))
    await expect(handlers.preflight!(null)).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.preflight!('string')).rejects.toMatchObject({ code: 'bad-request' })
  })
})

describe('registerRpc', () => {
  it('registers the route inside ctx.effect so dispose unregisters', () => {
    const off = vi.fn()
    const register = vi.fn().mockReturnValue(off)
    const effect = vi.fn((setup: () => unknown) => setup())
    const ctx = {
      get: (name: string) => name === 'webServer' ? { register } : undefined,
      effect,
    }
    registerRpc(ctx as unknown as Context, serviceWith({}))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'exact',
      path: RPC_PATH,
    }))
    expect(effect).toHaveBeenCalledTimes(1)
    const setup = effect.mock.calls[0]![0] as () => unknown
    expect(setup()).toBe(off)
  })

  it('is a no-op when webServer is missing', () => {
    const effect = vi.fn()
    registerRpc({ get: () => undefined, effect } as unknown as Context, serviceWith({}))
    expect(effect).not.toHaveBeenCalled()
  })
})
