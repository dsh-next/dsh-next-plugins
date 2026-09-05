import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  armDelete,
  cleanupMerged,
  closeModal,
  executeDelete,
  executeMerge,
  modalState,
  openDelete,
  openMerge,
  resetModalStore,
  runCreateFlow,
  subscribeModal,
} from '../src/client/create-store.ts'
import { installBridge, updateBridgeFacts } from '../src/client/bridge.ts'

beforeEach(() => {
  resetModalStore()
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

  function rpcOf(create: (args: unknown) => Promise<unknown>) {
    return vi.fn(((method: string, args?: unknown) =>
      method === 'create' ? create(args) : Promise.resolve({})) as unknown as (m: string, a?: unknown) => Promise<unknown>)
  }

  it('creates, registers, binds, opens, and resets in order', async () => {
    const f = faces()
    await runCreateFlow({
      cwd: '/repos/wt-repo',
      rpc: rpcOf(f.create),
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: f.onTopologyRefresh,
    })
    expect(f.create).toHaveBeenCalledWith({ cwd: '/repos/wt-repo' })
    expect(f.workspaces.create).toHaveBeenCalledWith({
      path: '/repos/wt-repo/.dsh/worktrees/swift-01',
    })
    expect(f.sessions.create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(f.sessions.open).toHaveBeenCalledWith('session-1')
    expect(modalState().kind).toBe('closed')
    expect(modalState().creating).toBe(false)
    expect(f.onTopologyRefresh).toHaveBeenCalled()
  })

  it('guards re-entry while the flow is in flight', async () => {
    const f = faces({
      create: vi.fn(() => new Promise(() => {})), // never settles
    })
    const first = runCreateFlow({
      cwd: '/r',
      rpc: rpcOf(f.create),
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: () => {},
    })
    await vi.waitFor(() => { expect(modalState().creating).toBe(true) })
    await runCreateFlow({
      cwd: '/r',
      rpc: rpcOf(f.create),
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: () => {},
    })
    expect(f.create).toHaveBeenCalledTimes(1)
  })

  it('mirrors a subdirectory relPath into the workspace path', async () => {
    const f = faces({
      create: vi.fn().mockResolvedValue({
        slug: 'swift-02',
        path: '/repos/wt-repo/.dsh/worktrees/swift-02',
        relPath: 'packages/foo',
      }),
    })
    await runCreateFlow({
      cwd: '/repos/wt-repo/packages/foo',
      rpc: rpcOf(f.create),
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: () => {},
    })
    expect(f.workspaces.create).toHaveBeenCalledWith({
      path: '/repos/wt-repo/.dsh/worktrees/swift-02/packages/foo',
    })
  })

  it('releases the re-entry guard and rethrows on failure', async () => {
    const f = faces({
      create: vi.fn().mockRejectedValue(new Error('branch-exists: branch taken')),
    })
    await expect(runCreateFlow({
      cwd: '/r',
      rpc: rpcOf(f.create),
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: () => {},
    })).rejects.toThrow('branch taken')
    expect(modalState().creating).toBe(false)
    expect(f.workspaces.create).not.toHaveBeenCalled()
  })
})

describe('bridge', () => {
  it('gates the button through the refreshed facts', () => {
    const uninstall = installBridge({
      createLabel: (label) => `New worktree in ${label}`,
      requestCreate: () => {},
      menuLabel: (key) => `label:${key}`,
      worktreeFacts: () => [],
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

  it('forwards requestCreate and serves localized worktree facts', () => {
    const requestCreate = vi.fn()
    const requestMenu = vi.fn()
    const worktreeFacts = vi.fn(() => ['title', 'branch: b', 'status: clean'])
    const uninstall = installBridge({
      createLabel: () => 'x',
      requestCreate,
      menuLabel: () => 'm',
      worktreeFacts,
      requestMenu,
    })
    window.__dshNextWorktreesBridge?.requestCreate('/r', 'label')
    expect(requestCreate).toHaveBeenCalledWith('/r', 'label')
    const decoration = { slug: 'swift-01', title: 't', branch: 'b', path: '/r/.dsh/worktrees/swift-01', dirty: false, ahead: 0, merged: false }
    window.__dshNextWorktreesBridge?.requestMenu('merge', decoration, 'session-1')
    expect(requestMenu).toHaveBeenCalledWith('merge', decoration, 'session-1')
    expect(window.__dshNextWorktreesBridge?.menuLabel('row.refresh')).toBe('m')
    expect(window.__dshNextWorktreesBridge?.worktreeFacts(decoration)).toEqual([
      'title', 'branch: b', 'status: clean',
    ])
    expect(worktreeFacts).toHaveBeenCalledWith(decoration)
    uninstall()
  })
})

describe('merge and delete modals', () => {
  const target = {
    slug: 'swift-01',
    title: 'login race fix',
    branch: 'dsh-worktrees/swift-01',
    path: '/repos/wt-repo/.dsh/worktrees/swift-01',
    workspaceId: 'wt-ws',
    sessionIds: ['wt-session-1'],
    dirty: false,
    ahead: 2,
    merged: false,
  }

  function host() {
    return {
      archiveSession: vi.fn().mockResolvedValue(undefined),
      removeWorkspace: vi.fn().mockResolvedValue(undefined),
    }
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
    const h = host()
    await cleanupMerged(remove, h)
    expect(remove).toHaveBeenCalledWith('remove', { cwd: target.path, slug: target.slug, force: false })
    expect(h.archiveSession).toHaveBeenCalledWith('wt-session-1')
    expect(h.removeWorkspace).toHaveBeenCalledWith('wt-ws')
    expect(modalState().kind).toBe('closed')
  })

  it('cleanupMerged still closes when the host cleanup fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [], green: true, target: 'main',
      source: 'dsh-worktrees/swift-01', fastForward: true, aheadCount: 0,
    })
    openMerge(target, rpc)
    await vi.waitFor(() => { expect(modalState().merge?.preflight).toBeDefined() })
    executeMerge(vi.fn().mockResolvedValue({ target: 'main', fastForward: true }))
    await vi.waitFor(() => { expect(modalState().merge?.done).toBeDefined() })
    const h = { archiveSession: vi.fn().mockRejectedValue(new Error('gone')), removeWorkspace: vi.fn().mockRejectedValue(new Error('gone')) }
    await cleanupMerged(vi.fn().mockResolvedValue(undefined), h)
    expect(modalState().merge?.error).toContain('gone')
    expect(modalState().kind).toBe('merge')
  })

  it('delete arms immediately for a clean target', async () => {
    openDelete(target)
    expect(modalState().kind).toBe('delete')
    expect(modalState().delete?.armed).toBe(true)
    const remove = vi.fn().mockResolvedValue(undefined)
    const h = host()
    await executeDelete(remove, h)
    expect(remove).toHaveBeenCalledWith('remove', { cwd: target.path, slug: target.slug, force: false })
    expect(h.archiveSession).toHaveBeenCalledWith('wt-session-1')
    expect(h.removeWorkspace).toHaveBeenCalledWith('wt-ws')
    expect(modalState().kind).toBe('closed')
  })

  it('delete skips host cleanup fields when the decoration lacks them', async () => {
    openDelete({ ...target, workspaceId: undefined, sessionIds: undefined })
    const remove = vi.fn().mockResolvedValue(undefined)
    const h = host()
    await executeDelete(remove, h)
    expect(h.archiveSession).not.toHaveBeenCalled()
    expect(h.removeWorkspace).not.toHaveBeenCalled()
    expect(modalState().kind).toBe('closed')
  })

  it('delete forces a two-step arm for a dirty target', async () => {
    openDelete({ ...target, dirty: true })
    expect(modalState().delete?.armed).toBe(false)
    const remove = vi.fn().mockResolvedValue(undefined)
    const h = host()
    executeDelete(remove, h)
    expect(remove).not.toHaveBeenCalled()
    armDelete()
    await executeDelete(remove, h)
    expect(remove).toHaveBeenCalledWith('remove', { cwd: target.path, slug: target.slug, force: true })
    expect(modalState().kind).toBe('closed')
  })

  it('delete surfaces removal failures', async () => {
    openDelete(target)
    const remove = vi.fn().mockRejectedValue(new Error('dirty-remove-refused: dirty'))
    await executeDelete(remove, host())
    expect(modalState().kind).toBe('delete')
    expect(modalState().delete?.error).toContain('dirty-remove-refused')
  })
})
