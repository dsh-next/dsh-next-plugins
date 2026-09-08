import { describe, expect, it } from 'vitest'
import { harborBasename, isWorktreeWorkspacePath } from '../src/core/path.ts'
import { extractWorkspaces } from '../src/client/workspaces.ts'

function ws(items: unknown): never {
  return { list: { getSnapshot: () => ({ items }) } } as never
}

describe('harborBasename', () => {
  it('is the path basename for an ordinary workspace', () => {
    expect(harborBasename('/Users/x/Projects/dsh-next-plugins')).toBe('dsh-next-plugins')
  })
  it('maps a worktree cwd to the harbor basename', () => {
    expect(harborBasename('/Users/x/Projects/dsh-next-plugins/.dsh/worktrees/willow-01')).toBe('dsh-next-plugins')
    expect(isWorktreeWorkspacePath('/Users/x/Projects/dsh-next-plugins/.dsh/worktrees/willow-01')).toBe(true)
  })
})

describe('extractWorkspaces', () => {
  it('hides plugin worktree workspaces from the checklist', () => {
    expect(extractWorkspaces(ws([
      { workspaceId: 'harbor', path: '/Users/x/Projects/web', title: 'web' },
      { workspaceId: 'wt', path: '/Users/x/Projects/web/.dsh/worktrees/willow-01', title: 'auth-refresh' },
    ]))).toEqual([
      { id: 'harbor', title: 'web', path: '/Users/x/Projects/web' },
    ])
  })
})
