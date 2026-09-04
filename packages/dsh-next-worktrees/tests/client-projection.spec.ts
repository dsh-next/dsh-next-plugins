import { describe, expect, it } from 'vitest'
import {
  decorateSessions,
  projectWorkspaceSidebar,
  type WorkspaceItemLike,
} from '../src/client/projection.ts'
import type { WorktreeTopology } from '../src/client/rpc.ts'

const REPO = '/repos/wt-repo'

function topology(repos: WorktreeTopology['repos']): WorktreeTopology {
  return { repos, workspaces: [] }
}

function wt(overrides: Partial<WorktreeTopology['repos'][number]['worktrees'][number]> = {}) {
  return {
    slug: 'swift-01',
    title: 'login race fix',
    path: `${REPO}/.dsh/worktrees/swift-01`,
    branch: 'dsh-worktrees/swift-01',
    baseRef: 'origin/HEAD',
    status: { clean: true, dirty: false, ahead: 0, merged: false },
    sessionIds: [],
    ...overrides,
  }
}

function ws(overrides: Partial<WorkspaceItemLike> = {}): WorkspaceItemLike {
  return {
    workspaceId: 'repo-ws',
    path: REPO,
    sessionIds: ['repo-session'],
    ...overrides,
  }
}

describe('projectWorkspaceSidebar', () => {
  it('is the identity when the topology has no worktrees', () => {
    const workspaces = [ws(), ws({ workspaceId: 'plain-ws', path: '/repos/plain' })]
    const result = projectWorkspaceSidebar({
      workspaces,
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [] }]),
    })
    expect(result.workspaces).toEqual(workspaces)
    expect(result.decorations.size).toBe(0)
    expect(result.hiddenWorkspaceIds.size).toBe(0)
  })

  it('hides the worktree workspace and re-parents its sessions under the repo', () => {
    const worktree = wt({ sessionIds: ['wt-session-1'] })
    const result = projectWorkspaceSidebar({
      workspaces: [
        ws(),
        ws({ workspaceId: 'wt-ws', path: worktree.path, sessionIds: ['wt-session-1'] }),
      ],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    expect(result.hiddenWorkspaceIds).toEqual(new Set(['wt-ws']))
    expect(result.workspaces).toHaveLength(1)
    expect(result.workspaces[0]!.workspaceId).toBe('repo-ws')
    expect(result.workspaces[0]!.sessionIds).toContain('wt-session-1')
    expect(result.workspaces[0]!.sessionIds).toContain('repo-session')
  })

  it('decorates every re-parented session with worktree facts', () => {
    const worktree = wt({ sessionIds: ['s1'], status: { clean: false, dirty: true, ahead: 2, merged: false } })
    const result = projectWorkspaceSidebar({
      workspaces: [ws(), ws({ workspaceId: 'wt-ws', path: worktree.path, sessionIds: ['s1'] })],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    expect(result.decorations.get('s1')).toEqual({
      kind: 'dsh-next-worktrees',
      slug: 'swift-01',
      title: 'login race fix',
      branch: 'dsh-worktrees/swift-01',
      baseRef: 'origin/HEAD',
      path: worktree.path,
      dirty: true,
      ahead: 2,
      merged: false,
    })
  })

  it('merges two worktrees of one repo under the same group', () => {
    const one = wt({ sessionIds: ['s1'] })
    const two = wt({
      slug: 'amber-02',
      title: 'amber 02',
      path: `${REPO}/.dsh/worktrees/amber-02`,
      branch: 'dsh-worktrees/amber-02',
      sessionIds: ['s2'],
    })
    const result = projectWorkspaceSidebar({
      workspaces: [
        ws(),
        ws({ workspaceId: 'wt-1', path: one.path, sessionIds: ['s1'] }),
        ws({ workspaceId: 'wt-2', path: two.path, sessionIds: ['s2'] }),
      ],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [one, two] }]),
    })
    expect(result.workspaces).toHaveLength(1)
    expect(result.workspaces[0]!.sessionIds).toEqual(expect.arrayContaining(['repo-session', 's1', 's2']))
    expect([...result.hiddenWorkspaceIds]).toEqual(['wt-1', 'wt-2'])
  })

  it('keeps the worktree group when no repo workspace exists', () => {
    const worktree = wt({ sessionIds: ['s1'] })
    const result = projectWorkspaceSidebar({
      workspaces: [ws({ workspaceId: 'wt-ws', path: worktree.path, sessionIds: ['s1'] })],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    // Sessions must never vanish: without a repo group, the worktree group
    // stays as an ordinary workspace row.
    expect(result.workspaces).toHaveLength(1)
    expect(result.workspaces[0]!.workspaceId).toBe('wt-ws')
    expect(result.hiddenWorkspaceIds.size).toBe(0)
    expect(result.decorations.size).toBe(0)
  })

  it('ignores workspaces whose path matches no topology worktree', () => {
    const other = ws({ workspaceId: 'stranger', path: `${REPO}/.dsh/worktrees/unknown-09` })
    const result = projectWorkspaceSidebar({
      workspaces: [ws(), other],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [wt()] }]),
    })
    expect(result.workspaces).toHaveLength(2)
    expect(result.hiddenWorkspaceIds.size).toBe(0)
  })

  it('never duplicates a session already in the repo group', () => {
    const worktree = wt({ sessionIds: ['shared'] })
    const result = projectWorkspaceSidebar({
      workspaces: [
        ws({ sessionIds: ['shared'] }),
        ws({ workspaceId: 'wt-ws', path: worktree.path, sessionIds: ['shared'] }),
      ],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    expect(result.workspaces[0]!.sessionIds.filter((id) => id === 'shared')).toHaveLength(1)
  })
})

describe('decorateSessions', () => {
  it('adds the metadata field to decorated summaries only', () => {
    const decoration = {
      kind: 'dsh-next-worktrees',
      slug: 'swift-01',
      title: 't',
      branch: 'b',
      baseRef: 'r',
      path: 'p',
      dirty: false,
      ahead: 0,
      merged: false,
    } as const
    const byId = {
      s1: { id: 's1' },
      s2: { id: 's2' },
    }
    const decorated = decorateSessions(byId, new Map([['s1', decoration]]))
    expect(decorated.s1).toMatchObject({ id: 's1', __dshNextWorktrees: decoration })
    expect(decorated.s2).toEqual({ id: 's2' })
    // The input map stays untouched.
    expect(byId.s1).toEqual({ id: 's1' })
  })

  it('returns the same map when nothing is decorated', () => {
    const byId = { s1: { id: 's1' } }
    expect(decorateSessions(byId, new Map())).toBe(byId)
  })
})
