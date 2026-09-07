import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModalHost } from '../src/client/modal-host.tsx'
import {
  closeModal,
  modalState,
  openMerge,
  openUpdate,
  resetModalStore,
  runCreateFlow,
  type WorktreeModalTarget,
} from '../src/client/create-store.ts'
import { englishTranslate, type MessageKey } from '../src/client/dictionaries.ts'
import { WorktreesRpcError } from '../src/client/rpc.ts'
import type { SessionsServiceLike, Translate, WorkspacesServiceLike } from '../src/client/types.ts'

const target: WorktreeModalTarget = {
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

const t: Translate = (key, params) => englishTranslate(key as MessageKey, params)
const workspaces: WorkspacesServiceLike = {
  create: async () => ({ workspaceId: 'ws', path: '/r' }),
  delete: async () => {},
  archiveSession: async () => {},
}
const sessions: SessionsServiceLike = {
  create: async () => 's',
  open: () => {},
}

let container: HTMLDivElement | undefined
let root: Root | undefined

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(React.createElement(ModalHost, { t, workspaces, sessions }))
  })
  return container
}

beforeEach(() => {
  resetModalStore()
})

afterEach(async () => {
  closeModal()
  if (root !== undefined) await act(async () => { root!.unmount() })
  container?.remove()
  container = undefined
  root = undefined
})

describe('create-in-progress status', () => {
  it('announces Creating worktree while the auto-named flow is in flight', async () => {
    const hanging = new Promise(() => {})
    void runCreateFlow({
      cwd: '/repos/wt-repo',
      rpc: () => hanging,
      workspaces: { create: async () => ({ workspaceId: 'ws' }) },
      sessions: { create: async () => 's', open: () => {} },
      onTopologyRefresh: () => {},
    })
    await vi.waitFor(() => { expect(document.documentElement.dataset.dshxCreating).toBe('true') })
    const node = await mount()
    const status = node.querySelector('[data-dshx-creating-status]')
    expect(status).not.toBeNull()
    expect(status?.getAttribute('role')).toBe('status')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.className).toBe('dshx-srOnly')
    expect(status?.textContent).toBe('Creating worktree…')
  })

  it('announces Setting up worktree once the session row exists', async () => {
    let finishSetup: () => void = () => {}
    const setupHang = new Promise<void>((resolve) => { finishSetup = resolve })
    void runCreateFlow({
      cwd: '/repos/wt-repo',
      rpc: async (method) => {
        if (method === 'create') {
          return {
            slug: 'swift-01',
            path: '/repos/wt-repo/.dsh/worktrees/swift-01',
            relPath: '',
            setupPending: true,
          }
        }
        if (method === 'setup') return setupHang
        return {}
      },
      workspaces: { create: async () => ({ workspaceId: 'ws' }) },
      sessions: { create: async () => 's', open: () => {} },
      onTopologyRefresh: () => {},
    })
    await vi.waitFor(() => { expect(modalState().settingUp?.slug).toBe('swift-01') })
    const node = await mount()
    expect(node.querySelector('[data-dshx-creating-status]')?.textContent).toBe('Setting up worktree…')
    finishSetup()
  })

  it('drops the status once create settles', async () => {
    await runCreateFlow({
      cwd: '/repos/wt-repo',
      rpc: async (method) => method === 'create'
        ? { slug: 'swift-01', path: '/repos/wt-repo/.dsh/worktrees/swift-01', relPath: '' }
        : {},
      workspaces: { create: async () => ({ workspaceId: 'ws' }) },
      sessions: { create: async () => 's', open: () => {} },
      onTopologyRefresh: () => {},
    })
    const node = await mount()
    expect(node.querySelector('[data-dshx-creating-status]')).toBeNull()
  })

  it('shows the setup command output on a create-error', async () => {
    await runCreateFlow({
      cwd: '/repos/wt-repo',
      rpc: async (method) => {
        if (method === 'create') {
          return {
            slug: 'swift-01',
            path: '/repos/wt-repo/.dsh/worktrees/swift-01',
            relPath: '',
            setupPending: true,
          }
        }
        if (method === 'setup') {
          throw new WorktreesRpcError(
            'setup-failed',
            'setup command failed: pnpm install',
            'ERR_PNPM_LOCKED: Waiting for the other process to finish',
          )
        }
        return {}
      },
      workspaces: {
        create: async () => ({ workspaceId: 'ws' }),
        delete: async () => {},
        archiveSession: async () => {},
      },
      sessions: { create: async () => 's', open: () => {} },
      onTopologyRefresh: () => {},
    })
    const node = await mount()
    const modal = node.querySelector('[data-dshx-modal="create-error"]')
    expect(modal?.getAttribute('data-dshx-create-error')).toBe('setup')
    expect(node.querySelector('.dshx-modalTitle')?.textContent).toBe('Worktree created, but setup failed')
    expect(node.querySelector('.dshx-fieldHint')?.textContent).toContain('worktree and session are ready')
    const body = node.querySelector('[data-dshx-error]')?.textContent ?? ''
    expect(body).toContain('setup command failed: pnpm install')
    expect(body).toContain('ERR_PNPM_LOCKED')
  })
})

