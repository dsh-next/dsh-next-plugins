/** Exercise production entry/wrapper effects with in-memory host services. */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modalState, resetModalStore } from '../src/client/create-store.ts'
import type { WorkspaceItemLike } from '../src/client/projection.ts'
import { requestTopologyRefresh, type WorktreeTopology } from '../src/client/rpc.ts'

const mocked = vi.hoisted(() => ({ rpc: vi.fn(), officialApply: vi.fn() }))
vi.mock('../src/client/rpc.ts', async (original) => ({
  ...await original<typeof import('../src/client/rpc.ts')>(),
  rpc: mocked.rpc,
}))
vi.mock('../src/generated/workspace-browser.generated.mjs', () => ({
  runOfficialWorkspaceClient: () => ({ inject: [], apply: mocked.officialApply }),
}))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PRIMARY = '/repos/project'
const PATH = `${PRIMARY}/.dsh/worktrees/topic`
const roots: { root: Root; container: HTMLElement }[] = []
const disposers: (() => void)[] = []
type SessionRows = Record<string, { id: string; blank: boolean }>
const sessionsById: SessionRows = { blank: { id: 'blank', blank: true }, active: { id: 'active', blank: false } }
const rootItem: WorkspaceItemLike = { workspaceId: 'blank-root', path: PATH, sessionIds: ['blank'] }
const harbor: WorkspaceItemLike = { workspaceId: 'harbor', path: PRIMARY, sessionIds: ['active'] }

function memoryState<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: T) { value = next; for (const listener of listeners) listener() },
    use<R>(selector: (state: T) => R): R {
      return selector(React.useSyncExternalStore(
        React.useCallback((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }, []),
        () => value,
      ))
    },
  }
}

function topology(): WorktreeTopology {
  return {
    workspaces: [{ cwd: PRIMARY, primary: PRIMARY, canCreate: true }],
    repos: [{ primary: PRIMARY, ok: true, worktrees: [{
      slug: 'topic', title: 'Topic', path: PATH, branch: 'dsh-worktrees/topic', baseRef: 'main', primaryBranch: 'main',
      sessionIds: ['blank'], status: { clean: true, dirty: false, ahead: 0, merged: false, conflict: false },
    }] }],
  }
}

async function mount(items: readonly WorkspaceItemLike[], byId: SessionRows = sessionsById, current = 'blank') {
  const workspaces = memoryState({ items: [harbor, ...items] })
  const sessions = memoryState({ ids: Object.keys(byId), byId, current })
  const archiveSession = vi.fn().mockResolvedValue(undefined)
  const deleteWorkspace = vi.fn().mockResolvedValue(undefined)
  const hostWorkspaces = { archiveSession, delete: deleteWorkspace }
  let Browser: React.ComponentType<Record<string, unknown>> | undefined
  // Only the stock renderer is replaced: production apply must install the real
  // wrapper and its service wiring, including any accidental cleanup effect.
  const OfficialBrowser = (props: Record<string, unknown>) => {
    const state = (props.useWorkspaces as typeof workspaces.use)((value) => value)
    return React.createElement('div', {}, ...state.items.map((item) => React.createElement('button', {
      key: item.workspaceId, 'data-workspace': item.workspaceId,
      onClick: () => (props.deleteWorkspace as (id: string) => void)(item.workspaceId),
    }, item.workspaceId)))
  }
  mocked.officialApply.mockImplementation((ctx) => {
    ctx.slots.register({ name: 'sidebar.workspaces' }, OfficialBrowser)
  })
  const ctx = {
    get: (name: string) => name === 'workspaces' ? hostWorkspaces : name === 'sessions' ? { open: vi.fn() } : undefined,
    effect: (setup: () => void | (() => void)) => { const dispose = setup(); if (dispose) disposers.push(dispose) },
    slots: { register: (_descriptor: unknown, component: typeof Browser) => { Browser = component } },
    on: () => {},
  }
  const { apply } = await import('../src/client/index.ts')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ root, container })
  await act(async () => {
    apply(ctx as unknown as Context)
    expect(Browser).toBeDefined()
    root.render(React.createElement(Browser!, {
      useWorkspaces: workspaces.use, useSessions: sessions.use, deleteWorkspace, archiveSession,
    }))
  })
  return { container, workspaces, sessions, archiveSession, deleteWorkspace }
}

beforeEach(() => {
  resetModalStore()
  vi.stubGlobal('require', vi.fn())
  mocked.rpc.mockReset().mockImplementation(async (method) => {
    if (method === 'topology') return topology()
    // Stop at any unintended destructive request instead of letting an old
    // sweeper repeatedly remove an unchanged in-memory topology.
    if (method === 'remove') return new Promise(() => {})
    return {}
  })
})

