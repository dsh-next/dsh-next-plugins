import { describe, expect, it, vi } from 'vitest'
import * as client from '../src/client/index.ts'

describe('checkpoints client plugin', () => {
  it('exports an apply function and injects slots plus locale', () => {
    expect(typeof client.apply).toBe('function')
    expect(client.inject).toEqual(['slots', 'locale', 'sessions'])
  })

  it('registers the Changes conversation view at id changes order 20', () => {
    const register = vi.fn().mockReturnValue(() => {})
    const inject = vi.fn((_name: string, factory: () => unknown) => {
      factory()
      return () => {}
    })
    const localeRegister = vi.fn().mockReturnValue(() => {})
    const bind = vi.fn().mockReturnValue((key: string) => key)
    const effect = vi.fn((setup: () => unknown, _name?: string) => setup())
    client.apply({
      get: (name: string) => {
        if (name === 'slots') return { inject, register }
        if (name === 'locale') return { register: localeRegister, bind }
        return undefined
      },
      effect,
    } as never)
    expect(effect).toHaveBeenCalledTimes(2)
    expect(effect.mock.calls.some((call) => call[1] === 'dsh-next-checkpoints: changes view')).toBe(true)
    expect(inject).toHaveBeenCalledWith('conversation.view', expect.any(Function))
    expect(register).toHaveBeenCalledTimes(1)
    const def = register.mock.calls[0]![0] as { id: string; order: number; name: string }
    expect(def).toMatchObject({ name: 'conversation.view', id: 'changes', order: 20 })
    expect(localeRegister).toHaveBeenCalled()
  })
})
