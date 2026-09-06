import type {} from '@deepseek-ai/dsh-session/types'

/**
 * The reincarnation handshake: a log-only event on the old session naming
 * the blank replacement. The web client watches the current session's
 * event window and switches on a live append of this type.
 *
 * DSH 0.1.2-rc.1 `Session.append` cannot set `ignorable: true`. The host
 * registers the type in `KNOWN_SESSION_EVENT_TYPES` so this build can
 * resume an archived log that carries the event. Older harnesses without
 * the plugin still refuse that log — there is no unarchive UI in 0.1.
 */
export const RESET_HANDOFF = 'reset/handoff'

/** Cordis service key the worktrees plugin provides (duplicated, no import). */
export const WORKTREES_SERVICE_KEY = 'dsh-next-worktrees'

export interface ResetHandoffData {
  readonly nextSessionId: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'reset/handoff': ResetHandoffData
  }
}

/** Pull `nextSessionId` off a live or replayed event, or undefined. */
export function handoffNextId(event: {
  readonly type: string
  readonly data?: unknown
}): string | undefined {
  if (event.type !== RESET_HANDOFF) return undefined
  const data = event.data
  if (data === null || typeof data !== 'object') return undefined
  const id = (data as { nextSessionId?: unknown }).nextSessionId
  return typeof id === 'string' && id !== '' ? id : undefined
}
