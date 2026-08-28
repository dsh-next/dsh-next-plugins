/**
 * The "DSH Next Notifier" settings card rendered in the `settings.plugin.item`
 * slot. Reads config over the Host RPC, persists edits, previews sounds, and
 * shows a live focus-tracking line.
 */
import * as React from 'react'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { NotifierConfig, NotifyGroup } from '../core/types.ts'
import type { TimerLike } from '../core/timer.ts'
import { webPermission } from './drainer.ts'
import { currentSessionId } from './presence.ts'
import styles from './card.module.css'

interface SoundMeta {
  id: string
  name: string
  group: string
}

interface StateSnapshot {
  config?: NotifierConfig
  platform?: string | null
  webPermission?: string | null
  sounds?: SoundMeta[]
}

export interface CardDeps {
  rpc: (method: string, args?: unknown) => Promise<unknown>
  sessions?: ISessions
  timer?: TimerLike
  showWebNotification: (event: {
    id?: number
    title?: string
    body?: string
    sessionId?: string | null
  }, timeoutMs?: number) => void
  /** Notified whenever a config snapshot lands, so the host-side drainer
   * honors the latest notification auto-dismiss duration. */
  onConfig?: (config: { notificationSeconds?: number } | undefined) => void
}

const GROUPS: { key: 'finished' | 'approval' | 'question'; title: string; hint: string; extras: { field: 'subagent' | 'goalOnly'; label: string; hint: string }[] }[] = [
  {
    key: 'finished', title: 'Agent finished', hint: 'When the agent finishes its turn',
    extras: [
      { field: 'subagent', label: 'Subagent finished', hint: 'Also notify when a subagent finishes its turn' },
      { field: 'goalOnly', label: 'Only notify when the goal completes', hint: 'While a goal is running, stay quiet until it completes or is blocked' },
    ],
  },
  { key: 'approval', title: 'Approval needed', hint: 'When the agent is waiting for your approval', extras: [] },
  { key: 'question', title: 'Question asked', hint: 'When the agent asks you a question', extras: [] },
]

function platformName(value: string | null | undefined): string {
  if (value === 'macos') return 'macOS · afplay'
  if (value === 'windows') return 'Windows · SoundPlayer'
  if (value === 'linux') return 'Linux · paplay/aplay'
  return 'none detected'
}

