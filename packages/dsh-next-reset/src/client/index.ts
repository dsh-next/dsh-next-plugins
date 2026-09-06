/**
 * Browser-half entry for the reset plugin — runs inside the dsh web GUI.
 *
 * No visible UI. Watches the current session event window and, on a live
 * `reset/handoff`, opens the new session then archives the old one.
 */
import type { Context } from '@deepseek-ai/cordis'
import { watchResetHandoff, type SessionsLike, type WorkspacesLike } from './handoff.ts'

export const inject = ['sessions', 'workspaces'] as const

function getNamed(ctx: Context, name: string): unknown {
  return (ctx.get as (key: string) => unknown).call(ctx, name)
}

/** Apply the browser half. */
export function apply(ctx: Context): void {
  const sessions = getNamed(ctx, 'sessions') as SessionsLike | undefined
  const workspaces = getNamed(ctx, 'workspaces') as WorkspacesLike | undefined
  if (sessions === undefined || workspaces === undefined) return
  ctx.effect(() => watchResetHandoff(sessions, workspaces), 'dsh-next-reset: handoff')
}