afterEach(async () => {
  for (const { root, container } of roots.splice(0)) {
    await act(async () => root.unmount())
    container.remove()
  }
  await act(async () => { for (const dispose of disposers.splice(0).reverse()) dispose() })
  resetModalStore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function expectPreserved(view: Awaited<ReturnType<typeof mount>>, items: readonly WorkspaceItemLike[]) {
  expect(mocked.rpc.mock.calls.map(([method]) => method)).not.toContain('remove')
  expect(view.archiveSession).not.toHaveBeenCalled()
  expect(view.deleteWorkspace).not.toHaveBeenCalled()
  expect(view.workspaces.get().items).toEqual([harbor, ...items])
  for (const item of items) expect(view.container.querySelector(`[data-workspace="${item.workspaceId}"]`)).not.toBeNull()
}

async function refresh() {
  const before = mocked.rpc.mock.calls.filter(([method]) => method === 'topology').length
  await act(async () => { requestTopologyRefresh() })
  expect(mocked.rpc.mock.calls.filter(([method]) => method === 'topology')).toHaveLength(before + 1)
}

describe('browser worktree preservation', () => {
  it('preserves a new worktree after switching away from its never-started session', async () => {
    const view = await mount([rootItem])
    await act(async () => { view.sessions.set({ ...view.sessions.get(), current: 'active' }) })
    expectPreserved(view, [rootItem])
    await refresh()
    expectPreserved(view, [rootItem])
  })

  it.each([
    ['blank session', [rootItem], sessionsById],
    ['missing session record', [rootItem], { active: sessionsById.active! }],
    ['unloaded session store', [rootItem], {}],
    ['empty worktree workspace', [{ ...rootItem, sessionIds: [] }], sessionsById],
    ['subdirectory workspace', [{ ...rootItem, path: `${PATH}/packages/app` }], sessionsById],
    ['root and started subdirectory', [rootItem, { workspaceId: 'subdir', path: `${PATH}/packages/app`, sessionIds: ['active'] }], sessionsById],
    ['root and blank subdirectory', [rootItem, { workspaceId: 'subdir', path: `${PATH}/packages/app`, sessionIds: ['blank'] }], sessionsById],
    ['started session in another checkout', [rootItem, { workspaceId: 'other', path: `${PRIMARY}/.dsh/worktrees/other`, sessionIds: ['active'] }], sessionsById],
  ] satisfies [string, WorkspaceItemLike[], SessionRows][])('preserves %s on mount and topology refresh', async (_name, items, byId) => {
    const view = await mount(items, byId, 'active')
    expectPreserved(view, items)
    await refresh()
    expectPreserved(view, items)
  })

  it.each([true, false])('preserves reset replacement when archived row retained = %s', async (retainArchived) => {
    const original = { ...rootItem, sessionIds: ['old'] }
    const view = await mount([original], { ...sessionsById, old: { id: 'old', blank: false } }, 'old')
    const replacement = { ...rootItem, sessionIds: ['old', 'blank'] }
    await act(async () => {
      view.workspaces.set({ items: [harbor, replacement] })
      const byId = retainArchived ? view.sessions.get().byId : sessionsById
      view.sessions.set({ ids: ['blank', 'active'], byId, current: 'blank' })
    })
    await act(async () => { view.sessions.set({ ...view.sessions.get(), current: 'active' }) })
    await refresh()
    expectPreserved(view, [replacement])
  })

  it('preserves the checkout when the blank session disappears and membership becomes empty', async () => {
    const view = await mount([rootItem])
    const empty = { ...rootItem, sessionIds: [] }
    await act(async () => {
      view.sessions.set({ ids: ['active'], byId: { active: sessionsById.active! }, current: 'active' })
      view.workspaces.set({ items: [harbor, empty] })
    })
    await refresh()
    expectPreserved(view, [empty])
  })

  it('still deletes a preserved worktree only after the user confirms the delete modal', async () => {
    const view = await mount([rootItem], sessionsById, 'active')
    expectPreserved(view, [rootItem])
    await act(async () => { view.container.querySelector<HTMLButtonElement>('[data-workspace="blank-root"]')!.click() })
    expect(modalState().kind).toBe('delete')
    expectPreserved(view, [rootItem])
    const confirm = document.querySelector<HTMLButtonElement>('[data-dshx-button="remove-armed"]')
    expect(confirm).not.toBeNull()
    mocked.rpc.mockImplementation(async (method) => method === 'topology' ? topology() : {})
    await act(async () => { confirm!.click() })
    expect(mocked.rpc).toHaveBeenCalledWith('remove', { cwd: PATH, slug: 'topic', force: false })
    expect(view.archiveSession).toHaveBeenCalledExactlyOnceWith('blank')
    expect(view.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('blank-root')
    expect(modalState().kind).toBe('closed')
  })

  it('still delegates explicit deletion of an ordinary workspace to the host', async () => {
    const view = await mount([rootItem])
    await act(async () => { view.container.querySelector<HTMLButtonElement>('[data-workspace="harbor"]')!.click() })
    expect(view.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('harbor')
    expect(mocked.rpc.mock.calls.map(([method]) => method)).not.toContain('remove')
  })
})
