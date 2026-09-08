import { describe, expect, it } from 'vitest'
import {
  decorateWorkspaces,
  nestWorktreeGroups,
  overlaySettingUp,
  projectWorkspaceSidebar,
  type GroupNodeLike,
  type WorkspaceItemLike,
  type WorktreeRowDecoration,
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
    primaryBranch: 'main',
    status: { clean: true, dirty: false, ahead: 0, merged: false, conflict: false },
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

function decoration(overrides: Partial<WorktreeRowDecoration> = {}): WorktreeRowDecoration {
  return {
    kind: 'dsh-next-worktrees',
    slug: 'swift-01',
    title: 'login race fix',
    branch: 'dsh-worktrees/swift-01',
    baseRef: 'origin/HEAD',
    primaryBranch: 'main',
    path: `${REPO}/.dsh/worktrees/swift-01`,
    workspaceId: 'wt-ws',
    harborWorkspaceId: 'repo-ws',
    sessionIds: ['s1'],
    dirty: false,
    ahead: 0,
    merged: false,
    conflict: false,
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
    expect(result.clusters.size).toBe(0)
    expect(result.nestedWorkspaceIds.size).toBe(0)
  })

  it('keeps the worktree workspace and decorates it as a cluster under the harbor', () => {
    const worktree = wt({ sessionIds: ['wt-session-1'] })
    const result = projectWorkspaceSidebar({
      workspaces: [
        ws(),
        ws({ workspaceId: 'wt-ws', path: worktree.path, sessionIds: ['wt-session-1'] }),
      ],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    expect(result.nestedWorkspaceIds).toEqual(new Set(['wt-ws']))
    expect(result.workspaces).toHaveLength(2)
    expect(result.workspaces.map((w) => w.workspaceId)).toEqual(['repo-ws', 'wt-ws'])
    expect(result.workspaces[1]!.sessionIds).toEqual(['wt-session-1'])
    expect(result.clusters.get('wt-ws')).toEqual({
      kind: 'dsh-next-worktrees',
      slug: 'swift-01',
      title: 'login race fix',
      branch: 'dsh-worktrees/swift-01',
      baseRef: 'origin/HEAD',
      primaryBranch: 'main',
      path: worktree.path,
      workspaceId: 'wt-ws',
      harborWorkspaceId: 'repo-ws',
      sessionIds: ['wt-session-1'],
      dirty: false,
      ahead: 0,
      merged: false,
      conflict: false,
    })
  })

  it('prefers the host workspace title over the topology title', () => {
    const worktree = wt()
    const result = projectWorkspaceSidebar({
      workspaces: [
        ws(),
        ws({
          workspaceId: 'wt-ws',
          path: worktree.path,
          sessionIds: ['s1'],
          title: 'auth-refresh',
        }),
      ],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    expect(result.clusters.get('wt-ws')?.title).toBe('auth-refresh')
  })

  it('decorates git status onto the cluster, not the sessions', () => {
    const worktree = wt({
      sessionIds: ['s1', 's2'],
      status: { clean: false, dirty: true, ahead: 2, merged: false, conflict: false },
    })
    const result = projectWorkspaceSidebar({
      workspaces: [
        ws(),
        ws({ workspaceId: 'wt-ws', path: worktree.path, sessionIds: ['s1', 's2'] }),
      ],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    expect(result.clusters.get('wt-ws')).toMatchObject({
      dirty: true,
      ahead: 2,
      sessionIds: ['s1', 's2'],
    })
  })

  it('nests two worktrees of one repo under the same harbor', () => {
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
    expect(result.workspaces).toHaveLength(3)
    expect(result.clusters.get('wt-1')?.harborWorkspaceId).toBe('repo-ws')
    expect(result.clusters.get('wt-2')?.harborWorkspaceId).toBe('repo-ws')
    expect([...result.nestedWorkspaceIds]).toEqual(['wt-1', 'wt-2'])
  })

  it('keeps the worktree group when no repo workspace exists', () => {
    const worktree = wt({ sessionIds: ['s1'] })
    const result = projectWorkspaceSidebar({
      workspaces: [ws({ workspaceId: 'wt-ws', path: worktree.path, sessionIds: ['s1'] })],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    expect(result.workspaces).toHaveLength(1)
    expect(result.workspaces[0]!.workspaceId).toBe('wt-ws')
    expect(result.nestedWorkspaceIds.size).toBe(0)
    expect(result.clusters.size).toBe(0)
  })

  it('clusters a worktree by path marker even before topology lists it', () => {
    const fresh = ws({
      workspaceId: 'fresh-wt',
      path: `${REPO}/.dsh/worktrees/new-01`,
      sessionIds: ['fresh-s'],
    })
    const result = projectWorkspaceSidebar({
      workspaces: [ws(), fresh],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [] }]),
    })
    expect(result.nestedWorkspaceIds).toEqual(new Set(['fresh-wt']))
    expect(result.clusters.get('fresh-wt')).toMatchObject({
      slug: 'new-01',
      harborWorkspaceId: 'repo-ws',
      dirty: false,
      ahead: 0,
    })
  })

  it('decorates a subdirectory workspace using the worktree root', () => {
    const worktree = wt({ sessionIds: ['s1'] })
    const result = projectWorkspaceSidebar({
      workspaces: [
        ws(),
        ws({
          workspaceId: 'wt-ws',
          path: `${worktree.path}/packages/foo`,
          sessionIds: ['s1'],
        }),
      ],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    expect(result.clusters.get('wt-ws')).toMatchObject({
      slug: 'swift-01',
      path: worktree.path,
      workspaceId: 'wt-ws',
      harborWorkspaceId: 'repo-ws',
    })
  })
})

describe('decorateWorkspaces', () => {
  it('adds the metadata field to clustered workspaces only', () => {
    const cluster = decoration()
    const items = [ws(), ws({ workspaceId: 'wt-ws', path: cluster.path, sessionIds: ['s1'] })]
    const decorated = decorateWorkspaces(items, new Map([['wt-ws', cluster]]))
    expect(decorated[0]).toEqual(items[0])
    expect(decorated[1]).toMatchObject({ workspaceId: 'wt-ws', __dshNextWorktrees: cluster })
    expect(items[1]).toEqual(ws({ workspaceId: 'wt-ws', path: cluster.path, sessionIds: ['s1'] }))
  })

  it('returns the same array when nothing is clustered', () => {
    const items = [ws()]
    expect(decorateWorkspaces(items, new Map())).toBe(items)
  })
})

describe('overlaySettingUp', () => {
  const existing = decoration()

  it('is a no-op when setup is not running', () => {
    const clusters = new Map([['wt-ws', existing]])
    expect(overlaySettingUp(clusters, undefined)).toBe(clusters)
  })

  it('flags an existing cluster as settingUp', () => {
    const clusters = new Map([['wt-ws', existing]])
    const next = overlaySettingUp(clusters, {
      slug: 'swift-01',
      sessionId: 's1',
      workspaceId: 'wt-ws',
      path: existing.path,
    })
    expect(next.get('wt-ws')).toEqual({ ...existing, settingUp: true })
    expect(clusters.get('wt-ws')).toEqual(existing)
  })

  it('flags every cluster that shares the setup slug', () => {
    const other = decoration({ workspaceId: 'other', sessionIds: ['s2'] })
    const clusters = new Map([['other', other]])
    const next = overlaySettingUp(clusters, {
      slug: 'swift-01',
      sessionId: 's1',
      workspaceId: 'wt-ws',
      path: existing.path,
    })
    expect(next.get('other')?.settingUp).toBe(true)
    expect(next.get('wt-ws')?.settingUp).toBe(true)
  })

  it('synthesizes a cluster when topology has not caught up', () => {
    const next = overlaySettingUp(new Map(), {
      slug: 'swift-01',
      sessionId: 's1',
      workspaceId: 'wt-ws',
      path: `${REPO}/.dsh/worktrees/swift-01`,
    })
    expect(next.get('wt-ws')).toMatchObject({
      kind: 'dsh-next-worktrees',
      slug: 'swift-01',
      workspaceId: 'wt-ws',
      settingUp: true,
      ahead: 0,
    })
    expect(next.get('wt-ws')?.sessionIds).toEqual(['s1'])
  })
})

describe('nestWorktreeGroups', () => {
  function group(overrides: Partial<GroupNodeLike> & Pick<GroupNodeLike, 'key'>): GroupNodeLike {
    return {
      workspaceId: overrides.workspaceId ?? overrides.key,
      containsCurrent: false,
      expanded: true,
      sessions: [],
      ...overrides,
    }
  }

  it('is the identity when no group is decorated', () => {
    const groups = [group({ key: 'repo-ws' }), group({ key: 'plain' })]
    expect(nestWorktreeGroups(groups)).toEqual(groups)
  })

  it('nests a decorated worktree group under its harbor', () => {
    const cluster = decoration()
    const groups = [
      group({ key: 'repo-ws', sessions: ['repo'] }),
      group({
        key: 'wt-ws',
        sessions: ['s1'],
        containsCurrent: true,
        __dshNextWorktrees: cluster,
      }),
    ]
    const nested = nestWorktreeGroups(groups)
    expect(nested).toHaveLength(1)
    expect(nested[0]!.key).toBe('repo-ws')
    expect(nested[0]!.containsCurrent).toBe(true)
    expect(nested[0]!.children).toHaveLength(1)
    expect(nested[0]!.children![0]!.key).toBe('wt-ws')
    expect(nested[0]!.children![0]!.sessions).toEqual(['s1'])
  })

  it('leaves a decorated group top-level when its harbor is missing', () => {
    const groups = [group({
      key: 'wt-ws',
      __dshNextWorktrees: decoration({ harborWorkspaceId: 'gone' }),
    })]
    expect(nestWorktreeGroups(groups)).toEqual(groups)
  })

  it('nests several clusters in host order under one harbor', () => {
    const groups = [
      group({ key: 'repo-ws' }),
      group({ key: 'wt-1', __dshNextWorktrees: decoration({ workspaceId: 'wt-1' }) }),
      group({
        key: 'wt-2',
        __dshNextWorktrees: decoration({
          workspaceId: 'wt-2',
          slug: 'amber-02',
        }),
      }),
    ]
    const nested = nestWorktreeGroups(groups)
    expect(nested[0]!.children?.map((child) => child.key)).toEqual(['wt-1', 'wt-2'])
  })

  it('does not mark the harbor current when no nested cluster is', () => {
    const groups = [
      group({ key: 'repo-ws', containsCurrent: false }),
      group({
        key: 'wt-ws',
        containsCurrent: false,
        __dshNextWorktrees: decoration(),
      }),
    ]
    expect(nestWorktreeGroups(groups)[0]!.containsCurrent).toBe(false)
  })
})
