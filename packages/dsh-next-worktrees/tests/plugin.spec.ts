import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'

describe('worktrees host plugin', () => {
  it('declares the webServer and sessions injects', () => {
    expect(plugin.inject).toEqual(['webServer', 'sessions'])
  })

  it('registers the RPC route through ctx.effect', () => {
    const off = vi.fn()
    const register = vi.fn().mockReturnValue(off)
    const provide = vi.fn()
    const effect = vi.fn((setup: () => unknown) => setup())
    const ctx = {
      get: (name: string) => {
        if (name === 'webServer') return { register }
        if (name === 'sessions') return { get: () => undefined }
        return undefined
      },
      effect,
      provide,
    }
    plugin.apply(ctx as never)
    expect(provide).toHaveBeenCalledWith('dsh-next-worktrees', expect.objectContaining({
      reclaim: expect.any(Function),
    }))
    expect(register).toHaveBeenCalled()
    const setup = effect.mock.calls.find((call) => typeof call[0] === 'function')?.[0] as (() => unknown) | undefined
    expect(setup).toBeTypeOf('function')
    expect(setup?.()).toBe(off)
  })
})
