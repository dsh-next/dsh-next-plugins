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
import { createDrainer, eventBody, eventTitle, showWebNotification, type WebNotificationHandle } from './drainer.ts'
import { isLookingNow } from './presence.ts'
import { englishTranslate, type MessageKey } from './dictionaries.ts'
import styles from './toasts.module.css'

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/** A queued event as the Host's drain returns it (channel is what matters here). */
export interface ToastEvent {
  id?: number | string
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
  const items = React.useRef<ToastItem[]>([])
  const ttlDisposers = React.useRef(new Map<number, () => void>())
  const confirmations = React.useRef(new Map<number, (shown: boolean) => void>())

  const cleanupItem = React.useCallback((key: number) => {
    ttlDisposers.current.get(key)?.()
    ttlDisposers.current.delete(key)
    confirmations.current.get(key)?.(false)
    confirmations.current.delete(key)
  }, [])

  const remove = React.useCallback((key: number) => {
    cleanupItem(key)
    items.current = items.current.filter((i) => i.key !== key)
    setToasts(items.current)
  }, [cleanupItem])

  const enqueue = React.useCallback((event: ToastEvent, confirm?: (shown: boolean) => void) => {
    const key = ++toastSeq
    const next = items.current.filter((item) => {
      if (item.event.sessionId !== event.sessionId) return true
      cleanupItem(item.key)
      return false
    })
    next.push({ key, event })
    while (next.length > MAX_TOASTS) cleanupItem(next.shift()!.key)
    items.current = next
    if (confirm) confirmations.current.set(key, confirm)
    setToasts(next)
    const expire = () => remove(key)
    if (timer) ttlDisposers.current.set(key, timer.timeout(expire, TOAST_TTL_MS))
    else {
      const timeout = setTimeout(expire, TOAST_TTL_MS)
      ttlDisposers.current.set(key, () => clearTimeout(timeout))
    }
  }, [timer, remove, cleanupItem])

  // Confirm only committed, visible DOM. If focus changed during React's
  // render, release the event instead of playing sound for an unseen toast.
  React.useEffect(() => {
    for (const item of toasts) {
      const confirm = confirmations.current.get(item.key)
      if (!confirm) continue
      confirmations.current.delete(item.key)
      const shown = isLookingNow()
      confirm(shown)
      if (!shown) remove(item.key)
    }
  }, [toasts, remove])

  React.useEffect(() => {
    let alive = true
    const web = new Set<WebNotificationHandle>()
    const offBus = subscribeBus((event) => enqueue(event))
    const drainer = createDrainer(timer, {
      claim: () => rpc('getPendingNotifications'),
      show: async (event) => {
        if (!alive) return false
        if (isLookingNow()) return new Promise<boolean>((resolve) => enqueue(event, resolve))
        const handle = showWebNotification(event, sessions, () => { if (handle) web.delete(handle) })
        if (!handle) return false
        web.add(handle)
        return handle.shown
      },
      acknowledge: (event) => rpc('acknowledgeNotifications', { id: event.id, lease: event.lease }),
      release: (event) => rpc('releaseNotification', { id: event.id, lease: event.lease }),
    })
    const onFocus = () => { void drainer.poll() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      alive = false
      drainer.dispose()
      offBus()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      for (const handle of web) handle.close()
      for (const item of items.current) cleanupItem(item.key)
      items.current = []
    }
  }, [rpc, timer, sessions, enqueue, cleanupItem])

  const openSession = (item: ToastItem): void => {
    remove(item.key)
    if (sessions && typeof item.event.sessionId === 'string' && item.event.sessionId) {
      try { void Promise.resolve(sessions.open(item.event.sessionId as never)).catch(() => {}) } catch {}
    }
  }

  if (toasts.length === 0) return null
  return React.createElement('div', {
    className: styles.layer, 'data-testid': 'dsh-next-notifier-toasts', 'aria-live': 'polite',
  }, toasts.map((item) => React.createElement('div', {
    key: item.key, className: styles.toast, 'data-testid': 'dsh-next-notifier-toast',
    role: 'button', tabIndex: 0, 'aria-label': eventTitle(item.event),
    onClick: () => openSession(item),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
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
      type: 'button', className: styles.close, 'aria-label': t('toast.close'), title: t('toast.close'),
      'data-testid': 'dsh-next-notifier-toast-close',
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); remove(item.key) },
    }, '\u00d7'),
  )))
}
