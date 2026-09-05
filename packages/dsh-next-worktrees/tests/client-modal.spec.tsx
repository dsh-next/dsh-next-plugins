import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModalHost } from '../src/client/modal-host.tsx'
import {
  closeModal,
  openMerge,
  openUpdate,
  resetModalStore,
  type WorktreeModalTarget,
} from '../src/client/create-store.ts'
import { englishTranslate, type MessageKey } from '../src/client/dictionaries.ts'
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

describe('MergeModal', () => {
  it('names Update from the target branch on conflict, with no CLI dump', async () => {
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
    expect(blocker?.textContent).toContain('Update from main')
    expect(blocker?.textContent).not.toMatch(/git merge/)
    const cta = node.querySelector('[data-dshx-button="update-from-merge"]')
    expect(cta?.textContent).toBe('Update from main…')
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
    expect(node.querySelector('[data-dshx-button="update"]')?.textContent).toBe('Update from main')
    const warn = node.querySelector('[data-dshx-update="would-conflict"]')
    expect(warn?.className).toBe('dshx-warn')
    expect(warn?.textContent).toMatch(/agent in this session/)
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
    expect(node.querySelector('[data-dshx-button="continue-update"]')?.textContent).toBe('Open session')
    expect(node.querySelector('[data-dshx-update="handoff"]')?.textContent).toMatch(/Closing this dialog/)
  })
})
