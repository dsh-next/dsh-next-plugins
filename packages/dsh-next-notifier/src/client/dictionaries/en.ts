/**
 * English dictionary — the key source for the `notifier` locale namespace.
 *
 * English is this repo's language and the platform's fallback locale, so the
 * key set is defined here; `zh.ts` mirrors it (a missing or extra zh key is a
 * compile error via `Record<MessageKey, string>`, and the platform's typed
 * `register` checks both sides against the namespace's key union again).
 * Values may carry `{name}` placeholders — the platform's `t(key, params)`
 * substitutes them.
 *
 * English values are byte-identical to the strings this card rendered
 * before localization, so English-language tests assert the same text.
 */

/** Dictionary namespace this card owns. */
export const NS = 'notifier'

export const en = {
  'card.title': 'Notifier',
  'card.tagline': 'Alerts when the agent finishes or needs you',

  'toggle.enable': 'Enable notifications',
  'toggle.enable.hint': 'Master switch for all agent notifications',
  'toggle.muteViewing': 'Mute while viewing the session',
  'toggle.muteViewing.hint': 'No alert for the session you are actively looking at',

  'volume.label': 'Volume',
  'volume.hint': 'Sound loudness for all notifications — releases the slider to apply and preview',
  'volume.value': '{count}%',

  'web.test': 'Test browser notification',
  'web.hint.granted': 'DeepSeek icon + click opens the session — shown even when minimized or behind another tab',
  'web.hint.denied': 'Blocked by the browser — notifications will not appear',
  'web.hint.unsupported': 'Not supported by this browser — notifications will not appear',
  'web.hint.default': 'Shows the DeepSeek icon and opens the session when clicked',
  'web.button.test': 'Test',
  'web.button.enable': 'Enable',
  'web.status.blocked': 'Blocked',
  'web.status.unsupported': 'Unsupported',
  'web.testTitle': 'Test notification',
  'web.testBody': 'Web notifications work — click me to open this session.',

  'toast.test': 'Test in-page toast',
  'toast.test.hint': 'Shows a toast inside the page while you are looking at it',
  'toast.button.test': 'Show',
  'toast.testTitle': 'Test toast',
  'toast.testBody': 'In-page toasts work — click me to open this session.',
  'toast.close': 'Dismiss',
  'toast.layerLabel': 'Session toasts',

  'group.finished.title': 'Agent finished',
  'group.finished.hint': 'When the agent finishes its turn',
  'group.finished.subagent': 'Subagent finished',
  'group.finished.subagent.hint': 'Also notify when a subagent finishes its turn',
  'group.finished.goalOnly': 'Only notify when the goal completes',
  'group.finished.goalOnly.hint': 'While a goal is running, stay quiet until it completes or is blocked',
  'group.approval.title': 'Approval needed',
  'group.approval.hint': 'When the agent is waiting for your approval',
  'group.question.title': 'Question asked',
  'group.question.hint': 'When the agent asks you a question',
  'group.playSound': 'Play sound',
  'group.sound': 'Sound',

  'platform.macos': 'macOS · afplay',
  'platform.windows': 'Windows · SoundPlayer',
  'platform.linux': 'Linux · paplay/aplay',
  'platform.none': 'none detected',

  'details.show': 'Show details ▾',
  'details.hide': 'Hide details ▴',
  'details.backend': 'Backend: {platform} · changes apply immediately',

  'presence.waiting': 'Focus tracking: waiting for report…',
  'presence.prefix': 'Focus tracking: ',
  'presence.focused': 'window focused',
  'presence.away': 'away',
  'presence.viewingThis': 'viewing this session',
  'presence.viewingOther': 'viewing another session',
  'presence.noSession': 'no session open',
  'presence.ageMs': '{count}ms old',
  'presence.stale': 'stale',

  'rpc.failed': 'Notifier request "{method}" failed (HTTP {status})',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en