export function NotifierCard({ rpc, sessions, timer, showWebNotification, onConfig }: CardDeps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [snap, setSnap] = React.useState<StateSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [presence, setPresence] = React.useState<Record<string, unknown> | null>(null)
  const [webStatus, setWebStatus] = React.useState<string | null>(null)
  const [advanced, setAdvanced] = React.useState(false)

  // Central apply point: every config snapshot (initial getState or a setConfig
  // reply) sets the card state and notifies the shared config ref.
  function applySnapshot(v: StateSnapshot): void {
    setSnap(v)
    if (typeof onConfig === 'function') onConfig(v.config)
  }

  React.useEffect(() => {
    let alive = true
    rpc('getState').then((v) => { if (alive) applySnapshot(v as StateSnapshot) }).catch((e) => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [rpc])

  React.useEffect(() => { setWebStatus(webPermission()) }, [])

  React.useEffect(() => {
    if (!open) return
    let alive = true
    const refresh = (): void => {
      rpc('getPresence').then((v) => { if (alive) setPresence(v as Record<string, unknown>) }).catch(() => {})
    }
    refresh()
    let off: (() => void) | null = null
    if (timer && typeof timer.interval === 'function') off = timer.interval(refresh, 2000)
    return () => { alive = false; if (off) off() }
  }, [open, rpc, timer])

  const config = snap?.config
  const sounds = snap?.sounds ?? []

  function update(patch: Record<string, unknown>): void {
    setSnap((prev) => (prev && prev.config ? { ...prev, config: { ...prev.config, ...patch } as NotifierConfig } : prev))
    rpc('setConfig', patch).then((v) => applySnapshot(v as StateSnapshot)).catch((e) => {
      setError(String(e))
      rpc('getState').then((v) => applySnapshot(v as StateSnapshot)).catch(() => {})
    })
  }

  function sendGroup(key: 'finished' | 'approval' | 'question', fields: Partial<NotifyGroup>): void {
    if (!config) return
    const g = config[key]
    update({ [key]: { enabled: g.enabled, sound: g.sound, soundName: g.soundName, subagent: g.subagent ?? false, goalOnly: g.goalOnly ?? true, ...fields } })
  }

  let volumeTimer: ReturnType<typeof setTimeout> | null = null
  function setVolume(value: string | number): void {
    const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
    setSnap((prev) => (prev && prev.config ? { ...prev, config: { ...prev.config, volume: v } } : prev))
    if (volumeTimer) clearTimeout(volumeTimer)
    volumeTimer = setTimeout(() => {
      rpc('setConfig', { volume: v }).then((next) => {
        applySnapshot(next as StateSnapshot)
        const cfg = (next as StateSnapshot).config
        rpc('preview', { id: cfg?.finished?.soundName || 'chime' }).catch(() => {})
      }).catch((e) => {
        setError(String(e))
        rpc('getState').then((vv) => applySnapshot(vv as StateSnapshot)).catch(() => {})
      })
    }, 600)
  }

  let secondsTimer: ReturnType<typeof setTimeout> | null = null
  function setNotificationSeconds(value: string | number): void {
    const v = Math.max(3, Math.min(60, Math.round(Number(value) || 12)))
    setSnap((prev) => (prev && prev.config ? { ...prev, config: { ...prev.config, notificationSeconds: v } } : prev))
    if (secondsTimer) clearTimeout(secondsTimer)
    secondsTimer = setTimeout(() => {
      rpc('setConfig', { notificationSeconds: v }).then((next) => applySnapshot(next as StateSnapshot)).catch((e) => {
        setError(String(e))
        rpc('getState').then((vv) => applySnapshot(vv as StateSnapshot)).catch(() => {})
      })
    }, 600)
  }

  function enableWeb(): void {
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then((p) => {
      setWebStatus(p)
      rpc('reportWebPermission', { status: p }).catch(() => {})
    }).catch(() => {})
  }

  function testWeb(): void {
    const seconds = config?.notificationSeconds ?? 12
    showWebNotification({
      id: Date.now(),
      title: 'DeepSeek Harness · Test',
      body: 'Web notifications work — click me to open this session.',
      sessionId: currentSessionId(sessions),
    }, seconds * 1000)
  }

  function webHint(): string {
    if (webStatus === 'granted') return 'DeepSeek icon + click opens the session — shown even when minimized or behind another tab'
    if (webStatus === 'denied') return 'Blocked by the browser — notifications will not appear'
    if (webStatus === 'unsupported') return 'Not supported by this browser — notifications will not appear'
    return 'Shows the DeepSeek icon and opens the session when clicked'
  }

  function presenceLine(): string {
    if (!presence) return 'Focus tracking: waiting for report…'
    const viewingThis = presence.sessionId != null && presence.sessionId === currentSessionId(sessions)
    return 'Focus tracking: '
      + (presence.focused ? 'window focused' : 'away')
      + ' · ' + (viewingThis ? 'viewing this session' : (presence.sessionId == null ? 'no session open' : 'viewing another session'))
      + ' · ' + (typeof presence.ageMs === 'number' ? presence.ageMs + 'ms old' : 'stale')
  }

  function renderSelect(groupKey: 'finished' | 'approval' | 'question'): React.ReactElement | null {
    if (!config) return null
    const g = config[groupKey]
    const byGroup: Record<string, SoundMeta[]> = {}
    for (const s of sounds) (byGroup[s.group] || (byGroup[s.group] = [])).push(s)
    return React.createElement('select', {
      className: styles.select,
      value: g.soundName,
      disabled: !config.enabled || !g.enabled || !g.sound,
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
        const id = event.target.value
        sendGroup(groupKey, { soundName: id })
        rpc('preview', { id }).catch(() => {})
      },
    }, Object.keys(byGroup).map((groupName) => React.createElement('optgroup', { key: groupName, label: groupName },
      byGroup[groupName].map((s) => React.createElement('option', { key: s.id, value: s.id }, s.name)))))
  }

  function renderGroup(def: typeof GROUPS[number]): React.ReactElement | null {
    if (!config) return null
    const g = config[def.key]
    return React.createElement('div', { className: styles.group, key: def.key },
      React.createElement('label', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, def.title),
          React.createElement('span', { className: styles.hint }, def.hint)),
        React.createElement('input', {
          type: 'checkbox', className: styles.check, checked: g.enabled, disabled: !config.enabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => sendGroup(def.key, { enabled: e.target.checked }),
        })),
      React.createElement('div', { className: styles.sub },
        def.extras.map((extra) => React.createElement('label', { className: styles.row + ' ' + styles.rowSub, key: extra.field },
          React.createElement('span', { className: styles.text },
            React.createElement('span', { className: styles.label }, extra.label),
            React.createElement('span', { className: styles.hint }, extra.hint)),
          React.createElement('input', {
            type: 'checkbox', className: styles.check, checked: Boolean(g[extra.field]), disabled: !config.enabled || !g.enabled,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => sendGroup(def.key, { [extra.field]: e.target.checked }),
          }))),
        React.createElement('label', { className: styles.row + ' ' + styles.rowSub },
          React.createElement('span', { className: styles.text }, React.createElement('span', { className: styles.label }, 'Play sound')),
          React.createElement('input', {
            type: 'checkbox', className: styles.check, checked: g.sound, disabled: !config.enabled || !g.enabled,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => sendGroup(def.key, { sound: e.target.checked }),
          })),
        React.createElement('label', { className: styles.row + ' ' + styles.rowSub },
          React.createElement('span', { className: styles.text }, React.createElement('span', { className: styles.label }, 'Sound')),
          renderSelect(def.key))))
  }

  const header = React.createElement('button', {
    type: 'button', className: styles.header, 'aria-expanded': open ? 'true' : 'false',
    onClick: () => setOpen((v) => !v),
  },
    React.createElement('span', { className: styles.headText },
      React.createElement('span', { className: styles.name }, 'DSH Next Notifier'),
      React.createElement('span', { className: styles.desc }, 'Alerts when the agent finishes or needs you')),
    React.createElement('span', { className: styles.chevron + (open ? ' ' + styles.chevOpen : '') }, '\u25BE'))

  let body: React.ReactNode = null
  if (open && config) {
    body = React.createElement('div', { className: styles.body },
      React.createElement('label', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, 'Enable notifications'),
          React.createElement('span', { className: styles.hint }, 'Master switch for all agent notifications')),
        React.createElement('input', {
          type: 'checkbox', className: styles.check, checked: config.enabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update({ enabled: e.target.checked }),
        })),
      React.createElement('label', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, 'Mute while viewing the session'),
          React.createElement('span', { className: styles.hint }, 'No alert for the session you are actively looking at')),
        React.createElement('input', {
          type: 'checkbox', className: styles.check, checked: config.suppressFocused, disabled: !config.enabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update({ suppressFocused: e.target.checked }),
        })),
      React.createElement('div', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, 'Volume'),
          React.createElement('span', { className: styles.hint }, 'Sound loudness for all notifications — releases the slider to apply and preview')),
        React.createElement('input', {
          type: 'range', className: styles.range, min: 0, max: 100, step: 1,
          value: config.volume ?? 70, disabled: !config.enabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setVolume(e.target.value),
        }),
        React.createElement('span', { className: styles.hint }, (config.volume ?? 70) + '%')),
      React.createElement('div', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, 'Notification duration'),
          React.createElement('span', { className: styles.hint }, 'How long a browser notification stays before it disappears — releases the slider to apply')),
        React.createElement('input', {
          type: 'range', className: styles.range, min: 3, max: 60, step: 1,
          value: config.notificationSeconds ?? 12, disabled: !config.enabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNotificationSeconds(e.target.value),
        }),
        React.createElement('span', { className: styles.hint }, (config.notificationSeconds ?? 12) + 's')),
      React.createElement('div', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, 'Test browser notification'),
          React.createElement('span', { className: styles.hint }, webHint())),
        webStatus === 'granted'
          ? React.createElement('button', { type: 'button', className: styles.test, onClick: testWeb }, 'Test')
          : (webStatus === 'denied' || webStatus === 'unsupported')
            ? React.createElement('span', { className: styles.hint }, webStatus === 'denied' ? 'Blocked' : 'Unsupported')
            : React.createElement('button', { type: 'button', className: styles.test, onClick: enableWeb }, 'Enable')),
      GROUPS.map((g) => renderGroup(g)),
      React.createElement('div', { className: styles.footer },
        error ? React.createElement('p', { className: styles.status + ' ' + styles.statusErr }, String(error)) : null,
        React.createElement('button', { type: 'button', className: styles.test, onClick: () => setAdvanced((v) => !v) }, advanced ? 'Hide details ▴' : 'Show details ▾'),
        advanced
          ? React.createElement('div', { className: styles.adv },
            React.createElement('p', { className: styles.status }, 'Backend: ' + platformName(snap?.platform) + ' · changes apply immediately'),
            React.createElement('p', { className: styles.status }, presenceLine()))
          : null))
  }

  return React.createElement('li', { className: styles.card + (open ? ' ' + styles.open : '') }, header, body)
}
