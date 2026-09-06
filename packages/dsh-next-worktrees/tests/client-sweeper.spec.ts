import { describe, expect, it, beforeEach, vi } from 'vitest'
import { WorktreesRpcError } from '../src/client/rpc.ts'
import {
  configureWorktreeSweeper,
  isDirtyRefusal,
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

  it('keeps a worktree after /reset when the archived sibling is still a non-blank byId row', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['old-archived', 'new-blank'] })],
      sessionsById: {
        'old-archived': { id: 'old-archived', blank: false },
        'new-blank': { id: 'new-blank', blank: true },
        other: { id: 'other', blank: false },
      },
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('sweeps after /reset if archive dropped the old row from byId and the replacement blank is not current', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ sessionIds: ['old-archived', 'new-blank'] })],
      sessionsById: {
        'new-blank': { id: 'new-blank', blank: true },
        other: { id: 'other', blank: false },
      },
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual(['swift-01'])
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
    // Production shape: code on .code, human message without the token.
    const d = deps({
      removeWorktree: vi.fn().mockRejectedValue(
        new WorktreesRpcError('dirty-remove-refused', 'worktree has uncommitted changes'),
      ),
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

  it('ignores non-worktree workspaces', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [
        ws({ workspaceId: 'plain', path: '/repos/plain', sessionIds: [] }),
      ],
      sessionsById: { other: { id: 'other', blank: false } },
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual([])
    expect(d.removeWorktree).not.toHaveBeenCalled()
  })

  it('sweeps a subdirectory workspace using the worktree slug', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({
        path: `${PRIMARY}/.dsh/worktrees/swift-01/packages/foo`,
        sessionIds: ['blank-1'],
      })],
      sessionsById: blankStore(['blank-1']),
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual(['swift-01'])
    expect(d.removeWorktree).toHaveBeenCalledWith({ cwd: PRIMARY, slug: 'swift-01' })
  })

  it('matches dirty refusal on the machine code, not the message', () => {
    expect(isDirtyRefusal(new WorktreesRpcError('dirty-remove-refused', 'worktree has uncommitted changes'))).toBe(true)
    expect(isDirtyRefusal(new WorktreesRpcError('unknown-slug', 'no worktree bound'))).toBe(false)
    expect(isDirtyRefusal(new Error('worktree has uncommitted changes'))).toBe(false)
    expect(isDirtyRefusal(new Error('dirty-remove-refused: dirty'))).toBe(true)
  })

  it('skips an overlapping sweep rather than running two at once', async () => {
    let release: () => void = () => {}
    const d = deps({
      removeWorktree: vi.fn().mockReturnValue(new Promise<void>((resolve) => { release = resolve })),
    })
    configureWorktreeSweeper(d)
    const snapshot = {
      workspaces: [ws({ sessionIds: ['blank-1'] })],
      sessionsById: blankStore(['blank-1']),
      currentSessionId: 'other',
      creating: false,
    }
    const first = sweepAbandonedWorktrees(snapshot)
    const second = await sweepAbandonedWorktrees(snapshot)
    expect(second).toEqual([])
    expect(d.removeWorktree).toHaveBeenCalledTimes(1)
    release()
    await first
  })

  it('treats windows separators as the worktrees marker', async () => {
    const d = deps()
    configureWorktreeSweeper(d)
    const swept = await sweepAbandonedWorktrees({
      workspaces: [ws({ path: `${PRIMARY}\\.dsh\\worktrees\\swift-01`, sessionIds: ['blank-1'] })],
      sessionsById: blankStore(['blank-1']),
      currentSessionId: 'other',
      creating: false,
    })
    expect(swept).toEqual(['swift-01'])
    expect(d.removeWorktree).toHaveBeenCalledWith({ cwd: PRIMARY, slug: 'swift-01' })
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
