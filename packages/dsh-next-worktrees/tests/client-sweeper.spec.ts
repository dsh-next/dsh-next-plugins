import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  configureWorktreeSweeper,
  sweepAbandonedWorktrees,
  type SweepDeps,
} from '../src/client/sweeper.ts'

const PRIMARY = '/repos/wt-repo'

function ws(overrides: Partial<{
  workspaceId: string
  path: string
  sessionIds: string[]
}> = {}) {
  return {
    workspaceId: 'wt-ws',
    path: `${PRIMARY}/.dsh/worktrees/swift-01`,
    sessionIds: ['s1'],
    ...overrides,
  }
}

function deps(overrides: Partial<SweepDeps> = {}): SweepDeps {
  return {
    removeWorktree: overrides.removeWorktree ?? vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: overrides.deleteWorkspace ?? vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  configureWorktreeSweeper(undefined)
})

describe('sweepAbandonedWorktrees', () => {
  it('removes the worktree and deletes the workspace of a dead session', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['gone-1'] })],
      liveSessionIds: new Set(['other-1']),
      creating: false,
    })
    expect(swept).toEqual(['swift-01'])
    expect(d.removeWorktree).toHaveBeenCalledWith({ cwd: PRIMARY, slug: 'swift-01' })
    expect(d.deleteWorkspace).toHaveBeenCalledWith('wt-ws')
  })

  it('sweeps a workspace whose sessionIds list is empty', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: [] })],
      liveSessionIds: new Set(['unrelated']),
      creating: false,
    })
    expect(swept).toEqual(['swift-01'])
  })

  it('keeps a worktree with any live session', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['s1', 'gone-1'] })],
      liveSessionIds: new Set(['s1']),
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
    expect(d.deleteWorkspace).not.toHaveBeenCalled()
  })

  it('never sweeps while a create flow is in flight', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: [] })],
      liveSessionIds: new Set(['other']),
      creating: true,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('never sweeps on an empty live-session set (store still loading)', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: [] })],
      liveSessionIds: new Set(),
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('a dirty worktree refuses removal and keeps its workspace', async () => {
    const d = deps({
      removeWorktree: vi.fn().mockRejectedValue(new Error('dirty-remove-refused: dirty')),
    })
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: [] })],
      liveSessionIds: new Set(['other']),
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.deleteWorkspace).not.toHaveBeenCalled()
  })

  it('still deletes the workspace when the git side is already gone', async () => {
    const d = deps({
      removeWorktree: vi.fn().mockRejectedValue(new Error('unknown-slug: no worktree bound')),
    })
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: [] })],
      liveSessionIds: new Set(['other']),
      creating: false,
    })
    expect(swept).toEqual(['swift-01'])
    expect(d.deleteWorkspace).toHaveBeenCalledWith('wt-ws')
  })

  it('ignores non-worktree workspaces and nested paths', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [
        ws({ workspaceId: 'plain', path: '/repos/plain', sessionIds: [] }),
        ws({ workspaceId: 'nested', path: `${PRIMARY}/.dsh/worktrees/swift-01/sub`, sessionIds: [] }),
      ],
      liveSessionIds: new Set(['other']),
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('is a no-op without configured deps', async () => {
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: [] })],
      liveSessionIds: new Set(['other']),
      creating: false,
    })
    expect(swept).toEqual([])
  })
})
