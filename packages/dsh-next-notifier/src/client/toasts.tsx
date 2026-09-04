/**
 * In-page toast layer for the notifier: fixed, top-center capsule cards shown
 * while the user is looking at the page (focused + visible), for events the
 * Host routed to the toast channel. Clicking a toast opens its session; the
 * close button dismisses it, and every toast auto-dismisses after the same
 * TTL the web notifications use. Web-channel events never render here — the
 * web drainer owns them — and a toast-channel event that arrives after the
 * user stopped looking falls back to a web notification instead.
 */
import * as React from 'react'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { TimerLike } from '../core/timer.ts'
import { eventBody, eventTitle, showWebNotification } from './drainer.ts'
import { isLookingNow } from './presence.ts'
import { englishTranslate, type MessageKey } from './dictionaries.ts'
import styles from './toasts.module.css'

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/** A queued event as the Host's drain returns it (channel is what matters here). */
export interface ToastEvent {
  id?: number
  kind?: string
  title?: string
  body?: string
  sessionId?: string | null
  at?: number
  channel?: 'toast' | 'web'
}

export interface ToastLayerProps {
  rpc: (method: string, args?: unknown) => Promise<unknown>
  sessions?: ISessions
  timer?: TimerLike
  t?: Translate
}

const MAX_TOASTS = 5
const TOAST_TTL_MS = 12000

interface ToastItem {
  key: number
  event: ToastEvent
}

let toastSeq = 0

// Test-toast bus: the settings card's "Test in-page toast" button enqueues a
// synthetic event here; the mounted layer subscribes so the card and the
// overlay slot (separate registrations) never import each other.
const busListeners = new Set<(event: ToastEvent) => void>()

/** Enqueue a synthetic toast from anywhere in the client half (settings card test). */
export function enqueueTestToast(event: ToastEvent): void {
  for (const fn of busListeners) fn(event)
}

function subscribeBus(fn: (event: ToastEvent) => void): () => void {
  busListeners.add(fn)
  return () => { busListeners.delete(fn) }
}

export function ToastLayer({ rpc, sessions, timer, t = englishTranslate }: ToastLayerProps): React.ReactElement | null {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const ttlDisposers = React.useRef(new Map<number, () => void>())

  const remove = React.useCallback((key: number) => {
    setToasts((prev) => prev.filter((i) => i.key !== key))
    const off = ttlDisposers.current.get(key)
    if (off) {
      try { off() } catch {}
      ttlDisposers.current.delete(key)
    }
  }, [])

  const enqueue = React.useCallback((event: ToastEvent) => {
    const key = ++toastSeq
    setToasts((prev) => {
      // One toast per session: a newer event for the same session replaces
      // its predecessor (repeated pings, approval -> question kind jumps).
      const next = prev.filter((i) => i.event.sessionId !== event.sessionId)
      next.push({ key, event })
      while (next.length > MAX_TOASTS) {
        const removed = next.shift()
        if (removed) {
          const off = ttlDisposers.current.get(removed.key)
          if (off) {
            try { off() } catch {}
            ttlDisposers.current.delete(removed.key)
          }
        }
      }
      return next
    })
    if (timer && typeof timer.timeout === 'function') {
      ttlDisposers.current.set(key, timer.timeout(() => { remove(key) }, TOAST_TTL_MS))
    }
  }, [timer, remove])

  React.useEffect(() => {
    const offBus = subscribeBus(enqueue)
    let offInterval: (() => void) | null = null
    let alive = true
    const poll = (): void => {
      // Channel-scoped drain: only toast events come out of this poll, so the
      // web drainer's queue is never consumed here (and vice versa).
      void rpc('getPendingNotifications', { channel: 'toast' }).then((list) => {
        if (!alive || !Array.isArray(list)) return
        for (const item of list as ToastEvent[]) {
          if (!item || typeof item !== 'object' || item.channel !== 'toast') continue
          // Race guard: the Host routed this to toasts while the user was
          // looking; if they stopped before the poll drained it, deliver the
          // web notification the event would have gotten.
          if (!isLookingNow()) {
            showWebNotification(item, sessions)
            continue
          }
          enqueue(item)
        }
      }).catch(() => {})
    }
    if (timer && typeof timer.interval === 'function') offInterval = timer.interval(poll, 2000)
    poll()
    return () => {
      alive = false
      offBus()
      if (offInterval) {
        try { offInterval() } catch {}
      }
      for (const off of ttlDisposers.current.values()) {
        try { off() } catch {}
      }
      ttlDisposers.current.clear()
    }
  }, [rpc, timer, sessions, enqueue])

  const openSession = (item: ToastItem): void => {
    remove(item.key)
    if (sessions && typeof sessions.open === 'function' && typeof item.event.sessionId === 'string' && item.event.sessionId) {
      try { sessions.open(item.event.sessionId as never) } catch {}
    }
  }

  if (toasts.length === 0) return null

  return React.createElement('div', {
    className: styles.layer,
    'data-testid': 'dsh-next-notifier-toasts',
    'aria-live': 'polite',
  },
    toasts.map((item) => React.createElement('div', {
      key: item.key,
      className: styles.toast,
      'data-testid': 'dsh-next-notifier-toast',
      role: 'button',
      tabIndex: 0,
      'aria-label': eventTitle(item.event),
      onClick: () => openSession(item),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openSession(item)
        }
      },
    },
      React.createElement('span', { className: styles.dot, 'data-kind': item.event.kind ?? 'unknown' }),
      React.createElement('span', { className: styles.text },
        React.createElement('span', { className: styles.title }, eventTitle(item.event)),
        React.createElement('span', { className: styles.body }, eventBody(item.event, sessions))),
      React.createElement('button', {
        type: 'button',
        className: styles.close,
        'aria-label': t('toast.close'),
        title: t('toast.close'),
        'data-testid': 'dsh-next-notifier-toast-close',
        onClick: (e: React.MouseEvent) => { e.stopPropagation(); remove(item.key) },
      }, '\u00d7'),
    )))
}
