import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

/** Remove only the deleted checkout's registration; the SDK retains sessions and files. */
export function makeWorktreeUnregister(ctx: Context): ((path: string) => Promise<void>) | undefined {
  if (ctx.get('workspaces') === undefined) return undefined
  return async (path: string): Promise<void> => {
    const workspaces = ctx.get('workspaces')
    if (workspaces === undefined) throw new Error('workspace service is unavailable')
    const snapshot = workspaces.list.getSnapshot()
    if (snapshot.phase !== 'ready' || snapshot.state === 'error') throw new Error('workspace registry is unavailable')
    for (const workspace of snapshot.items.filter(item => item.path === path)) {
      await workspaces.delete(workspace.workspaceId)
    }
  }
}

/** Register the folder, then create a genuinely new session in that checkout. */
export function makeWorktreeOpener(ctx: Context): ((path: string) => Promise<void>) | undefined {
  const workspaces = ctx.get('workspaces')
  const sessions = ctx.get('sessions')
  const navigation = ctx.get('uiWorkspace')
  if (workspaces === undefined || sessions === undefined || navigation === undefined) return undefined
  return async (path: string): Promise<void> => {
    const workspaces = ctx.get('workspaces'), sessions = ctx.get('sessions'), navigation = ctx.get('uiWorkspace')
    if (workspaces === undefined || sessions === undefined || navigation === undefined) throw new Error('workspace navigation is unavailable')
    const workspace = await workspaces.create({ path })
    const sessionId = await sessions.create({ workspaceId: workspace.workspaceId })
    navigation.openSession(sessionId)
  }
}
