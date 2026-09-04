// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createHandlers } from '../src/host/rpc.ts'
import { WorktreeFlowError, WorktreesService } from '../src/host/service.ts'

function serviceWith(overrides: Partial<Record<'preflight' | 'create' | 'bind' | 'status' | 'remove', unknown>>): WorktreesService {
  return overrides as unknown as WorktreesService
}

describe('RPC handler envelopes (contract)', () => {
  it('passes preflight args through and returns its value', async () => {
    const value = { ok: true, degraded: false, reasons: [], showIgnoreHint: false }
    const preflight = vi.fn().mockResolvedValue(value)
    const handlers = createHandlers(serviceWith({ preflight }))
    await expect(handlers.preflight({ cwd: '/repo' })).resolves.toEqual(value)
    expect(preflight).toHaveBeenCalledWith('/repo')
  })

  it('normalizes optional create args', async () => {
    const create = vi.fn().mockResolvedValue({ slug: 'amber-42' })
    const handlers = createHandlers(serviceWith({ create }))
    await handlers.create({ cwd: '/repo' })
    expect(create).toHaveBeenCalledWith({ cwd: '/repo', title: '', baseRef: undefined })
    await handlers.create({ cwd: '/repo', title: 'fix login', baseRef: 'main' })
    expect(create).toHaveBeenLastCalledWith({ cwd: '/repo', title: 'fix login', baseRef: 'main' })
  })

  it('rejects missing required args with bad-request', async () => {
    const handlers = createHandlers(serviceWith({}))
    await expect(async () => handlers.preflight({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(async () => handlers.create(null)).rejects.toMatchObject({ code: 'bad-request' })
    await expect(async () => handlers.bind({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(async () => handlers.status({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(async () => handlers.remove({ cwd: '/repo' })).rejects.toMatchObject({ code: 'bad-request' })
  })

  it('rejects unknown methods at the map level', () => {
    const handlers = createHandlers(serviceWith({}))
    expect(handlers.nosuchmethod).toBeUndefined()
  })

  it('carries flow errors with code, message, and hint', async () => {
    const remove = vi.fn().mockRejectedValue(new WorktreeFlowError(
      'dirty-remove-refused', 'dirty', 'commit or stash first',
    ))
    const handlers = createHandlers(serviceWith({ remove }))
    await expect(handlers.remove({ cwd: '/repo', slug: 'amber-42', force: false }))
      .rejects.toMatchObject({
        code: 'dirty-remove-refused',
        message: 'dirty',
        hint: 'commit or stash first',
      })
  })

  it('binds with the plain sessionId string', async () => {
    const bind = vi.fn().mockResolvedValue({ slug: 'amber-42', path: '/w' })
    const handlers = createHandlers(serviceWith({ bind }))
    await expect(handlers.bind({ sessionId: 's1' })).resolves.toEqual({ slug: 'amber-42', path: '/w' })
    expect(bind).toHaveBeenCalledWith('s1')
  })

  it('remove maps the force flag exactly', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const handlers = createHandlers(serviceWith({ remove }))
    await handlers.remove({ cwd: '/repo', slug: 's', force: true })
    expect(remove).toHaveBeenCalledWith({ cwd: '/repo', slug: 's', force: true })
  })
})
