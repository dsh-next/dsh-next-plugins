import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  armDelete,
  cleanupMerged,
  closeModal,
  executeDelete,
  executeMerge,
  modalState,
  openCreate,
  openDelete,
  openMerge,
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
      menuLabel: (key) => `label:${key}`,
      requestMenu: () => {},
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
    const requestMenu = vi.fn()
    const uninstall = installBridge({ createLabel: () => 'x', requestCreate, menuLabel: () => 'm', requestMenu })
    window.__dshNextWorktreesBridge?.requestCreate('/r', 'label')
    expect(requestCreate).toHaveBeenCalledWith('/r', 'label')
    const decoration = { slug: 'swift-01', title: 't', branch: 'b', path: '/r/.dsh/worktrees/swift-01', dirty: false, ahead: 0, merged: false }
    window.__dshNextWorktreesBridge?.requestMenu('merge', decoration, 'session-1')
    expect(requestMenu).toHaveBeenCalledWith('merge', decoration, 'session-1')
    expect(window.__dshNextWorktreesBridge?.menuLabel('row.refresh')).toBe('m')
    uninstall()
  })
})

describe('merge and delete modals', () => {
  const target = {
    slug: 'swift-01',
    title: 'login race fix',
    branch: 'dsh-worktrees/swift-01',
    path: '/repos/wt-repo/.dsh/worktrees/swift-01',
    dirty: false,
    ahead: 2,
    merged: false,
  }

  it('openMerge pulls the preflight into state', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [], green: true, target: 'main',
      source: 'dsh-worktrees/swift-01', fastForward: true, aheadCount: 2,
    })
    openMerge(target, rpc)
    expect(modalState().kind).toBe('merge')
    expect(modalState().merge?.busy).toBe(true)
    await vi.waitFor(() => { expect(modalState().merge?.busy).toBe(false) })
    expect(modalState().merge?.preflight).toMatchObject({ green: true, target: 'main' })
    expect(rpc).toHaveBeenCalledWith('merge/preflight', { cwd: target.path, slug: target.slug })
  })

  it('openMerge surfaces a preflight failure as an error', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('rpc down'))
    openMerge(target, rpc)
    await vi.waitFor(() => { expect(modalState().merge?.error).toContain('rpc down') })
  })

  it('executeMerge lands on the done view', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [], green: true, target: 'main',
      source: 'dsh-worktrees/swift-01', fastForward: false, aheadCount: 1,
    })
    openMerge(target, rpc)
    await vi.waitFor(() => { expect(modalState().merge?.preflight).toBeDefined() })
    const exec = vi.fn().mockResolvedValue({ target: 'main', fastForward: false })
    executeMerge(exec)
    await vi.waitFor(() => { expect(modalState().merge?.done).toEqual({ target: 'main', fastForward: false }) })
  })

  it('cleanupMerged removes and closes', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [], green: true, target: 'main',
      source: 'dsh-worktrees/swift-01', fastForward: true, aheadCount: 0,
    })
    openMerge(target, rpc)
    await vi.waitFor(() => { expect(modalState().merge?.preflight).toBeDefined() })
    const exec = vi.fn().mockResolvedValue({ target: 'main', fastForward: true })
    executeMerge(exec)
    await vi.waitFor(() => { expect(modalState().merge?.done).toBeDefined() })
    const remove = vi.fn().mockResolvedValue(undefined)
    await cleanupMerged(remove)
    expect(remove).toHaveBeenCalledWith('remove', { cwd: target.path, slug: target.slug, force: false })
    expect(modalState().kind).toBe('closed')
  })

  it('delete arms immediately for a clean target', async () => {
    openDelete(target)
    expect(modalState().kind).toBe('delete')
    expect(modalState().delete?.armed).toBe(true)
    const remove = vi.fn().mockResolvedValue(undefined)
    await executeDelete(remove)
    expect(remove).toHaveBeenCalledWith('remove', { cwd: target.path, slug: target.slug, force: false })
    expect(modalState().kind).toBe('closed')
  })

  it('delete forces a two-step arm for a dirty target', async () => {
    openDelete({ ...target, dirty: true })
    expect(modalState().delete?.armed).toBe(false)
    const remove = vi.fn().mockResolvedValue(undefined)
    executeDelete(remove)
    expect(remove).not.toHaveBeenCalled()
    armDelete()
    await executeDelete(remove)
    expect(remove).toHaveBeenCalledWith('remove', { cwd: target.path, slug: target.slug, force: true })
    expect(modalState().kind).toBe('closed')
  })

  it('delete surfaces removal failures', async () => {
    openDelete(target)
    const remove = vi.fn().mockRejectedValue(new Error('dirty-remove-refused: dirty'))
    await executeDelete(remove)
    expect(modalState().kind).toBe('delete')
    expect(modalState().delete?.error).toContain('dirty-remove-refused')
  })
})
