import { describe, expect, it, vi } from 'vitest'
import type * as React from 'react'
import { apply, makeWorktreeOpener } from '../src/client/index.ts'
import { GitPanel, GitPanelUnavailable } from '../src/client/GitPanel.tsx'

/**
 * Browser-entry wiring: the worktree session opener resolves the workspace
 * navigation services through the context, so the panel can offer "open a
 * session in this folder" without depending on a host that may not have them.
 */

function contextWith(services: Record<string, unknown>): Parameters<typeof makeWorktreeOpener>[0] {
  return { get: (key: string) => services[key] } as unknown as Parameters<typeof makeWorktreeOpener>[0]
}

/**
 * Apply the browser entry against a fake slot registry and hand back the
 * components it registered per seat.
 */
function registeredSeats(): Map<string, (props: unknown) => unknown> {
  const registered = new Map<string, (props: unknown) => unknown>()
  const slots = {
    inject: (_name: string, contribute: () => unknown) => {
      contribute()
      return () => {}
    },
    register: (options: { name: string }, component: (props: unknown) => unknown) => {
      registered.set(options.name, component)
      return () => {}
    },
  }
  const ctx = {
    // The entry reaches the tab registry as a service property, everything
    // else through `get`.
    sidebarRightTabs: { register: () => () => {} },
    get: (key: string) => (key === 'slots' ? slots : undefined),
    effect: (run: () => unknown) => {
      run()
    },
  }
  apply(ctx as unknown as Parameters<typeof apply>[0])
  return registered
}

/**
 * The tab seats: a registration that renders nothing is an empty pane, and the
 * seat has been seen to hand a partial share (the chip's old blank title), so
 * neither seat may take the null path.
 */
describe('tab seats', () => {
  it('never renders a null body, even with no session share', () => {
    const body = registeredSeats().get('sidebar.right.pane.tab')!
    const element = body({}) as React.ReactElement<{ useTabInfo?: unknown }>
    expect(element).not.toBeNull()
    expect(element.type).toBe(GitPanelUnavailable)
  })

  it('reads the session and forwards the tab hook only when handed one', () => {
    const body = registeredSeats().get('sidebar.right.pane.tab')!
    const without = body({ sessionId: 's-1' }) as React.ReactElement<{
      sessionId: string
      useTabInfo?: unknown
    }>
    expect(without.type).toBe(GitPanel)
    expect(without.props.sessionId).toBe('s-1')
    expect('useTabInfo' in without.props).toBe(false)

    const hook = () => ({ tab: { title: '', actions: { openResource: () => {} } } })
    const withHook = body({ sessionId: 's-1', useTabInfo: hook }) as React.ReactElement<{
      useTabInfo?: unknown
    }>
    expect(withHook.type).toBe(GitPanel)
    expect(withHook.props.useTabInfo).toBe(hook)
  })

  it('never renders a null chip title', () => {
    const title = registeredSeats().get('sidebar.right.pane.tab.title')!
    expect(title({})).not.toBeNull()
  })
})

describe('worktree session opener', () => {
  it('registers the folder as a workspace and opens a session in it', async () => {
    const create = vi.fn(async (input: { path: string }) => ({ workspaceId: 'ws-1', path: input.path }))
    const openSession = vi.fn()
    const createSession = vi.fn(async () => 'fresh-session')
    const opener = makeWorktreeOpener(contextWith({ workspaces: { create }, sessions: { create: createSession }, uiWorkspace: { openSession } }))
    expect(opener).toBeDefined()
    await opener?.('/repo/.worktrees/feature')
    expect(create).toHaveBeenCalledWith({ path: '/repo/.worktrees/feature' })
    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(openSession).toHaveBeenCalledWith('fresh-session')
  })

  it('is absent when the host cannot navigate workspaces', () => {
    expect(makeWorktreeOpener(contextWith({}))).toBeUndefined()
    expect(makeWorktreeOpener(contextWith({ workspaces: { create: async () => ({ workspaceId: 'a' }) } })))
      .toBeUndefined()
    expect(makeWorktreeOpener(contextWith({ uiWorkspace: { openWorkspace: async () => {} } })))
      .toBeUndefined()
  })

  it('fails loudly when a service disappears after the check', async () => {
    const services: Record<string, unknown> = {
      workspaces: { create: async () => ({ workspaceId: 'a' }) },
      uiWorkspace: { openSession: () => {} },
      sessions: { create: async () => 'fresh-session' },
    }
    const opener = makeWorktreeOpener(contextWith(services))
    delete services.workspaces
    await expect(opener?.('/repo/.worktrees/feature')).rejects.toThrow('workspace navigation is unavailable')
  })
})
