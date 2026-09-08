import { describe, expect, it, vi } from 'vitest'
import { createHandlers } from '../src/host/rpc.ts'
import type { WorktreesService } from '../src/host/service.ts'

const methods = [
  ['setup', 'setup'],
  ['remove', 'remove'],
  ['merge/preflight', 'mergePreflight'],
  ['merge/execute', 'mergeExecute'],
  ['update/preflight', 'updatePreflight'],
  ['update/execute', 'updateExecute'],
  ['update/abort', 'updateAbort'],
] as const

describe.each(methods)('%s worktree input contract', (method, serviceMethod) => {
  it.each([
    undefined, null, 'text', [], {},
    { cwd: '/r' }, { slug: 'swift' },
    { cwd: '', slug: 'swift' }, { cwd: '/r', slug: '' },
    { cwd: 42, slug: 'swift' }, { cwd: '/r', slug: false },
  ])('rejects invalid input asynchronously: %j', async (args) => {
    const call = vi.fn()
    const handlers = createHandlers({ [serviceMethod]: call } as unknown as WorktreesService)
    const pending = handlers[method]!(args)
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).rejects.toMatchObject({
      name: 'WorktreeFlowError',
      code: 'bad-request',
      message: `${method} requires cwd and slug`,
    })
    expect(call).not.toHaveBeenCalled()
  })

  it('preserves fields, optional argument filtering, and the service result', async () => {
    const result = { marker: method }
    const call = vi.fn().mockResolvedValue(result)
    const handlers = createHandlers({ [serviceMethod]: call } as unknown as WorktreesService)
    await expect(handlers[method]!({
      cwd: ' /r ', slug: ' swift ', force: true,
      sessionIds: ['s1', '', 42, 's1', ' '],
    })).resolves.toBe(result)
    const expected: Record<string, unknown> = { cwd: ' /r ', slug: ' swift ' }
    if (method === 'remove') expected.force = true
    else if (method !== 'setup' && method !== 'update/abort') {
      expected.sessionIds = ['s1', 's1', ' ']
    }
    expect(call).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('validates required fields before reading optional arguments', async () => {
    const reads: string[] = []
    const handlers = createHandlers({} as WorktreesService)
    await expect(handlers[method]!({
      get cwd() { reads.push('cwd'); return undefined },
      get slug() { reads.push('slug'); return 'swift' },
      get force() { throw new Error('force must not be read') },
      get sessionIds() { throw new Error('sessionIds must not be read') },
    })).rejects.toMatchObject({ code: 'bad-request' })
    expect(reads).toEqual(['cwd', 'slug'])
  })
})
