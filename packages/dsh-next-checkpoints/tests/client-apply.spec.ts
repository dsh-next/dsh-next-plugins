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

describe('checkpoints session navigation', () => {
  const contextWith = (services: Record<string, unknown>): never => ({ get: (name: string) => services[name] }) as never

  it('prefers the live workspace navigation over the legacy session open', () => {
    const openSession = vi.fn()
    const legacyOpen = vi.fn()
    const opener = client.makeSessionOpener(contextWith({
      uiWorkspace: { openSession },
      sessions: { open: legacyOpen },
    }))
    opener?.('s1')
    expect(openSession).toHaveBeenCalledWith('s1')
    expect(legacyOpen).not.toHaveBeenCalled()
  })

  it('falls back to the legacy session open', () => {
    const legacyOpen = vi.fn()
    client.makeSessionOpener(contextWith({ sessions: { open: legacyOpen } }))?.('s2')
    expect(legacyOpen).toHaveBeenCalledWith('s2')
  })

  it('is undefined when the host cannot navigate', () => {
    expect(client.makeSessionOpener(contextWith({}))).toBeUndefined()
    expect(client.makeSessionOpener(contextWith({ sessions: {}, uiWorkspace: {} }))).toBeUndefined()
  })

  it('hands the view an openSession the host can honour', () => {
    const openSession = vi.fn()
    const register = vi.fn().mockReturnValue(() => {})
    const inject = vi.fn((_name: string, factory: () => unknown) => {
      factory()
      return () => {}
    })
    const localeRegister = vi.fn().mockReturnValue(() => {})
    const bind = vi.fn().mockReturnValue((key: string) => key)
    const effect = vi.fn((setup: () => unknown) => setup())
    client.apply({
      get: (name: string) => {
        if (name === 'slots') return { inject, register }
        if (name === 'locale') return { register: localeRegister, bind }
        if (name === 'workspaces') return { archiveSession: async () => undefined }
        if (name === 'uiWorkspace') return { openSession }
        return undefined
      },
      effect,
    } as never)
    const def = register.mock.calls[0]![0] as {
      inject: (sessionId: string) => { openSession?: (id: string) => void }
    }
    const props = def.inject('session-1')
    expect(props.openSession).toBeTypeOf('function')
    props.openSession?.('next')
    expect(openSession).toHaveBeenCalledWith('next')
  })

  it('omits the action when the host cannot navigate', () => {
    const register = vi.fn().mockReturnValue(() => {})
    const inject = vi.fn((_name: string, factory: () => unknown) => {
      factory()
      return () => {}
    })
    const effect = vi.fn((setup: () => unknown) => setup())
    client.apply({
      get: (name: string) => {
        if (name === 'slots') return { inject, register }
        return undefined
      },
      effect,
    } as never)
    const def = register.mock.calls[0]![0] as {
      inject: (sessionId: string) => { openSession?: (id: string) => void }
    }
    expect(def.inject('session-1').openSession).toBeUndefined()
  })
})
