import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  armDelete,
  cleanupMerged,
  closeModal,
  executeDelete,
  executeMerge,
  modalState,
  abortUpdate,
  executeUpdate,
  openDelete,
  openMerge,
  openUpdate,
  resetModalStore,
  runCreateFlow,
  subscribeModal,
} from '../src/client/create-store.ts'
import { installBridge, updateBridgeFacts } from '../src/client/bridge.ts'
import { WORKTREE_STYLES } from '../src/client/styles.ts'

beforeEach(() => {
  resetModalStore()
})

describe('runCreateFlow', () => {
  function faces(overrides: {
    create?: (args: unknown) => Promise<unknown>
    workspaces?: {
      create(a: { path: string }): Promise<{ workspaceId: string }>
      delete?(workspaceId: string): Promise<void>
      archiveSession?(sessionId: string): Promise<void>
    }
    sessions?: { create(a: { workspaceId: string }): Promise<string>; open(id: string): void }
  } = {}) {
    const create = overrides.create ?? vi.fn().mockResolvedValue({
      slug: 'swift-01',
      path: '/repos/wt-repo/.dsh/worktrees/swift-01',
      relPath: '',
      setupPending: false,
    })
    const workspaces = overrides.workspaces ?? {
      create: vi.fn().mockResolvedValue({ workspaceId: 'ws-1' }),
      delete: vi.fn().mockResolvedValue(undefined),
      archiveSession: vi.fn().mockResolvedValue(undefined),
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

  it('runs setup with the identity spinner, then opens the session', async () => {
    const f = faces({
      create: vi.fn().mockResolvedValue({
        slug: 'swift-01',
        path: '/repos/wt-repo/.dsh/worktrees/swift-01',
        relPath: '',
        setupPending: true,
      }),
    })
    const setup = vi.fn().mockImplementation(async () => {
      expect(f.sessions.open).toHaveBeenCalledWith('session-1')
      expect(modalState().settingUp).toEqual({
        slug: 'swift-01',
        sessionId: 'session-1',
        workspaceId: 'ws-1',
        path: '/repos/wt-repo/.dsh/worktrees/swift-01',
      })
      expect(document.documentElement.dataset.dshxSettingUp).toBe('swift-01')
    })
    const rpc = vi.fn((method: string, args?: unknown) => {
      if (method === 'create') return f.create(args)
      if (method === 'setup') return setup(args)
      return Promise.resolve({})
    })
    await runCreateFlow({
      cwd: '/repos/wt-repo',
      rpc,
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: f.onTopologyRefresh,
    })
    expect(f.sessions.open).toHaveBeenCalledWith('session-1')
    expect(setup).toHaveBeenCalledWith({ cwd: '/repos/wt-repo', slug: 'swift-01' })
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(['create', 'bind', 'setup'])
    expect(modalState().settingUp).toBeUndefined()
    expect(document.documentElement.dataset.dshxSettingUp).toBeUndefined()
    expect(f.onTopologyRefresh).toHaveBeenCalledTimes(2)
  })

  it('does not call setup when create reports nothing pending', async () => {
    const f = faces()
    const rpc = rpcOf(f.create)
    await runCreateFlow({
      cwd: '/repos/wt-repo',
      rpc,
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: f.onTopologyRefresh,
    })
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(['create', 'bind'])
  })

  it('spins the repo-row create button from the html dataset', () => {
    expect(WORKTREE_STYLES).toContain('html[data-dshx-creating="true"]:not([data-dshx-setting-up]) [data-dshx-create]')
    expect(WORKTREE_STYLES).toContain(".dshx-worktree-identity[data-dshx-state='setting-up']")
    expect(WORKTREE_STYLES).toContain('@keyframes dshx-spin')
    expect(WORKTREE_STYLES).toContain('prefers-reduced-motion')
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
    expect(document.documentElement.dataset.dshxCreating).toBe('true')
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

  it('surfaces a create failure as the create-error modal', async () => {
    const f = faces({
      create: vi.fn().mockRejectedValue(new Error('git worktree add failed: cannot lock ref')),
    })
    await runCreateFlow({
      cwd: '/r',
      rpc: rpcOf(f.create),
      workspaces: f.workspaces,
      sessions: f.sessions,
      onTopologyRefresh: () => {},
    })
    expect(modalState().kind).toBe('create-error')
    expect(modalState().createError).toContain('cannot lock ref')
    expect(modalState().creating).toBe(false)
    expect(f.workspaces.create).not.toHaveBeenCalled()
    // Dismissing returns to the closed state; a retry is a fresh flow.
    closeModal()
    expect(modalState().kind).toBe('closed')
    const f2 = faces()
    await runCreateFlow({
      cwd: '/r',
      rpc: rpcOf(f2.create),
      workspaces: f2.workspaces,
      sessions: f2.sessions,
      onTopologyRefresh: () => {},
    })
    expect(modalState().kind).toBe('closed')
  })

  it('rolls back the git worktree and workspace when a later step fails', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const workspaces = {
      create: vi.fn().mockResolvedValue({ workspaceId: 'ws-1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    const sessions = {
      create: vi.fn().mockRejectedValue(new Error('session store down')),
      open: vi.fn(),
    }
    const rpc = vi.fn((method: string, args?: unknown) => {
      if (method === 'create') {
        return Promise.resolve({
          slug: 'swift-01',
          path: '/repos/wt-repo/.dsh/worktrees/swift-01',
          relPath: '',
        })
      }
      if (method === 'remove') return remove(args)
      return Promise.resolve({})
    })
    await runCreateFlow({
      cwd: '/repos/wt-repo',
      rpc,
      workspaces,
      sessions,
      onTopologyRefresh: vi.fn(),
    })
    expect(remove).toHaveBeenCalledWith({
      cwd: '/repos/wt-repo/.dsh/worktrees/swift-01',
      slug: 'swift-01',
      force: true,
    })
    expect(workspaces.delete).toHaveBeenCalledWith('ws-1')
    expect(sessions.open).not.toHaveBeenCalled()
    expect(modalState().kind).toBe('create-error')
    expect(modalState().createError).toContain('session store down')
  })

  it('rolls back the session and worktree when setup fails', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const workspaces = {
      create: vi.fn().mockResolvedValue({ workspaceId: 'ws-1' }),
      delete: vi.fn().mockResolvedValue(undefined),
      archiveSession: vi.fn().mockResolvedValue(undefined),
    }
    const sessions = {
      create: vi.fn().mockResolvedValue('session-1'),
      open: vi.fn(),
    }
    const rpc = vi.fn((method: string, args?: unknown) => {
      if (method === 'create') {
        return Promise.resolve({
          slug: 'swift-01',
          path: '/repos/wt-repo/.dsh/worktrees/swift-01',
          relPath: '',
          setupPending: true,
        })
      }
      if (method === 'setup') return Promise.reject(new Error('setup command failed: pnpm install'))
      if (method === 'remove') return remove(args)
      return Promise.resolve({})
    })
    await runCreateFlow({
      cwd: '/repos/wt-repo',
      rpc,
      workspaces,
      sessions,
      onTopologyRefresh: vi.fn(),
    })
    expect(sessions.open).toHaveBeenCalledWith('session-1')
    expect(workspaces.archiveSession).toHaveBeenCalledWith('session-1')
    expect(remove).toHaveBeenCalledWith({
      cwd: '/repos/wt-repo/.dsh/worktrees/swift-01',
      slug: 'swift-01',
      force: true,
    })
    expect(workspaces.delete).toHaveBeenCalledWith('ws-1')
    expect(modalState().kind).toBe('create-error')
    expect(modalState().settingUp).toBeUndefined()
    expect(modalState().createError).toContain('setup command failed')
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
    expect(bridge?.isSettingUp('swift-01')).toBe(false)
    document.documentElement.dataset.dshxSettingUp = 'swift-01'
    expect(bridge?.isSettingUp('swift-01')).toBe(true)
    delete document.documentElement.dataset.dshxSettingUp
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
    const decoration = { slug: 'swift-01', title: 't', branch: 'b', path: '/r/.dsh/worktrees/swift-01', dirty: false, ahead: 0, merged: false, conflict: false }
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

describe('update modal', () => {
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
    conflict: false,
  }

  it('openUpdate pulls the preflight into state', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [], green: true, source: 'main',
      target: 'dsh-worktrees/swift-01', fastForward: true,
      wouldConflict: false, inProgress: false, sessionId: 'wt-session-1',
    })
    openUpdate(target, rpc)
    expect(modalState().kind).toBe('update')
    await vi.waitFor(() => { expect(modalState().update?.busy).toBe(false) })
    expect(modalState().update?.preflight).toMatchObject({ green: true, source: 'main' })
    expect(rpc).toHaveBeenCalledWith('update/preflight', { cwd: target.path, slug: target.slug })
  })

  it('executeUpdate lands on the done view and hands off on conflict', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [], green: true, source: 'main',
      target: 'dsh-worktrees/swift-01', fastForward: false,
      wouldConflict: true, inProgress: false, sessionId: 'wt-session-1',
    })
    openUpdate(target, rpc)
    await vi.waitFor(() => { expect(modalState().update?.preflight).toBeDefined() })
    const exec = vi.fn().mockResolvedValue({
      source: 'main', conflict: true, sessionId: 'wt-session-1',
    })
    const open = vi.fn()
    const prompt = vi.fn()
    executeUpdate(exec, { open, prompt }, 'please resolve')
    await vi.waitFor(() => {
      expect(modalState().update?.done).toEqual({
        source: 'main', conflict: true, sessionId: 'wt-session-1',
      })
    })
    expect(open).toHaveBeenCalledWith('wt-session-1')
    expect(prompt).toHaveBeenCalledWith('wt-session-1', 'please resolve')
  })

  it('executeUpdate does not prompt on a clean update', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [], green: true, source: 'main',
      target: 'dsh-worktrees/swift-01', fastForward: true,
      wouldConflict: false, inProgress: false, sessionId: 'wt-session-1',
    })
    openUpdate(target, rpc)
    await vi.waitFor(() => { expect(modalState().update?.preflight).toBeDefined() })
    const prompt = vi.fn()
    executeUpdate(
      vi.fn().mockResolvedValue({ source: 'main', conflict: false, sessionId: 'wt-session-1' }),
      { open: vi.fn(), prompt },
      'please resolve',
    )
    await vi.waitFor(() => { expect(modalState().update?.done?.conflict).toBe(false) })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('abortUpdate closes on success', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: ['in-progress'], green: false, source: 'main',
      target: 'dsh-worktrees/swift-01', fastForward: false,
      wouldConflict: false, inProgress: true, sessionId: 'wt-session-1',
    })
    openUpdate(target, rpc)
    await vi.waitFor(() => { expect(modalState().update?.preflight).toBeDefined() })
    const abort = vi.fn().mockResolvedValue(undefined)
    await abortUpdate(abort)
    expect(abort).toHaveBeenCalledWith('update/abort', { cwd: target.path, slug: target.slug })
    expect(modalState().kind).toBe('closed')
  })

  it('abortUpdate surfaces failures', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: ['in-progress'], green: false, inProgress: true,
      source: 'main', target: 'dsh-worktrees/swift-01',
      fastForward: false, wouldConflict: false, sessionId: 'wt-session-1',
    })
    openUpdate(target, rpc)
    await vi.waitFor(() => { expect(modalState().update?.preflight).toBeDefined() })
    await abortUpdate(vi.fn().mockRejectedValue(new Error('not-in-progress')))
    expect(modalState().kind).toBe('update')
    expect(modalState().update?.error).toContain('not-in-progress')
  })
})
