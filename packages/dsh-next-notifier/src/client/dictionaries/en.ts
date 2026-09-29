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
  'settings.loading': 'Loading notification settings…',
  'settings.unavailable': 'Notification settings are unavailable. Enable the plugin and reopen this page.',
  'settings.readOnly': 'Settings are read-only in this connection.',
  'settings.saveFailed': 'The change was not saved. Check your connection and try changing the setting again.',
  'settings.automatic': 'Changes apply automatically.',
  'settings.saving': 'Saving…',
  'settings.reset': 'Restore inherited settings',
  'sound.chime': 'Chime', 'sound.ping': 'Ping', 'sound.bell': 'Bell',
  'sound.alert': 'Alert', 'sound.error': 'Error', 'sound.success': 'Success',
  'sound.chirp': 'Chirp', 'sound.pop': 'Pop', 'sound.knock': 'Knock',
  'sound.whoosh': 'Whoosh', 'sound.magic': 'Magic', 'sound.blip': 'Blip',
  'sound.ring': 'Ring', 'sound.gong': 'Gong',
  'sound.fart-classic': 'Fart · Classic', 'sound.fart-deep': 'Fart · Deep', 'sound.fart-squeaky': 'Fart · Squeaky',
  'sound.preview': 'Preview',
  'sound.failed': 'Sound could not play. Check this device’s audio settings and try Preview again.',
  'delivery.title': 'Delivery on this device',
  'delivery.failed': 'The system did not confirm this notification. Check notification permissions and try again.',
  'toast.openSession': 'Open session',
  'event.default': 'DeepSeek Harness',
  'event.finished': 'Agent finished',
  'event.approval': 'Approval needed',
  'event.question': 'Question asked',
  'event.subagent': 'Subagent finished',
  'event.subagentError': 'Subagent encountered an error',
  'event.subagentBlocked': 'Subagent blocked',
  'event.subagentMaxTokens': 'Subagent response limit reached',
  'event.goalComplete': 'Goal completed',
  'event.goalBlocked': 'Goal blocked',
  'event.error': 'Agent encountered an error',
  'event.blocked': 'Agent blocked',
  'event.maxTokens': 'Response limit reached',
  'card.title': 'Notifier',
  'card.tagline': 'Alerts when the agent finishes or needs you',

  'toggle.enable': 'Enable notifications',
  'toggle.enable.hint': 'Master switch for all agent notifications',
  'toggle.muteViewing': 'Mute while viewing the session',
  'toggle.muteViewing.hint': 'No alert for the session you are actively looking at',

  'volume.label': 'Volume',
  'volume.hint': 'Plays on this device. Changes apply automatically; use Preview to enable audio.',
  'volume.value': '{count}%',

  'web.test': 'System notifications',
  'web.hint.granted': 'Allowed on this device. System permissions and Do Not Disturb may still hide alerts.',
  'web.hint.denied': 'Blocked. Allow notifications in your browser or system settings, then return here.',
  'web.hint.unsupported': 'System notifications are unavailable in this client. In-app alerts still work.',
  'web.hint.default': 'Allow this client to notify you while Harness is in the background.',
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

  'rpc.timeout': 'Notifier request "{method}" timed out. Try again.',
  'rpc.disposed': 'Notifier is no longer active.',
  'rpc.failed': 'Notifier request "{method}" failed (HTTP {status})',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en