describe('MergeModal', () => {
  it('names Resolve in this session on conflict, with no CLI dump', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: ['conflict'],
      green: false,
      source: 'dsh-worktrees/swift-01',
      target: 'main',
      fastForward: false,
      aheadCount: 1,
      manualCommand: 'git merge dsh-worktrees/swift-01',
    })
    openMerge(target, rpc)
    const node = await mount()
    await vi.waitFor(() => {
      expect(node.querySelector('[data-dshx-blocker="conflict"]')).not.toBeNull()
    })
    const blocker = node.querySelector('[data-dshx-blocker="conflict"]')
    expect(blocker?.textContent).toContain('Resolve in this session')
    expect(blocker?.textContent).not.toMatch(/git merge/)
    const cta = node.querySelector('[data-dshx-button="update-from-merge"]')
    expect(cta?.textContent).toBe('Resolve in this session…')
    expect(node.querySelector('[data-dshx-button="merge"]')).toBeNull()
  })

  it('labels the execute confirm Merge, without an ellipsis', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [],
      green: true,
      source: 'dsh-worktrees/swift-01',
      target: 'main',
      fastForward: true,
      aheadCount: 1,
    })
    openMerge(target, rpc)
    const node = await mount()
    await vi.waitFor(() => {
      expect(node.querySelector('[data-dshx-button="merge"]')).not.toBeNull()
    })
    expect(node.querySelector('[data-dshx-button="merge"]')?.textContent).toBe('Merge')
  })

  it('lists dirty primary files and keeps Merge enabled', async () => {
    const files = Array.from({ length: 12 }, (_, i) => `docs/screenshots/file-${i}.png`)
    const rpc = vi.fn().mockResolvedValue({
      blockers: [],
      warnings: ['dirty-primary'],
      green: true,
      source: 'dsh-worktrees/swift-01',
      target: 'main',
      fastForward: true,
      aheadCount: 1,
      dirtyPrimary: files,
      dirtyWorktree: [],
    })
    openMerge(target, rpc)
    const node = await mount()
    await vi.waitFor(() => {
      expect(node.querySelector('[data-dshx-warning="dirty-primary"]')).not.toBeNull()
    })
    expect(node.querySelector('[data-dshx-warning="dirty-primary"]')?.textContent).toContain('main')
    const list = node.querySelector('[data-dshx-dirty-files="dirty-primary"]')
    expect(list).not.toBeNull()
    expect(list?.getAttribute('tabindex')).toBe('0')
    expect(list?.textContent).toContain('docs/screenshots/file-0.png')
    expect(list?.textContent).toContain('docs/screenshots/file-11.png')
    expect(list?.querySelectorAll('.dshx-dirtyFile')).toHaveLength(12)
    const merge = node.querySelector('[data-dshx-button="merge"]')
    expect(merge).not.toBeNull()
    expect(merge).toHaveProperty('disabled', false)
  })
})

describe('UpdateModal', () => {
  it('labels the execute confirm without an ellipsis and warns on would-conflict', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [],
      green: true,
      source: 'main',
      target: 'dsh-worktrees/swift-01',
      fastForward: false,
      wouldConflict: true,
      inProgress: false,
      sessionId: 'wt-session-1',
    })
    openUpdate(target, rpc)
    const node = await mount()
    await vi.waitFor(() => {
      expect(node.querySelector('[data-dshx-button="update"]')).not.toBeNull()
    })
    expect(node.querySelector('[data-dshx-button="update"]')?.textContent).toBe('Resolve in this session')
    const warn = node.querySelector('[data-dshx-update="would-conflict"]')
    expect(warn?.className).toBe('dshx-warn')
    expect(warn?.textContent).toMatch(/This session will resolve/)
  })

  it('keeps Update from main on a clean catch-up', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: [],
      green: true,
      source: 'main',
      target: 'dsh-worktrees/swift-01',
      fastForward: true,
      wouldConflict: false,
      inProgress: false,
      sessionId: 'wt-session-1',
    })
    openUpdate(target, rpc)
    const node = await mount()
    await vi.waitFor(() => {
      expect(node.querySelector('[data-dshx-button="update"]')).not.toBeNull()
    })
    expect(node.querySelector('[data-dshx-button="update"]')?.textContent).toBe('Update from main')
  })

  it('drops Cancel on an in-flight merge and paints Abort as danger', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: ['in-progress'],
      green: false,
      source: 'main',
      target: 'dsh-worktrees/swift-01',
      fastForward: false,
      wouldConflict: false,
      inProgress: true,
      sessionId: 'wt-session-1',
    })
    openUpdate(target, rpc)
    const node = await mount()
    await vi.waitFor(() => {
      expect(node.querySelector('[data-dshx-button="abort-update"]')).not.toBeNull()
    })
    expect(node.querySelector('[data-dshx-button="cancel"]')).toBeNull()
    const abort = node.querySelector('[data-dshx-button="abort-update"]')
    expect(abort?.className).toBe('dshx-buttonDanger')
    expect(abort?.textContent).toBe('Abort merge')
    expect(node.querySelector('.dshx-modalTitle')?.textContent).toBe('Merge in progress')
    expect(node.querySelector('[data-dshx-button="continue-update"]')?.textContent).toBe('Resolve in this session')
    expect(node.querySelector('[data-dshx-update="handoff"]')?.textContent).toMatch(/Closing this dialog/)
  })

  it('lists dirty worktree files without making a short list tabbable', async () => {
    const rpc = vi.fn().mockResolvedValue({
      blockers: ['dirty-worktree'],
      green: false,
      source: 'main',
      target: 'dsh-worktrees/swift-01',
      fastForward: true,
      wouldConflict: false,
      inProgress: false,
      sessionId: 'wt-session-1',
      dirtyWorktree: ['scratch.txt'],
    })
    openUpdate(target, rpc)
    const node = await mount()
    await vi.waitFor(() => {
      expect(node.querySelector('[data-dshx-blocker="dirty-worktree"]')).not.toBeNull()
    })
    const list = node.querySelector('[data-dshx-dirty-files="dirty-worktree"]')
    expect(list?.textContent).toContain('scratch.txt')
    expect(list?.getAttribute('tabindex')).toBeNull()
    expect(node.querySelector('[data-dshx-blocker="dirty-worktree"]')?.textContent)
      .toContain('dsh-worktrees/swift-01')
  })
})
