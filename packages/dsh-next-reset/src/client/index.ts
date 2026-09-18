/**
 * Browser-half entry for the reset plugin — runs inside the dsh web GUI.
 *
 * No visible UI. Watches the current session event window and, on a live
 * `reset/handoff`, opens the new session then archives the old one.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  watchResetHandoff,
  type SessionsLike,
  type WorkspacesLike,
} from './handoff.ts'

export const inject = ['sessions', 'workspaces'] as const

/** The workspace-navigation face that shows an existing session. */
interface UiWorkspaceLike {
  openSession(sessionId: string): void
}

/** The pre-0.1.6 session face, kept as a fallback for older hosts. */
interface LegacySessionsLike {
  open?(sessionId: string): void
}

/** Show an existing session; the entry turns "not available" into the port's boolean. */
export type SessionOpener = (sessionId: string) => void

/**
 * Resolve how to show the session the reset created.
 *
 * The live client navigates through `uiWorkspace.openSession`; `sessions.open`
 * was removed from the session service, so it is only a fallback for older
 * hosts. Undefined means this host cannot navigate.
 *
 * @param ctx - the client context.
 * @returns the navigation call, or undefined.
 */
export function makeSessionOpener(ctx: Context): SessionOpener | undefined {
  const navigation = getNamed(ctx, 'uiWorkspace') as UiWorkspaceLike | undefined
  if (navigation !== undefined && typeof navigation.openSession === 'function') {
    return (sessionId: string) => navigation.openSession(sessionId)
  }
  const legacy = getNamed(ctx, 'sessions') as LegacySessionsLike | undefined
  if (legacy !== undefined && typeof legacy.open === 'function') {
    return (sessionId: string) => legacy.open?.(sessionId)
  }
  return undefined
}

function getNamed(ctx: Context, name: string): unknown {
  return (ctx.get as (key: string) => unknown).call(ctx, name)
}

/** Apply the browser half. */
export function apply(ctx: Context): void {
  const sessions = getNamed(ctx, 'sessions') as SessionsLike | undefined
  const workspaces = getNamed(ctx, 'workspaces') as WorkspacesLike | undefined
  if (sessions === undefined || workspaces === undefined) return
  ctx.effect(
    () =>
      watchResetHandoff(sessions, workspaces, (sessionId) => {
        const navigate = makeSessionOpener(ctx)
        if (navigate === undefined) return false
        navigate(sessionId)
        return true
      }),
    'dsh-next-reset: handoff',
  )
}
