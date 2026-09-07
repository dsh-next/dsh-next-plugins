import { describe, expect, it, vi } from 'vitest'
import { attachForkToWorkspace } from '../src/host/workspace.ts'

describe('attachForkToWorkspace', () => {
  it('attaches the child to the workspace that already accounts the parent', async () => {
    const attachSession = vi.fn().mockResolvedValue(undefined)
    await attachForkToWorkspace({
      list: () => [
        { sessionIds: ['other'], attachSession: vi.fn() },
        { sessionIds: ['parent', 'sibling'], attachSession },
      ],
    }, 'parent', 'child')
    expect(attachSession).toHaveBeenCalledWith('child')
  })

  it('is a no-op when the registry is absent or the parent is ungrouped', async () => {
    await attachForkToWorkspace(undefined, 'parent', 'child')
    const attachSession = vi.fn()
    await attachForkToWorkspace({
      list: () => [{ sessionIds: ['other'], attachSession }],
    }, 'parent', 'child')
    expect(attachSession).not.toHaveBeenCalled()
  })
})
