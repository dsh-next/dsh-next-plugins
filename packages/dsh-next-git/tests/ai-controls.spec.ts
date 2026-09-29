import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { describe, expect, it, vi } from 'vitest'
import { createGitAgentControls } from '../src/client/ai/controls.ts'

function context(services: Record<string, unknown>): { ctx: Context; dispose(): void } {
  const cleanups: (() => void)[] = []
  return {
    ctx: {
      get: (key: string) => services[key],
      effect: (run: () => unknown) => { const cleanup = run(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => void) },
    } as unknown as Context,
    dispose: () => { for (const cleanup of cleanups) cleanup() },
  }
}

describe('git agent controls owner', () => {
  it('omits controls when session navigation dependencies are missing', () => {
    const missing = context({})
    expect(createGitAgentControls(missing.ctx)('s1' as SessionId)).toBeUndefined()
    missing.dispose()
  })

  it('reuses controls per source and results per checkout, then disposes with the plugin', () => {
    const openSession = vi.fn()
    const sessions = { list: { getSnapshot: () => ({ byId: {} }) } }
    const owner = context({ sessions, workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, uiWorkspace: { openSession } })
    const controlsFor = createGitAgentControls(owner.ctx)
    const first = controlsFor('s1' as SessionId)!
    expect(controlsFor('s1' as SessionId)).toBe(first)
    expect(controlsFor('s2' as SessionId)).not.toBe(first)
    expect(first.getSource()).toBeUndefined()
    first.openSession!('target' as SessionId)
    expect(openSession).toHaveBeenCalledExactlyOnceWith('target')
    const results = first.taskResults!('/ai-controls-root')
    expect(first.taskResults!('/ai-controls-root')).toBe(results)
    expect(first.taskResults!('/ai-controls-other-root')).not.toBe(results)
    owner.dispose()
    expect(() => results.admit({ accepted: true, sourceSessionId: 's1' as SessionId,
      targetSessionId: 'target' as SessionId, requestId: 'request-1' as SessionRequestId,
      verb: 'review', root: '/ai-controls-root', cwd: '/ai-controls-root', fingerprint: 'v1' })).toThrow('task-results-disposed')
  })
})
