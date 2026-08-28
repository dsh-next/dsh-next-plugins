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

export function webPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  try { return Notification.permission } catch { return 'unsupported' }
}

export function showWebNotification(
  event: PendingEvent,
  sessions: ISessions | undefined,
  timeoutMs = 12000,
): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const notification = new Notification(event.title ?? 'DeepSeek Harness', {
      body: event.body ?? '',
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
    const closeTimer = setTimeout(() => { try { notification.close() } catch {} }, timeoutMs)
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
  getTimeoutSeconds: () => number = () => 12,
): Drainer {
  const drain = (): void => {
    void fetchPending().then((list) => {
      if (!Array.isArray(list)) return
      const now = Date.now()
      const timeoutMs = Math.max(1000, Math.round(getTimeoutSeconds() * 1000))
      for (const item of list as PendingEvent[]) {
        if (!item || typeof item !== 'object') continue
        if (typeof item.at === 'number' && now - item.at > 30000) continue
        showWebNotification(item, sessions, timeoutMs)
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
