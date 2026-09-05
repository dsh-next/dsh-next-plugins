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
    archiveSession: overrides.archiveSession ?? vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: overrides.deleteWorkspace ?? vi.fn().mockResolvedValue(undefined),
  }
}

/** Blank, never-started session summaries. */
function blankStore(ids: readonly string[]): Record<string, { id: string; blank: boolean }> {
  return Object.fromEntries(ids.map((id) => [id, { id, blank: true }]))
}

beforeEach(() => {
  configureWorktreeSweeper(undefined)
})

describe('sweepAbandonedWorktrees', () => {
  it('sweeps a worktree whose only session is a blank the user switched away from', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['blank-1'] })],
      sessionsById: { ...blankStore(['blank-1']), other: { id: 'other', blank: false } },
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual(['swift-01'])
    expect(d.removeWorktree).toHaveBeenCalledWith({ cwd: PRIMARY, slug: 'swift-01' })
    expect(d.archiveSession).toHaveBeenCalledWith('blank-1')
    expect(d.deleteWorkspace).toHaveBeenCalledWith('wt-ws')
  })

  it('sweeps when the session record is gone from the store entirely', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['ghost'] })],
      sessionsById: { other: { id: 'other', blank: false } },
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual(['swift-01'])
    expect(d.deleteWorkspace).toHaveBeenCalledWith('wt-ws')
  })

  it('keeps a worktree holding the currently open session, however blank', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['blank-1'] })],
      sessionsById: blankStore(['blank-1']),
      currentSessionId: 'blank-1',
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('keeps a worktree whose session started (non-blank)', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['live-1'] })],
      sessionsById: { 'live-1': { id: 'live-1', blank: false } },
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('never sweeps while a create flow is in flight', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['blank-1'] })],
      sessionsById: blankStore(['blank-1']),
      currentSessionId: 'other',
      creating: true,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('never sweeps on an empty session store (still loading)', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: [] })],
      sessionsById: {},
      currentSessionId: undefined,
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('a dirty worktree refuses removal and keeps everything', async () => {
    const d = deps({
      removeWorktree: vi.fn().mockRejectedValue(new Error('dirty-remove-refused: dirty')),
    })
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['blank-1'] })],
      sessionsById: blankStore(['blank-1']),
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.archiveSession).not.toHaveBeenCalled()
    expect(d.deleteWorkspace).not.toHaveBeenCalled()
  })

  it('still cleans the workspace when the git side is already gone', async () => {
    const d = deps({
      removeWorktree: vi.fn().mockRejectedValue(new Error('unknown-slug: no worktree bound')),
    })
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['blank-1'] })],
      sessionsById: blankStore(['blank-1']),
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual(['swift-01'])
    expect(d.archiveSession).toHaveBeenCalledWith('blank-1')
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
      sessionsById: { other: { id: 'other', blank: false } },
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('is a no-op without configured deps', async () => {
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['blank-1'] })],
      sessionsById: blankStore(['blank-1']),
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual([])
  })
})
