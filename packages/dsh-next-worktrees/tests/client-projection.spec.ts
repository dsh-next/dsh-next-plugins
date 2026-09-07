import { describe, expect, it } from 'vitest'
import {
  decorateSessions,
  ensureSettingUpSession,
  overlaySettingUp,
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
    const worktree = wt({ sessionIds: ['s1'], status: { clean: false, dirty: true, ahead: 2, merged: false, conflict: false } })
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
      primaryBranch: 'main',
      path: worktree.path,
      workspaceId: 'wt-ws',
      sessionIds: ['s1'],
      dirty: true,
      ahead: 2,
      merged: false,
      conflict: false,
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

  it('hides worktree workspaces by path marker even before topology lists them', () => {
    // Structural rule: any workspace under /.dsh/worktrees/ is ours. It
    // must never flash as (or linger as) a separate workspace folder
    // while the topology pull has not caught up.
    const fresh = ws({ workspaceId: 'fresh-wt', path: `${REPO}/.dsh/worktrees/new-01`, sessionIds: ['fresh-s'] })
    const result = projectWorkspaceSidebar({
      workspaces: [ws(), fresh],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [] }]),
    })
    expect(result.hiddenWorkspaceIds).toEqual(new Set(['fresh-wt']))
    expect(result.workspaces).toHaveLength(1)
    expect(result.workspaces[0]!.sessionIds).toContain('fresh-s')
    // No topology facts yet: the row is nested but undecorated.
    expect(result.decorations.size).toBe(0)
  })

  it('carries the workspace id and sessions for delete cleanup', () => {
    const worktree = wt({ sessionIds: ['s1', 's2'] })
    const result = projectWorkspaceSidebar({
      workspaces: [ws(), ws({ workspaceId: 'wt-ws', path: worktree.path, sessionIds: ['s1', 's2'] })],
      sessionsById: {},
      topology: topology([{ primary: REPO, ok: true, worktrees: [worktree] }]),
    })
    expect(result.decorations.get('s2')).toMatchObject({ workspaceId: 'wt-ws', sessionIds: ['s1', 's2'] })
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
    expect(result.hiddenWorkspaceIds).toEqual(new Set(['wt-ws']))
    expect(result.workspaces[0]!.sessionIds).toContain('s1')
    expect(result.decorations.get('s1')).toMatchObject({
      slug: 'swift-01',
      path: worktree.path,
      workspaceId: 'wt-ws',
    })
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
      primaryBranch: 'main',
      path: 'p',
      workspaceId: 'wt-ws',
      sessionIds: ['s1'],
      dirty: false,
      ahead: 0,
      merged: false,
      conflict: false,
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

  it('injects a stub summary for a setting-up session the store has not caught', () => {
    const decoration = {
      kind: 'dsh-next-worktrees' as const,
      slug: 'swift-01',
      title: 'swift-01',
      branch: 'dsh-worktrees/swift-01',
      baseRef: '',
      primaryBranch: '',
      path: `${REPO}/.dsh/worktrees/swift-01`,
      workspaceId: 'wt-ws',
      sessionIds: ['s-new'],
      dirty: false,
      ahead: 0,
      merged: false,
      conflict: false,
      settingUp: true,
    }
    const decorated = decorateSessions({ s1: { id: 's1' } }, new Map([['s-new', decoration]]))
    expect(decorated['s-new']).toMatchObject({ id: 's-new', __dshNextWorktrees: decoration })
  })
})

describe('overlaySettingUp', () => {
  const existing = {
    kind: 'dsh-next-worktrees' as const,
    slug: 'swift-01',
    title: 'login race fix',
    branch: 'dsh-worktrees/swift-01',
    baseRef: 'origin/HEAD',
    primaryBranch: 'main',
    path: `${REPO}/.dsh/worktrees/swift-01`,
    workspaceId: 'wt-ws',
    sessionIds: ['s1'],
    dirty: false,
    ahead: 0,
    merged: false,
    conflict: false,
  }

  it('is a no-op when setup is not running', () => {
    const decorations = new Map([['s1', existing]])
    expect(overlaySettingUp(decorations, undefined)).toBe(decorations)
  })

  it('flags an existing decoration as settingUp', () => {
    const decorations = new Map([['s1', existing]])
    const next = overlaySettingUp(decorations, {
      slug: 'swift-01',
      sessionId: 's1',
      workspaceId: 'wt-ws',
      path: existing.path,
    })
    expect(next.get('s1')).toEqual({ ...existing, settingUp: true })
    expect(decorations.get('s1')).toEqual(existing)
  })

  it('flags every decoration that shares the setup slug', () => {
    const other = { ...existing, sessionIds: ['s2'] as const }
    const decorations = new Map([['s-other', other]])
    const next = overlaySettingUp(decorations, {
      slug: 'swift-01',
      sessionId: 's1',
      workspaceId: 'wt-ws',
      path: existing.path,
    })
    expect(next.get('s-other')?.settingUp).toBe(true)
    expect(next.get('s1')?.settingUp).toBe(true)
  })

  it('synthesizes a decoration when topology has not caught up', () => {
    const next = overlaySettingUp(new Map(), {
      slug: 'swift-01',
      sessionId: 's1',
      workspaceId: 'wt-ws',
      path: `${REPO}/.dsh/worktrees/swift-01`,
    })
    expect(next.get('s1')).toMatchObject({
      kind: 'dsh-next-worktrees',
      slug: 'swift-01',
      workspaceId: 'wt-ws',
      settingUp: true,
      ahead: 0,
    })
    expect(next.get('s1')?.sessionIds).toEqual(['s1'])
  })
})

describe('ensureSettingUpSession', () => {
  it('appends the in-flight session onto the repo group', () => {
    const next = ensureSettingUpSession(
      [ws(), ws({ workspaceId: 'wt-ws', path: `${REPO}/.dsh/worktrees/swift-01`, sessionIds: [] })],
      {
        slug: 'swift-01',
        sessionId: 's1',
        workspaceId: 'wt-ws',
        path: `${REPO}/.dsh/worktrees/swift-01`,
      },
    )
    expect(next[0]!.sessionIds).toContain('s1')
    expect(next[0]!.sessionIds).toContain('repo-session')
  })

  it('is a no-op when setup is not running', () => {
    const workspaces = [ws()]
    expect(ensureSettingUpSession(workspaces, undefined)).toBe(workspaces)
  })
})
