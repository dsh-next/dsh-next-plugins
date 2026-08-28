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
  if (!config.enabled) return { notify: false, soundName: null, reason: 'disabled' }

  const group = config[input.group]
  if (!group || !group.enabled) return { notify: false, soundName: null, reason: 'group-disabled' }
  if (input.eventKind === 'subagent' && !input.subagentEnabled) return { notify: false, soundName: null, reason: 'subagent-opt-out' }

  const soundName = group.sound ? group.soundName : null

  if (config.suppressFocused) {
    const viewingNow = isViewingSession(input.presence, input.presenceAgeMs, maxAgeMs, input.sessionId)
    const suppress = input.eventKind === 'finished'
      ? input.viewingAtEvent === true && viewingNow
      : viewingNow
    if (suppress) return { notify: false, soundName, reason: 'suppressed' }
  }

  if (webPermission !== 'granted') return { notify: false, soundName, reason: 'permission-missing' }
  if (!isPageAlive(input.presence, input.presenceAgeMs, maxAgeMs)) return { notify: false, soundName, reason: 'page-dead' }

  return { notify: true, soundName, reason: 'ok' }
}
