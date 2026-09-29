import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentSessionControls } from './action-dialog.tsx'
import { createSessionBridge } from './session-bridge.ts'
import { createAiTaskResults, type AiTaskResults } from './task-results.ts'

/** Own session-bound agent controls and task results for one plugin lifetime. */
export function createGitAgentControls(ctx: Context): (sourceSessionId: SessionId) => AgentSessionControls | undefined {
  const sessions = ctx.get('sessions')
  const workspaces = ctx.get('workspaces')
  const uiWorkspace = ctx.get('uiWorkspace')
  const bridge = sessions !== undefined && workspaces !== undefined && uiWorkspace !== undefined
    ? createSessionBridge({ sessions, workspaces, uiWorkspace }) : undefined
  const controls = new Map<SessionId, AgentSessionControls>()
  const results = new Map<string, AiTaskResults>()
  ctx.effect(() => () => {
    for (const result of results.values()) result.dispose()
    results.clear()
    controls.clear()
  }, 'dsh-next-git: AI task results')

  return (sourceSessionId) => {
    if (bridge === undefined || sessions === undefined || uiWorkspace === undefined) return undefined
    const existing = controls.get(sourceSessionId)
    if (existing !== undefined) return existing
    const bound: AgentSessionControls = {
      getSource: () => bridge.getSource(sourceSessionId),
      createDelivery: input => bridge.createDelivery({ ...input, sourceSessionId }),
      subscribeRefresh: refresh => bridge.subscribeTurnEnd(sourceSessionId, refresh),
      openSession: target => uiWorkspace.openSession(target),
      taskResults: root => {
        const key = JSON.stringify([sourceSessionId, root])
        let value = results.get(key)
        if (value === undefined) {
          value = createAiTaskResults({ sessions, sourceSessionId, root })
          results.set(key, value)
        }
        return value
      },
    }
    controls.set(sourceSessionId, bound)
    return bound
  }
}
