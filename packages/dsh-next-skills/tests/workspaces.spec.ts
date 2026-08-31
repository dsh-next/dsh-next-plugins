import { describe, expect, it } from 'vitest'
import { extractWorkspaces } from '../src/client/workspaces.ts'

function ws(items: unknown): never {
  return { list: { getSnapshot: () => ({ items }) } } as never
}

describe('extractWorkspaces', () => {
  it('maps workspace views to { id, title, path } rows', () => {
    const rows = extractWorkspaces(ws([
      { workspaceId: 'id1', path: '/a', title: 'Alpha' },
      { workspaceId: 2, path: '/b', title: '' },
    ]))
    expect(rows).toEqual([
      { id: 'id1', title: 'Alpha', path: '/a' },
      { id: '2', title: '/b', path: '/b' },
    ])
  })
  it('falls back to the path as title and id', () => {
    expect(extractWorkspaces(ws([{ path: '/ok' }]))).toEqual([{ id: '/ok', title: '/ok', path: '/ok' }])
  })
  it('drops entries without a path', () => {
    expect(extractWorkspaces(ws([{ workspaceId: 'x', title: 'No path' }, { path: '/ok' }]))).toEqual([{ id: '/ok', title: '/ok', path: '/ok' }])
  })
  it('returns [] when the workspaces service or list is absent', () => {
    expect(extractWorkspaces(undefined)).toEqual([])
    expect(extractWorkspaces({} as never)).toEqual([])
    expect(extractWorkspaces({ list: undefined } as never)).toEqual([])
  })
  it('returns [] when getSnapshot throws', () => {
    expect(extractWorkspaces({ list: { getSnapshot: () => { throw new Error('x') } } } as never)).toEqual([])
  })
})
