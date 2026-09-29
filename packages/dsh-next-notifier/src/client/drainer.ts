/** Renderer notifications and single-flight host delivery polling. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TimerLike } from '../core/timer.ts'
import type { Delivery } from '../core/notifications.ts'
import { DEEPSEEK_ICON } from './deepseek-icon.ts'
import { englishTranslate, type Translate, type MessageKey } from './dictionaries.ts'

interface PendingEvent {
  id?: number | string
  kind?: string
  isSubagent?: boolean
  title?: string
  body?: string
  sessionId?: string | null
  at?: number
  channel?: 'toast' | 'web'
}

const TITLES: Record<string, MessageKey> = {
  finished: 'event.finished', approval: 'event.approval', question: 'event.question',
  subagent: 'event.subagent', 'goal-complete': 'event.goalComplete', 'goal-blocked': 'event.goalBlocked',
  error: 'event.error', blocked: 'event.blocked', 'max-tokens': 'event.maxTokens',
}

/** Known event kinds are localized on the receiving client. */
export function eventTitle(event: PendingEvent, t: Translate = englishTranslate): string {
  if (event.isSubagent && event.kind === 'error') return t('event.subagentError')
  if (event.isSubagent && event.kind === 'blocked') return t('event.subagentBlocked')
  if (event.isSubagent && event.kind === 'max-tokens') return t('event.subagentMaxTokens')
  const key = event.kind && Object.hasOwn(TITLES, event.kind) ? TITLES[event.kind] : undefined
  if (key) return t(key)
  return event.title || t('event.default')
}

/**
 * The notification body: the session's display title so a glance says which
 * session, falling back to the Host-supplied detail when the session is unknown.
 */
export function eventBody(event: PendingEvent, sessions: ISessions | undefined): string {
  const sessionTitle = sessionTitleOf(sessions, event.sessionId)
  if (sessionTitle) return sessionTitle
  return typeof event.body === 'string' ? event.body : ''
}

/** Resolve a session's display title from the session list, safely. */
export function sessionTitleOf(sessions: ISessions | undefined, sessionId: string | null | undefined): string {
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


export interface WebNotificationHandle {
  shown: Promise<boolean>
  close: () => void
}

/** Only a browser show event confirms acceptance; a constructor alone does not. */
export function showWebNotification(event: PendingEvent, sessions: ISessions | undefined, onClose?: () => void, t: Translate = englishTranslate, navigation?: Pick<UiWorkspace, 'openSession'>): WebNotificationHandle | null {
  if (webPermission() !== 'granted') return null
  try {
    const notification = new Notification(eventTitle(event, t), {
      body: eventBody(event, sessions), icon: DEEPSEEK_ICON,
      tag: 'dsh-next-notifier-' + (event.id ?? 'unknown'), silent: true,
    })
    let closed = false
    let settled = false
    let settle!: (shown: boolean) => void
    const shown = new Promise<boolean>((resolve) => { settle = resolve })
    const finish = (value: boolean): void => { if (!settled) { settled = true; settle(value) } }
    const close = (): void => {
      if (closed) return
      closed = true
      clearTimeout(showTimer)
      clearTimeout(closeTimer)
      notification.onclick = notification.onshow = notification.onerror = notification.onclose = null
      try { notification.close() } catch {}
      finish(false)
      onClose?.()
    }
    notification.onshow = () => { clearTimeout(showTimer); finish(true) }
    notification.onerror = close
    notification.onclose = close
    notification.onclick = () => {
      try { window.focus() } catch {}
      if (typeof event.sessionId === 'string' && event.sessionId) {
        try { navigation?.openSession(event.sessionId as never) } catch {}
      }
      close()
    }
    const showTimer = setTimeout(close, 2000)
    const closeTimer = setTimeout(close, 12000)
    return { shown, close }
  } catch {
    return null
  }
}

export interface Drainer { dispose: () => void; poll: () => Promise<void> }
export interface DeliveryTransport {
  claim: () => Promise<unknown>
  show: (event: Delivery) => Promise<boolean>
  acknowledge: (event: Delivery) => Promise<unknown>
  release: (event: Delivery) => Promise<unknown>
}

function isDelivery(value: unknown): value is Delivery {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<Delivery>
  return typeof event.id === 'string' && typeof event.lease === 'string'
    && typeof event.at === 'number' && Number.isFinite(event.at)
    && typeof event.leaseExpiresAt === 'number' && Number.isFinite(event.leaseExpiresAt)
    && typeof event.kind === 'string' && typeof event.title === 'string'
    && typeof event.body === 'string' && typeof event.sessionId === 'string'
}

/** Single-flight polling shared by toast and web delivery; failed renders release their lease. */
export function createDrainer(timer: TimerLike | undefined, transport: DeliveryTransport): Drainer {
  let disposed = false
  let busy = false
  const shown = new Map<string, { at: number; lease: string }>()
  const acknowledgements = new Map<string, Delivery>()
  const acknowledge = async (event: Delivery): Promise<void> => {
    try {
      await transport.acknowledge(event)
      acknowledgements.delete(event.id)
    } catch {
      if (!disposed) acknowledgements.set(event.id, event)
    }
  }
  const poll = async (): Promise<void> => {
    if (disposed || busy) return
    busy = true
    try {
      for (const [id, entry] of shown) if (Date.now() - entry.at > 120000) { shown.delete(id); acknowledgements.delete(id) }
      for (const event of acknowledgements.values()) {
        if (disposed) return
        if (Date.now() >= event.leaseExpiresAt) { acknowledgements.delete(event.id); continue }
        await acknowledge(event)
        break
      }
      if (disposed) return
      const list = await transport.claim()
      if (!Array.isArray(list)) return
      for (const event of list) {
        if (!isDelivery(event)) continue
        if (disposed || Date.now() >= event.leaseExpiresAt || Date.now() - event.at > 120000) {
          await transport.release(event).catch(() => {})
          continue
        }
        let delivered = shown.get(event.id)?.lease === event.lease
        try { if (!delivered) delivered = await transport.show(event) } catch { delivered = false }
        if (disposed || !delivered) {
          await transport.release(event).catch(() => {})
          continue
        }
        shown.set(event.id, { at: Date.now(), lease: event.lease })
        if (shown.size > 100) {
          const oldest = shown.keys().next().value!
          shown.delete(oldest)
          acknowledgements.delete(oldest)
        }
        await acknowledge(event)
      }
    } catch {
      // The host retains unacknowledged events; the next poll can retry.
    } finally { busy = false }
  }
  const off = timer?.interval(() => { void poll() }, 2000)
  void poll()
  return { poll, dispose: () => { disposed = true; off?.(); shown.clear(); acknowledgements.clear() } }
}
