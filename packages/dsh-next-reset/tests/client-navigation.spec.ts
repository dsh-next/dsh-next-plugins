import { describe, expect, it, vi } from 'vitest'
import * as client from '../src/client/index.ts'
import type { SessionsLike, WorkspacesLike } from '../src/client/handoff.ts'

/** A minimal session list; navigation is deliberately not part of it. */
function sessions(): SessionsLike {
  return {
    list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => {} },
    binding: () => undefined,
  }
}

function workspaces(): WorkspacesLike {
  return {
    list: { getSnapshot: () => ({ archivedSessionIds: [] }) },
    archiveSession: async () => undefined,
  }
}

const contextWith = (services: Record<string, unknown>): never =>
  ({ get: (name: string) => services[name] }) as never

/** The same, with the effect runner `apply` needs. */
const applyContext = (services: Record<string, unknown>, effect: unknown): never =>
  ({ get: (name: string) => services[name], effect }) as never

describe('reset session navigation', () => {
  it('prefers the live workspace navigation over the legacy session open', () => {
    const openSession = vi.fn()
    const legacyOpen = vi.fn()
    client.makeSessionOpener(contextWith({
      uiWorkspace: { openSession },
      sessions: { open: legacyOpen },
    }))?.('next')
    expect(openSession).toHaveBeenCalledWith('next')
    expect(legacyOpen).not.toHaveBeenCalled()
  })

  it('falls back to the legacy session open', () => {
    const legacyOpen = vi.fn()
    client.makeSessionOpener(contextWith({ sessions: { open: legacyOpen } }))?.('next')
    expect(legacyOpen).toHaveBeenCalledWith('next')
  })

  it('is undefined when the host cannot navigate', () => {
    expect(client.makeSessionOpener(contextWith({}))).toBeUndefined()
    expect(client.makeSessionOpener(contextWith({ sessions: {}, uiWorkspace: {} }))).toBeUndefined()
  })

  it('watches for handoffs even before navigation is registered', () => {
    const effect = vi.fn((setup: () => unknown, _name?: string) => setup())
    client.apply(applyContext({ sessions: sessions(), workspaces: workspaces() }, effect))
    // Navigation is resolved per handoff: a service that registers later still
    // works, and the switch stops before archiving when there is none.
    expect(effect).toHaveBeenCalledTimes(1)
    expect(effect.mock.calls[0]![1]).toBe('dsh-next-reset: handoff')
  })

  it('watches for handoffs when navigation exists', () => {
    const effect = vi.fn((setup: () => unknown, _name?: string) => setup())
    client.apply(applyContext({
      sessions: sessions(),
      workspaces: workspaces(),
      uiWorkspace: { openSession: vi.fn() },
    }, effect))
    expect(effect).toHaveBeenCalledTimes(1)
  })
})
