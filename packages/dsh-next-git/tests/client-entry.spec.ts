import { describe, expect, it, vi } from 'vitest'
import { makeWorktreeOpener } from '../src/client/index.ts'

/**
 * Browser-entry wiring: the worktree session opener resolves the workspace
 * navigation services through the context, so the panel can offer "open a
 * session in this folder" without depending on a host that may not have them.
 */

function contextWith(services: Record<string, unknown>): Parameters<typeof makeWorktreeOpener>[0] {
  return { get: (key: string) => services[key] } as unknown as Parameters<typeof makeWorktreeOpener>[0]
}

describe('worktree session opener', () => {
  it('registers the folder as a workspace and opens a session in it', async () => {
    const create = vi.fn(async (input: { path: string }) => ({ workspaceId: 'ws-1', path: input.path }))
    const openWorkspace = vi.fn(async () => {})
    const opener = makeWorktreeOpener(contextWith({ workspaces: { create }, uiWorkspace: { openWorkspace } }))
    expect(opener).toBeDefined()
    await opener?.('/repo/.worktrees/feature')
    expect(create).toHaveBeenCalledWith({ path: '/repo/.worktrees/feature' })
    expect(openWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('is absent when the host cannot navigate workspaces', () => {
    expect(makeWorktreeOpener(contextWith({}))).toBeUndefined()
    expect(makeWorktreeOpener(contextWith({ workspaces: { create: async () => ({ workspaceId: 'a' }) } })))
      .toBeUndefined()
    expect(makeWorktreeOpener(contextWith({ uiWorkspace: { openWorkspace: async () => {} } })))
      .toBeUndefined()
  })

  it('fails loudly when a service disappears after the check', async () => {
    const services: Record<string, unknown> = {
      workspaces: { create: async () => ({ workspaceId: 'a' }) },
      uiWorkspace: { openWorkspace: async () => {} },
    }
    const opener = makeWorktreeOpener(contextWith(services))
    delete services.workspaces
    await expect(opener?.('/repo/.worktrees/feature')).rejects.toThrow('workspace navigation is unavailable')
  })
})
