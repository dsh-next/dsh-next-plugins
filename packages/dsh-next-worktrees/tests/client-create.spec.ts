import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  closeModal,
  modalState,
  openCreate,
  resetModalStore,
  runCreateFlow,
  setCreateBusy,
  setCreateName,
  subscribeModal,
} from '../src/client/create-store.ts'
import { installBridge, updateBridgeFacts } from '../src/client/bridge.ts'

beforeEach(() => {
  resetModalStore()
})

describe('create modal store', () => {
  it('opens with the suggestion prefilled', () => {
    openCreate('/repos/wt-repo', 'wt-repo', 'quiet otter')
    expect(modalState()).toMatchObject({
      kind: 'create',
      create: {
        open: true,
        repoPath: '/repos/wt-repo',
        repoLabel: 'wt-repo',
        suggestion: 'quiet otter',
        name: 'quiet otter',
      },
    })
  })

  it('edits the name and clears it only through the store', () => {
    openCreate('/r', 'r', 'suggestion')
    setCreateName('  my fix  ')
    expect(modalState().create.name).toBe('  my fix  ')
  })

  it('notifies subscribers on change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeModal(listener)
    openCreate('/r', 'r', 's')
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    listener.mockClear()
    setCreateName('x')
    expect(listener).not.toHaveBeenCalled()
  })

  it('refuses to close while busy', () => {
    openCreate('/r', 'r', 's')
    setCreateBusy(true)
    closeModal()
    expect(modalState().create.open).toBe(true)
    setCreateBusy(false)
    closeModal()
    expect(modalState().kind).toBe('closed')
  })
})

describe('runCreateFlow', () => {
  function faces(overrides: {
    create?: (args: unknown) => Promise<unknown>
    workspaces?: { create(a: { path: string }): Promise<{ workspaceId: string }> }
    sessions?: { create(a: { workspaceId: string }): Promise<string>; open(id: string): void }
  } = {}) {
    const create = overrides.create ?? vi.fn().mockResolvedValue({
      slug: 'swift-01',
      path: '/repos/wt-repo/.dsh/worktrees/swift-01',
      relPath: '',
    })
    const workspaces = overrides.workspaces ?? {
      create: vi.fn().mockResolvedValue({ workspaceId: 'ws-1' }),
    }
    const sessions = overrides.sessions ?? {
      create: vi.fn().mockResolvedValue('session-1'),
      open: vi.fn(),
    }
    const onTopologyRefresh = vi.fn()
    return { create, workspaces, sessions, onTopologyRefresh }
  }

  it('creates, registers, binds, opens, and closes in order', async () => {
    const f = faces()
    openCreate('/repos/wt-repo', 'wt-repo', 'quiet otter')
    setCreateName('my own name')
    await runCreateFlow({
      state: modalState().create,
      rpc: vi.fn(((method: string, args?: unknown) => {
        if (method === 'create') return f.create(args)
        return Promise.resolve({})
      })) as unknown as (m: string, a?: unknown) => Promise<unknown>,
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: f.onTopologyRefresh,
    })
    expect(f.create).toHaveBeenCalledWith({ cwd: '/repos/wt-repo', name: 'my own name' })
    expect(f.workspaces.create).toHaveBeenCalledWith({
      path: '/repos/wt-repo/.dsh/worktrees/swift-01',
    })
    expect(f.sessions.create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(f.sessions.open).toHaveBeenCalledWith('session-1')
    expect(modalState().kind).toBe('closed')
    expect(f.onTopologyRefresh).toHaveBeenCalled()
  })

  it('sends name undefined when the suggestion is untouched', async () => {
    const f = faces()
    openCreate('/r', 'r', 'quiet otter')
    await runCreateFlow({
      state: modalState().create,
      rpc: vi.fn(((method: string, args?: unknown) =>
        method === 'create' ? f.create(args) : Promise.resolve({})) as unknown as (m: string, a?: unknown) => Promise<unknown>),
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: () => {},
    })
    expect(f.create).toHaveBeenCalledWith({ cwd: '/r', name: undefined })
  })

  it('mirrors a subdirectory relPath into the workspace path', async () => {
    const f = faces({
      create: vi.fn().mockResolvedValue({
        slug: 'swift-02',
        path: '/repos/wt-repo/.dsh/worktrees/swift-02',
        relPath: 'packages/foo',
      }),
    })
    openCreate('/repos/wt-repo/packages/foo', 'foo', 's')
    await runCreateFlow({
      state: modalState().create,
      rpc: vi.fn(((method: string, args?: unknown) =>
        method === 'create' ? f.create(args) : Promise.resolve({})) as unknown as (m: string, a?: unknown) => Promise<unknown>),
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: () => {},
    })
    expect(f.workspaces.create).toHaveBeenCalledWith({
      path: '/repos/wt-repo/.dsh/worktrees/swift-02/packages/foo',
    })
  })

  it('surfaces the failure and keeps the modal open', async () => {
    const f = faces({
      create: vi.fn().mockRejectedValue(new Error('branch-exists: branch taken')),
    })
    openCreate('/r', 'r', 's')
    await runCreateFlow({
      state: modalState().create,
      rpc: vi.fn(((method: string, args?: unknown) =>
        method === 'create' ? f.create(args) : Promise.resolve({})) as unknown as (m: string, a?: unknown) => Promise<unknown>),
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: () => {},
    })
    expect(modalState().create.open).toBe(true)
    expect(modalState().create.busy).toBe(false)
    expect(modalState().create.error).toContain('branch taken')
    expect(f.workspaces.create).not.toHaveBeenCalled()
  })
})

describe('bridge', () => {
  it('gates the button through the refreshed facts', () => {
    const uninstall = installBridge({
      createLabel: (label) => `New worktree in ${label}`,
      requestCreate: () => {},
    })
    const bridge = window.__dshNextWorktreesBridge
    expect(bridge?.canCreate('/repos/wt-repo')).toBe(false)
    updateBridgeFacts([
      { cwd: '/repos/wt-repo', primary: '/repos/wt-repo', canCreate: true },
      { cwd: '/repos/plain', primary: '', canCreate: false, reason: 'not-a-repository' },
    ])
    expect(bridge?.canCreate('/repos/wt-repo')).toBe(true)
    expect(bridge?.canCreate('/repos/plain')).toBe(false)
    expect(bridge?.canCreate(undefined)).toBe(false)
    expect(bridge?.createLabel('wt-repo')).toBe('New worktree in wt-repo')
    uninstall()
    expect(window.__dshNextWorktreesBridge).toBeUndefined()
  })

  it('forwards requestCreate to the handler', () => {
    const requestCreate = vi.fn()
    const uninstall = installBridge({ createLabel: () => 'x', requestCreate })
    window.__dshNextWorktreesBridge?.requestCreate('/r', 'label')
    expect(requestCreate).toHaveBeenCalledWith('/r', 'label')
    uninstall()
  })
})
