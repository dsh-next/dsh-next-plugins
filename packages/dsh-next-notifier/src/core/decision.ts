/**
 * Pure notification-decision logic: given the current config, presence, and a
 * candidate event, decide whether to notify and with which sound. No runtime
 * identity — unit-tested against synthetic inputs.
 */
import type { NotifierConfig } from './types.ts'

/** A presence report as the client sends it and the host stores it. */
export interface Presence {
  focused: boolean
  visible: boolean
  open: boolean
  sessionId: string | null
}

/** A normalized notification event the host queues for the client. */
export interface PendingNotification {
  id: number
  kind: string
  title: string
  body: string
  sessionId: string | null
  at: number
  /** Delivery channel chosen at event time: in-page toast or web notification. */
  channel: 'toast' | 'web'
}

export interface DecisionInput {
  config: NotifierConfig
  presence: Presence | null
  presenceAgeMs: number
  eventKind: 'finished' | 'approval' | 'question' | 'subagent' | 'goal-complete' | 'goal-blocked'
  title: string
  body: string
  sessionId: string | null
  /** For 'finished': was the user viewing the session at the idle moment? */
  viewingAtEvent?: boolean
  /** For 'goal-complete'/'goal-blocked': reuse the finished group. */
  group: 'finished' | 'approval' | 'question'
  /** Subagent opt-in gate (only relevant for 'subagent'). */
  subagentEnabled: boolean
}

export interface Decision {
  notify: boolean
  soundName: string | null
  /**
   * Delivery channel: an in-page toast while the user is looking at the page
   * (focused + visible), a web notification while the page is backgrounded or
   * minimized, and null when nothing may be delivered.
   */
  channel: 'toast' | 'web' | null
  reason: 'disabled' | 'group-disabled' | 'subagent-opt-out' | 'suppressed' | 'page-dead' | 'permission-missing' | 'ok'
}

/** Whether the page is still considered alive (has reported recently, not closed). */
export function isPageAlive(presence: Presence | null, ageMs: number, maxAgeMs: number): boolean {
  if (!presence) return false
  if (ageMs > maxAgeMs) return false
  return presence.open !== false
}

/** Whether the user is focused + visible on the exact session id. */
export function isViewingSession(presence: Presence | null, ageMs: number, maxAgeMs: number, sessionId: string | null): boolean {
  if (!sessionId) return false
  if (!presence) return false
  if (ageMs > maxAgeMs) return false
  return presence.focused === true && presence.visible === true && presence.sessionId === sessionId
}

/**
 * Decide whether to notify for one event. Pure: reads only its inputs.
 * The host composes this with its queue/player; tests exercise it directly.
 */
export function decide(input: DecisionInput, maxAgeMs: number, webPermission: 'granted' | 'denied' | 'default' | 'unsupported' | null): Decision {
  const { config } = input
  if (!config.enabled) return { notify: false, channel: null, soundName: null, reason: 'disabled' }

  const group = config[input.group]
  if (!group || !group.enabled) return { notify: false, channel: null, soundName: null, reason: 'group-disabled' }
  if (input.eventKind === 'subagent' && !input.subagentEnabled) return { notify: false, channel: null, soundName: null, reason: 'subagent-opt-out' }

  const soundName = group.sound ? group.soundName : null

  if (config.suppressFocused) {
    const viewingNow = isViewingSession(input.presence, input.presenceAgeMs, maxAgeMs, input.sessionId)
    const suppress = input.eventKind === 'finished'
      ? input.viewingAtEvent === true && viewingNow
      : viewingNow
    if (suppress) return { notify: false, channel: null, soundName, reason: 'suppressed' }
  }

  if (!isPageAlive(input.presence, input.presenceAgeMs, maxAgeMs)) return { notify: false, channel: null, soundName, reason: 'page-dead' }

  // The user is looking at the page (focused + visible): surface the event as
  // an in-page toast. Toasts need no browser notification permission — they
  // are plain page UI.
  if (input.presence && input.presence.focused === true && input.presence.visible === true) {
    return { notify: true, channel: 'toast', soundName, reason: 'ok' }
  }

  // Backgrounded or minimized: deliver through the web Notification API,
  // which only the OS can show while the window is out of sight.
  if (webPermission !== 'granted') return { notify: false, channel: null, soundName, reason: 'permission-missing' }
  return { notify: true, channel: 'web', soundName, reason: 'ok' }
}
