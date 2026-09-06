import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-session', () => ({
  KNOWN_SESSION_EVENT_TYPES: new Set<string>(),
}))
vi.mock('@deepseek-ai/dsh-sandbox-policy', () => ({
  setSandboxMode: vi.fn(),
}))
vi.mock('@deepseek-ai/dsh-user-approval', () => ({
  setApprovalPolicy: vi.fn(),
}))

import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { RESET_HANDOFF } from '../src/core/handoff.ts'
import * as plugin from '../src/index.ts'
import * as client from '../src/client/index.ts'

describe('reset host plugin', () => {
  it('declares the commands inject', () => {
    expect(plugin.inject).toEqual(['commands'])
  })

  it('registers /reset through ctx.effect', () => {
    const off = vi.fn()
    const register = vi.fn().mockReturnValue(off)
    const effect = vi.fn((setup: () => unknown) => {
      const gen = (setup as () => Generator)()
      if (gen !== undefined && typeof (gen as Iterator<unknown>).next === 'function') {
        ;(gen as Generator).next()
      }
      return undefined
    })
    const ctx = {
      get: () => undefined,
      effect,
      commands: { register },
    }
    plugin.apply(ctx as never)
    expect(KNOWN_SESSION_EVENT_TYPES.has(RESET_HANDOFF)).toBe(true)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'reset',
      handler: expect.any(Function),
    }))
  })
})

describe('reset client plugin', () => {
  it('declares sessions and workspaces injects', () => {
    expect(client.inject).toEqual(['sessions', 'workspaces'])
  })

  it('is a no-op without sessions or workspaces', () => {
    const effect = vi.fn()
    client.apply({ get: () => undefined, effect } as never)
    expect(effect).not.toHaveBeenCalled()
  })
})
