/** Render leased events through Harness Toast or the system Notification API. */
import * as React from 'react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TimerLike } from '../core/timer.ts'
import { createDrainer, eventBody, eventTitle, showWebNotification, type WebNotificationHandle } from './drainer.ts'
import { isLookingNow } from './presence.ts'
import { englishTranslate, type Translate } from './dictionaries.ts'
import { Toast, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** A host delivery or a local preview, with presentation fields only. */
export interface ToastEvent {
  id?: number | string
  kind?: string
  isSubagent?: boolean
  title?: string
  body?: string
  sessionId?: string | null
  at?: number
  channel?: 'toast' | 'web'
}

export interface ToastLayerProps {
  rpc: (method: string, args?: unknown) => Promise<unknown>
  sessions?: ISessions
  navigation?: Pick<UiWorkspace, 'openSession'>
  timer?: TimerLike
  t?: Translate
  playSound?: (id: string, volume: number) => Promise<boolean>
}

const MAX_TOASTS = 1
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


export function ToastLayer({ rpc, sessions, timer, t = englishTranslate, playSound, navigation }: ToastLayerProps): React.ReactElement | null {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const items = React.useRef<ToastItem[]>([])
  const confirmations = React.useRef(new Map<number, (shown: boolean) => void>())

  const cleanupItem = React.useCallback((key: number) => {
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
  }, [cleanupItem])

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
        let shown: boolean
        if (isLookingNow()) shown = await new Promise<boolean>((resolve) => enqueue(event, resolve))
        else {
          const handle = showWebNotification(event, sessions, () => { if (handle) web.delete(handle) }, t, navigation)
          if (!handle) return false
          web.add(handle)
          shown = await handle.shown
        }
        return shown
      },
      acknowledge: async (event) => {
        const result = await rpc('acknowledgeNotifications', { id: event.id, lease: event.lease }) as
          { ok?: boolean; sound?: { id?: unknown; volume?: unknown } } | null
        // The host rechecks cancellation, lease expiry, and current sound preferences.
        // Only its first accepted receipt carries sound; retries never replay audio.
        if (alive && result?.ok === true && typeof result.sound?.id === 'string'
          && typeof result.sound.volume === 'number' && Number.isFinite(result.sound.volume)) {
          void playSound?.(result.sound.id, result.sound.volume).catch(() => {})
        }
        return result
      },
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
  }, [rpc, timer, sessions, enqueue, cleanupItem, t, playSound, navigation])

  const openSession = (item: ToastItem): void => {
    remove(item.key)
    if (typeof item.event.sessionId === 'string' && item.event.sessionId) {
      try { navigation?.openSession(item.event.sessionId as never) } catch {}
    }
  }

  const item = toasts.at(-1)
  if (!item) return null
  const success = ['finished', 'subagent', 'goal-complete'].includes(item.event.kind ?? '')
  const body = eventBody(item.event, sessions)
  return <Toast key={item.key} text={eventTitle(item.event, t) + (body ? ' · ' + body : '')}
    tone={success ? 'success' : undefined} icon={<IconWarningOutlineRegular size={16} />}
    holdMs={TOAST_TTL_MS} onDone={() => remove(item.key)}
    actions={[
      ...(item.event.sessionId && navigation ? [{ label: t('toast.openSession'), onClick: () => openSession(item) }] : []),
      { label: t('toast.close'), onClick: () => remove(item.key) },
    ]} />
}
