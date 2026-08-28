/**
 * Browser web-notification drainer: polls the Host queue and renders web
 * notifications with an in-page click-to-open handler. No OS banners.
 */
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { TimerLike } from '../core/timer.ts'
import { DEEPSEEK_ICON } from './deepseek-icon.ts'

interface PendingEvent {
  id?: number
  kind?: string
  title?: string
  body?: string
  sessionId?: string | null
  at?: number
}

/**
 * Emoji glyph per notification kind, used as the title's leading icon. Kept as
 * unicode escapes so the source file stays ASCII (repository convention) while
 * the browser renders the actual emoji.
 */
const KIND_EMOJI: Record<string, string> = {
  finished: '\u2705',
  approval: '\u26a0\ufe0f',
  question: '\u2753',
  subagent: '\ud83d\udc65',
  'goal-complete': '\ud83c\udfc6',
  'goal-blocked': '\ud83d\udeab',
}
const DEFAULT_EMOJI = '\ud83d\udd14'

/**
 * The notification headline: an emoji icon for the kind plus the type (the
 * Host-supplied `title`, e.g. "Approval needed"). The session title moves to
 * the body.
 */
function notificationTitle(event: PendingEvent): string {
  const base = typeof event.title === 'string' && event.title.length > 0 ? event.title : 'DeepSeek Harness'
  const emoji = (typeof event.kind === 'string' && KIND_EMOJI[event.kind]) || DEFAULT_EMOJI
  return emoji + ' ' + base
}

/**
 * The notification body: the session's display title so a glance says which
 * session, falling back to the Host-supplied detail when the session is unknown.
 */
function notificationBody(event: PendingEvent, sessions: ISessions | undefined): string {
  const sessionTitle = sessionTitleOf(sessions, event.sessionId)
  if (sessionTitle) return sessionTitle
  return typeof event.body === 'string' ? event.body : ''
}

/** Resolve a session's display title from the session list, safely. */
function sessionTitleOf(sessions: ISessions | undefined, sessionId: string | null | undefined): string {
  if (!sessions || typeof sessionId !== 'string' || sessionId.length === 0) return ''
  try {
    const snap = sessions.list?.getSnapshot?.()
    const row = (snap?.byId as Record<string, { displayTitle?: string }> | undefined)?.[sessionId]
    return row && typeof row.displayTitle === 'string' && row.displayTitle.length > 0 ? row.displayTitle : ''
  } catch {
    return ''
  }
}

export function webPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  try { return Notification.permission } catch { return 'unsupported' }
}

export function showWebNotification(event: PendingEvent, sessions: ISessions | undefined): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const notification = new Notification(notificationTitle(event), {
      body: notificationBody(event, sessions),
      icon: DEEPSEEK_ICON,
      tag: 'dsh-next-notifier-' + (typeof event.id === 'number' ? event.id : 'unknown'),
    })
    notification.onclick = () => {
      try { window.focus() } catch {}
      if (sessions && typeof sessions.open === 'function' && typeof event.sessionId === 'string' && event.sessionId) {
        try { sessions.open(event.sessionId as never) } catch {}
      }
      try { notification.close() } catch {}
    }
    const closeTimer = setTimeout(() => { try { notification.close() } catch {} }, 12000)
    void closeTimer
  } catch {
    // A failed notification is non-fatal; drop silently.
  }
}

export interface Drainer {
  dispose: () => void
}

export function createDrainer(
  sessions: ISessions | undefined,
  timer: TimerLike | undefined,
  fetchPending: () => Promise<unknown>,
): Drainer {
  const drain = (): void => {
    void fetchPending().then((list) => {
      if (!Array.isArray(list)) return
      const now = Date.now()
      for (const item of list as PendingEvent[]) {
        if (!item || typeof item !== 'object') continue
        if (typeof item.at === 'number' && now - item.at > 30000) continue
        showWebNotification(item, sessions)
      }
    }).catch(() => {})
  }

  let off: (() => void) | null = null
  if (timer && typeof timer.interval === 'function') {
    off = timer.interval(drain, 2000)
  }
  drain()

  return {
    dispose: () => {
      if (off) {
        try { off() } catch {}
      }
    },
  }
}
