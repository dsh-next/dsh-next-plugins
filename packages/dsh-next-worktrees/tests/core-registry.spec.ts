import { describe, expect, it } from 'vitest'
import {
  bindingTitle,
  parseWorktreeList,
  reconcile,
  rowForCwd,
  rowForSession,
  rowsForSlug,
  slugIsUnclaimed,
  type WorktreeBinding,
} from '../src/core/registry.ts'

function row(overrides: Partial<WorktreeBinding> = {}): WorktreeBinding {
  return {
    sessionId: '',
    slug: 'swift-01',
    name: 'login race fix',
    path: '/repos/wt-repo/.dsh/worktrees/swift-01',
    branch: 'dsh-worktrees/swift-01',
    baseRef: 'origin/main',
    relPath: '',
    role: 'owner',
    createdAt: 1,
    ...overrides,
  }
}

describe('parseWorktreeList', () => {
  it('parses entries with branches and heads', () => {
    const stdout = [
      'worktree /repos/wt-repo',
      'HEAD 111111',
      'branch refs/heads/main',
      '',
      'worktree /repos/wt-repo/.dsh/worktrees/swift-01',
      'HEAD 222222',
      'branch refs/heads/dsh-worktrees/swift-01',
      '',
    ].join('\n')
    expect(parseWorktreeList(stdout)).toEqual([
      { path: '/repos/wt-repo', head: '111111', branch: 'main' },
      {
        path: '/repos/wt-repo/.dsh/worktrees/swift-01',
        head: '222222',
        branch: 'dsh-worktrees/swift-01',
      },
    ])
  })

  it('tolerates detached entries without a branch', () => {
    expect(parseWorktreeList('worktree /detached\nHEAD abc\n')).toEqual([
      { path: '/detached', head: 'abc' },
    ])
  })

  it('returns empty for empty output', () => {
    expect(parseWorktreeList('')).toEqual([])
  })
})

describe('reconcile', () => {
  it('keeps rows whose worktree is live', () => {
    const kept = row()
    const { kept: keptRows, dropped } = reconcile([kept], [
      { path: kept.path },
      { path: '/repos/wt-repo' },
    ])
    expect(keptRows).toHaveLength(1)
    expect(dropped).toEqual([])
  })

  it('drops rows whose worktree vanished', () => {
    const stale = row({ slug: 'gone-01', path: '/repos/wt-repo/.dsh/worktrees/gone-01' })
    const { kept: keptRows, dropped } = reconcile([stale, row()], [
      { path: '/repos/wt-repo' },
      { path: row().path },
    ])
    expect(keptRows.map((b) => b.slug)).toEqual(['swift-01'])
    expect(dropped.map((b) => b.slug)).toEqual(['gone-01'])
  })
})

describe('row lookups', () => {
  const claimed = row({ sessionId: 'session-a' })
  const free = row({ sessionId: '', slug: 'amber-02', path: '/repos/wt-repo/.dsh/worktrees/amber-02' })
  const bindings = [claimed, free]

  it('rowsForSlug filters by slug', () => {
    expect(rowsForSlug(bindings, 'amber-02')).toEqual([free])
    expect(rowsForSlug(bindings, 'nope-99')).toEqual([])
  })

  it('rowForSession matches the claiming session', () => {
    expect(rowForSession(bindings, 'session-a')).toBe(claimed)
    expect(rowForSession(bindings, 'session-b')).toBeUndefined()
  })

  it('rowForCwd matches inside the worktree path', () => {
    expect(rowForCwd(bindings, 'session-b', `${claimed.path}/packages/foo`)).toBeUndefined()
    expect(rowForCwd(bindings, 'session-a', `${claimed.path}/packages/foo`)).toBe(claimed)
  })

  it('rowForCwd lets a session take over only an unclaimed row', () => {
    expect(rowForCwd(bindings, 'session-b', free.path)).toBe(free)
    expect(rowForCwd(bindings, 'session-b', claimed.path)).toBeUndefined()
  })

  it('rowForCwd returns undefined outside every worktree', () => {
    expect(rowForCwd(bindings, 'session-a', '/repos/wt-plain')).toBeUndefined()
  })

  it('slugIsUnclaimed requires every row free', () => {
    expect(slugIsUnclaimed(bindings, 'amber-02')).toBe(true)
    expect(slugIsUnclaimed(bindings, 'swift-01')).toBe(false)
  })
})

describe('bindingTitle', () => {
  it('shows the name when present', () => {
    expect(bindingTitle(row())).toBe('login race fix')
  })

  it('falls back to the slug', () => {
    expect(bindingTitle(row({ name: '' }))).toBe('swift-01')
  })
})
