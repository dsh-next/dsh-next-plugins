import { describe, expect, it, vi } from 'vitest'
import type * as React from 'react'
import { apply, GIT_ID, makeWorktreeOpener, makeWorktreeUnregister, CHANGE_ID } from '../src/client/index.ts'
import { BranchChip } from '../src/client/composer/BranchChip.tsx'
import { GitPanel, GitPanelUnavailable } from '../src/client/GitPanel.tsx'
import { ChangeFileTab } from '../src/client/file/ChangeFileTab.tsx'
import { GitSettingsCard } from '../src/client/settings/GitSettingsCard.tsx'

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
  // Keyed by slot and entry key: one slot carries several of this plugin's
  // types (the panel and the change view), and each keeps its own body.
  const registered = new Map<string, (props: unknown) => unknown>()
  const slots = {
    inject: (_name: string, contribute: () => unknown) => {
      contribute()
      return () => {}
    },
    register: (options: { name: string; key?: string; id?: string }, component: (props: unknown) => unknown) => {
      // Keyed seats carry a key, list seats an id; both name one entry.
      registered.set(`${options.name}#${options.key ?? options.id ?? ''}`, component)
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

/** Flatten a seat's element tree into a string, without a DOM. */
function renderToText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderToText).join('')
  const element = node as React.ReactElement<{ children?: React.ReactNode }>
  if (typeof element.type === 'string') {
    const children = renderToText(element.props.children)
    return element.type === 'span' ? children : `<${element.type}>${children}`
  }
  // A function component: call it with its props, the way React would.
  if (typeof element.type === 'function') {
    return renderToText((element.type as (props: unknown) => React.ReactNode)(element.props))
  }
  return renderToText(element.props.children)
}

/**
 * The tab seats: a registration that renders nothing is an empty pane, and the
 * seat has been seen to hand a partial share (the chip's old blank title), so
 * neither seat may take the null path.
 */
describe('tab seats', () => {
  it('mounts drafting settings on the current Plugins bundle configuration seat', () => {
    const seats = registeredSeats()
    const body = seats.get(`plugins.bundle.config#${GIT_ID}`)!
    expect((body({ view: 'page' }) as React.ReactElement).type).toBe(GitSettingsCard)
    expect(seats.has('settings.plugin.item#dsh-next-git')).toBe(false)
  })
  it('adds the branch chip to the composer tool row, only with a session', () => {
    const chip = registeredSeats().get(`conversation.input.left#${GIT_ID}/branch`)!
    expect(chip).toBeDefined()
    // Without a session there is no checkout to name, and a list entry that
    // renders nothing is simply absent.
    expect(chip({})).toBeNull()
    const element = chip({ sessionId: 'session-1' }) as React.ReactElement<{ sessionId?: string }>
    expect(element.type).toBe(BranchChip)
    expect(element.props.sessionId).toBe('session-1')
  })
  it('never renders a null body, even with no session share', () => {
    const body = registeredSeats().get(`sidebar.right.pane.tab#${GIT_ID}`)!
    const element = body({}) as React.ReactElement<{ useTabInfo?: unknown }>
    expect(element).not.toBeNull()
    expect(element.type).toBe(GitPanelUnavailable)
  })

  it('reads the session and forwards the tab hook only when handed one', () => {
    const body = registeredSeats().get(`sidebar.right.pane.tab#${GIT_ID}`)!
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

  it('renders the change view for its own address, and says so without one', () => {
    const seats = registeredSeats()
    const body = seats.get(`sidebar.right.pane.tab#${CHANGE_ID}`)!
    const withAddress = body({ useTabInfo: () => ({ tab: { navigation: { address: 'dsh-resource://git-changes/session/s1/unstaged/src/app.ts' } } }) }) as React.ReactElement<{ address: string }>
    expect(withAddress.type).toBe(ChangeFileTab)
    expect(withAddress.props.address).toBe('dsh-resource://git-changes/session/s1/unstaged/src/app.ts')
    // A record the shell has not committed yet hands no address; the body then
    // names that instead of rendering nothing.
    const without = body({}) as React.ReactElement<{ address: string }>
    expect(without.type).toBe(ChangeFileTab)
    expect(without.props.address).toBe('')
  })

  it('marks the change view chip with the source-control glyph', () => {
    const seats = registeredSeats()
    const title = seats.get(`sidebar.right.pane.tab.title#${CHANGE_ID}`)!
    const element = title({
      useTabInfo: () => ({ tab: { navigation: { address: 'dsh-resource://git-changes/session/s1/staged/src/app.ts' } } }),
    }) as React.ReactElement<{ children: React.ReactNode }>
    expect(element).not.toBeNull()
    const rendered = renderToText(element)
    expect(rendered).toContain('app.ts (staged)')
    expect(rendered).toContain('<svg')
    // A record the shell has not committed yet still paints a chip.
    const blank = renderToText(title({}) as React.ReactElement)
    expect(blank).toContain('svg')
    expect(blank.length).toBeGreaterThan(0)
  })

  it('never renders a null chip title', () => {
    const title = registeredSeats().get(`sidebar.right.pane.tab.title#${GIT_ID}`)!
    expect(title({})).not.toBeNull()
  })
})

describe('deleted worktree workspace cleanup', () => {
  it('deletes only the exact registered path without requiring session or navigation services', async () => {
    const remove = vi.fn(async () => {})
    const workspaces = { delete: remove, list: { getSnapshot: () => ({ phase: 'ready', state: 'idle', items: [
      { workspaceId: 'root', path: '/repo' }, { workspaceId: 'target', path: '/repo/.worktrees/a' },
      { workspaceId: 'other', path: '/repo/.worktrees/ab' }, { workspaceId: 'nested', path: '/repo/.worktrees/a/nested' },
    ] }) } }
    const unregister = makeWorktreeUnregister(contextWith({ workspaces }))!
    await unregister('/repo/.worktrees/a')
    expect(remove).toHaveBeenCalledExactlyOnceWith('target')
    await unregister('/missing')
    expect(remove).toHaveBeenCalledTimes(1)
  })
  it('refuses unavailable registries and propagates deletion failures', async () => {
    expect(makeWorktreeUnregister(contextWith({}))).toBeUndefined()
    const remove = vi.fn(async () => { throw new Error('offline') })
    const workspaces = { delete: remove, list: { getSnapshot: vi.fn(() => ({ phase: 'pending', state: 'loading', items: [{ workspaceId: 'target', path: '/a' }] })) } }
    const unregister = makeWorktreeUnregister(contextWith({ workspaces }))!
    await expect(unregister('/a')).rejects.toThrow('registry is unavailable')
    expect(remove).not.toHaveBeenCalled()
    workspaces.list.getSnapshot.mockReturnValue({ phase: 'ready', state: 'idle', items: [{ workspaceId: 'target', path: '/a' }] })
    await expect(unregister('/a')).rejects.toThrow('offline')
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
