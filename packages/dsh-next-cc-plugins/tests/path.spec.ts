import { describe, expect, it } from 'vitest'
import { extractWorkspaces } from '../src/client/workspaces.ts'

function ws(items: unknown): never {
  return { list: { getSnapshot: () => ({ items }) } } as never
}

describe('extractWorkspaces', () => {
  it('normalizes every workspace row and falls back to the path as title', () => {
    expect(extractWorkspaces(ws([
      { workspaceId: 'web', path: '/Users/x/Projects/web', title: 'web' },
      { workspaceId: 'api', path: '/Users/x/Projects/api' },
    ]))).toEqual([
      { id: 'web', title: 'web', path: '/Users/x/Projects/web' },
      { id: 'api', title: '/Users/x/Projects/api', path: '/Users/x/Projects/api' },
    ])
  })

  it('drops rows without a usable path', () => {
    expect(extractWorkspaces(ws([
      { workspaceId: 'missing' },
      { workspaceId: 'empty', path: '' },
    ]))).toEqual([])
  })
})
