import { describe, expect, it, vi } from 'vitest'
import { RpcError } from '../src/core/errors.ts'
import { createHandlers } from '../src/host/rpc.ts'
import type { SubscriptionsService } from '../src/host/service.ts'

function serviceWith(spies: Record<string, unknown>): SubscriptionsService {
  return spies as unknown as SubscriptionsService
}

describe('createHandlers', () => {
  it('returns the handler map for every public method', () => {
    const handlers = createHandlers(serviceWith({}))
    expect(Object.keys(handlers).sort()).toEqual([
      'addModel',
      'addProvider',
      'cancelLogin',
      'disconnect',
      'getAttempt',
      'getState',
      'listModels',
      'refreshModels',
      'removeProvider',
      'restoreModels',
      'setModels',
      'startLogin',
      'submitPrompt',
    ].sort())
  })

  it('routes startLogin and submitPrompt with string args', async () => {
    const startLogin = vi.fn().mockResolvedValue({ id: 'a1' })
    const submitPrompt = vi.fn().mockResolvedValue({ id: 'a1' })
    const handlers = createHandlers(serviceWith({ startLogin, submitPrompt }))
    await handlers.startLogin!({ family: 'kimi' })
    await handlers.submitPrompt!({ attemptId: 'a1', promptId: 'p1', value: 'ok' })
    expect(startLogin).toHaveBeenCalledWith('kimi')
    expect(submitPrompt).toHaveBeenCalledWith('a1', 'p1', 'ok')
  })

  it('propagates RpcError codes for the client envelope', async () => {
    const handlers = createHandlers(serviceWith({
      getAttempt: vi.fn().mockRejectedValue(new RpcError('not-found', 'missing')),
    }))
    await expect(handlers.getAttempt!({ attemptId: 'nope' })).rejects.toMatchObject({ code: 'not-found' })
  })
})
