/** Disposable audit repros. In-memory services only; no real DSH or Git mutations. */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorktreeBrowser } from '../src/client/browser-wrapper.tsx'
import { configureWorktreeSweeper } from '../src/client/sweeper.ts'
import * as sweeper from '../src/client/sweeper.ts'
import { parseWorktreeWorkspacePath } from '../src/core/paths.ts'
import { resetModalStore } from '../src/client/create-store.ts'
import type { WorkspaceItemLike } from '../src/client/projection.ts'
import type { WorktreeTopology } from '../src/client/rpc.ts'

const mocked = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/client/rpc.ts', async (original) => ({
  ...await original<typeof import('../src/client/rpc.ts')>(),
  rpc: mocked.rpc,
}))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PRIMARY = '/diagnostic/repo'
const PATH = `${PRIMARY}/.dsh/worktrees/topic`
const roots: { root: Root; container: HTMLElement }[] = []

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
  return { workspaces: [], repos: [] }
}

async function mount(items: readonly WorkspaceItemLike[], byId: Record<string, { id: string; blank: boolean }>, current = 'elsewhere') {
  const workspaces = memoryState({ items })
  const sessions = memoryState({ ids: Object.keys(byId), byId, current })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ root, container })
  // Renderer chrome is irrelevant: the real wrapper owns the sweep effects.
  const OfficialBrowser = () => null
  await act(async () => { root.render(React.createElement(WorktreeBrowser, {
    OfficialBrowser, useWorkspaces: workspaces.use, useSessions: sessions.use,
  })) })
  return { container, workspaces, sessions }
}

beforeEach(() => {
  resetModalStore()
  configureWorktreeSweeper(undefined)
  mocked.rpc.mockReset().mockImplementation(async (method) => method === 'topology' ? topology() : {})
})

afterEach(async () => {
  for (const { root, container } of roots.splice(0)) {
    await act(async () => root.unmount())
    container.remove()
  }
  configureWorktreeSweeper(undefined)
  resetModalStore()
  vi.restoreAllMocks()
})

function holdSweepBoundary() {
  // Hold the host boundary so assertions catch the destructive request itself.
  const removeWorktree = vi.fn(() => new Promise<void>(() => {}))
  const archiveSession = vi.fn().mockResolvedValue(undefined)
  const deleteWorkspace = vi.fn().mockResolvedValue(undefined)
  configureWorktreeSweeper({ removeWorktree, archiveSession, deleteWorkspace })
  return { removeWorktree, archiveSession, deleteWorkspace }
}

const sessionsById = { blank: { id: 'blank', blank: true }, active: { id: 'active', blank: false } }
const sharedItems: readonly WorkspaceItemLike[] = [
  { workspaceId: 'blank-root', path: PATH, sessionIds: ['blank'] },
  { workspaceId: 'active-subdir', path: `${PATH}/packages/app`, sessionIds: ['active'] },
]

describe('diagnostic browser-wrapper sweep contracts', () => {
  it('does not sweep a checkout whose second subdirectory workspace has the current started session', async () => {
    const { removeWorktree, archiveSession, deleteWorkspace } = holdSweepBoundary()
    await mount(sharedItems, sessionsById, 'active')
    expect(removeWorktree).not.toHaveBeenCalled()
    expect(archiveSession).not.toHaveBeenCalled()
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })

  it('negative control: a started sibling in the same workspace protects the checkout', async () => {
    const { removeWorktree } = holdSweepBoundary()
    await mount([
      { workspaceId: 'blank-root', path: PATH, sessionIds: ['blank', 'active'] },
    ], sessionsById, 'active')
    expect(removeWorktree).not.toHaveBeenCalled()
  })

  it('negative control: selecting the blank root session protects the same shared checkout', async () => {
    const { removeWorktree } = holdSweepBoundary()
    await mount(sharedItems, sessionsById, 'blank')
    expect(removeWorktree).not.toHaveBeenCalled()
  })

  it('control: a started session in a different checkout does not protect the abandoned tree', async () => {
    const { removeWorktree } = holdSweepBoundary()
    await mount(sharedItems.map((item) => item.workspaceId === 'active-subdir'
      ? { ...item, path: `${PRIMARY}/.dsh/worktrees/other/packages/app` }
      : item), sessionsById, 'active')
    expect(removeWorktree).toHaveBeenCalledExactlyOnceWith({ cwd: PRIMARY, slug: 'topic' })
  })

  it('probe: root and subdirectory resolve to the same worktree identity', () => {
    expect(parseWorktreeWorkspacePath(PATH)).toEqual(parseWorktreeWorkspacePath(`${PATH}/packages/app`))
    expect(parseWorktreeWorkspacePath(PATH)).toEqual({ primary: PRIMARY, slug: 'topic', root: PATH })
  })

  it('probe: the real wrapper supplies the current session and both known session rows', async () => {
    holdSweepBoundary()
    const snapshot = vi.spyOn(sweeper, 'sweepAbandonedWorktrees')
    await mount(sharedItems, sessionsById, 'active')
    expect(snapshot).toHaveBeenCalledWith({
      workspaces: sharedItems, sessionsById, currentSessionId: 'active', creating: false,
    })
  })
})
