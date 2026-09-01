/**
 * The "DSH Next Notifier" settings card rendered in the `settings.plugin.item`
 * slot. Reads config over the Host RPC, persists edits, previews sounds, and
 * shows a live focus-tracking line. Every user-facing string goes through the
 * package's locale dictionaries via the injected `t` translator (English
 * unchanged without the platform locale service).
 */
import * as React from 'react'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { NotifierConfig, NotifyGroup } from '../core/types.ts'
import type { TimerLike } from '../core/timer.ts'
import { webPermission } from './drainer.ts'
import { currentSessionId } from './presence.ts'
import { englishTranslate, type MessageKey } from './dictionaries.ts'
import styles from './card.module.css'

/** Translates a dictionary key with `{name}` params (platform semantics). */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

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
  /** Translator bound to the `notifier` locale namespace; English fallback. */
  t?: Translate
  showWebNotification: (event: {
    id?: number
    title?: string
    body?: string
    sessionId?: string | null
  }) => void
}

const GROUPS: { key: 'finished' | 'approval' | 'question'; title: MessageKey; hint: MessageKey; extras: { field: 'subagent' | 'goalOnly'; label: MessageKey; hint: MessageKey }[] }[] = [
  {
    key: 'finished', title: 'group.finished.title', hint: 'group.finished.hint',
    extras: [
      { field: 'subagent', label: 'group.finished.subagent', hint: 'group.finished.subagent.hint' },
      { field: 'goalOnly', label: 'group.finished.goalOnly', hint: 'group.finished.goalOnly.hint' },
    ],
  },
  { key: 'approval', title: 'group.approval.title', hint: 'group.approval.hint', extras: [] },
  { key: 'question', title: 'group.question.title', hint: 'group.question.hint', extras: [] },
]

function platformName(value: string | null | undefined, t: Translate = englishTranslate): string {
  if (value === 'macos') return t('platform.macos')
  if (value === 'windows') return t('platform.windows')
  if (value === 'linux') return t('platform.linux')
  return t('platform.none')
}

export function NotifierCard({ rpc, sessions, timer, t = englishTranslate, showWebNotification }: CardDeps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [snap, setSnap] = React.useState<StateSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [presence, setPresence] = React.useState<Record<string, unknown> | null>(null)
  const [webStatus, setWebStatus] = React.useState<string | null>(null)
  const [advanced, setAdvanced] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    rpc('getState').then((v) => { if (alive) setSnap(v as StateSnapshot) }).catch((e) => { if (alive) setError(String(e)) })
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
    rpc('setConfig', patch).then((v) => setSnap(v as StateSnapshot)).catch((e) => {
      setError(String(e))
      rpc('getState').then((v) => setSnap(v as StateSnapshot)).catch(() => {})
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
        setSnap(next as StateSnapshot)
        const cfg = (next as StateSnapshot).config
        rpc('preview', { id: cfg?.finished?.soundName || 'chime' }).catch(() => {})
      }).catch((e) => {
        setError(String(e))
        rpc('getState').then((vv) => setSnap(vv as StateSnapshot)).catch(() => {})
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
    showWebNotification({
      id: Date.now(),
      title: t('web.testTitle'),
      body: t('web.testBody'),
      sessionId: currentSessionId(sessions),
    })
  }

  function webHint(): string {
    if (webStatus === 'granted') return t('web.hint.granted')
    if (webStatus === 'denied') return t('web.hint.denied')
    if (webStatus === 'unsupported') return t('web.hint.unsupported')
    return t('web.hint.default')
  }

  function presenceLine(): string {
    if (!presence) return t('presence.waiting')
    const viewingThis = presence.sessionId != null && presence.sessionId === currentSessionId(sessions)
    return t('presence.prefix')
      + (presence.focused ? t('presence.focused') : t('presence.away'))
      + ' · ' + (viewingThis ? t('presence.viewingThis') : (presence.sessionId == null ? t('presence.noSession') : t('presence.viewingOther')))
      + ' · ' + (typeof presence.ageMs === 'number' ? t('presence.ageMs', { count: presence.ageMs }) : t('presence.stale'))
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
          React.createElement('span', { className: styles.label }, t(def.title)),
          React.createElement('span', { className: styles.hint }, t(def.hint))),
        React.createElement('input', {
          type: 'checkbox', className: styles.check, checked: g.enabled, disabled: !config.enabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => sendGroup(def.key, { enabled: e.target.checked }),
        })),
      React.createElement('div', { className: styles.sub },
        def.extras.map((extra) => React.createElement('label', { className: styles.row + ' ' + styles.rowSub, key: extra.field },
          React.createElement('span', { className: styles.text },
            React.createElement('span', { className: styles.label }, t(extra.label)),
            React.createElement('span', { className: styles.hint }, t(extra.hint))),
          React.createElement('input', {
            type: 'checkbox', className: styles.check, checked: Boolean(g[extra.field]), disabled: !config.enabled || !g.enabled,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => sendGroup(def.key, { [extra.field]: e.target.checked }),
          }))),
        React.createElement('label', { className: styles.row + ' ' + styles.rowSub },
          React.createElement('span', { className: styles.text }, React.createElement('span', { className: styles.label }, t('group.playSound'))),
          React.createElement('input', {
            type: 'checkbox', className: styles.check, checked: g.sound, disabled: !config.enabled || !g.enabled,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => sendGroup(def.key, { sound: e.target.checked }),
          })),
        React.createElement('label', { className: styles.row + ' ' + styles.rowSub },
          React.createElement('span', { className: styles.text }, React.createElement('span', { className: styles.label }, t('group.sound'))),
          renderSelect(def.key))))
  }

  const header = React.createElement('button', {
    type: 'button', className: styles.header, 'aria-expanded': open ? 'true' : 'false',
    onClick: () => setOpen((v) => !v),
  },
    React.createElement('span', { className: styles.headText },
      React.createElement('span', { className: styles.name }, t('card.title')),
      React.createElement('span', { className: styles.desc }, t('card.tagline'))),
    React.createElement('span', { className: styles.chevron + (open ? ' ' + styles.chevOpen : '') }, '\u25BE'))

  let body: React.ReactNode = null
  if (open && config) {
    body = React.createElement('div', { className: styles.body },
      React.createElement('label', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, t('toggle.enable')),
          React.createElement('span', { className: styles.hint }, t('toggle.enable.hint'))),
        React.createElement('input', {
          type: 'checkbox', className: styles.check, checked: config.enabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update({ enabled: e.target.checked }),
        })),
      React.createElement('label', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, t('toggle.muteViewing')),
          React.createElement('span', { className: styles.hint }, t('toggle.muteViewing.hint'))),
        React.createElement('input', {
          type: 'checkbox', className: styles.check, checked: config.suppressFocused, disabled: !config.enabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update({ suppressFocused: e.target.checked }),
        })),
      React.createElement('div', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, t('volume.label')),
          React.createElement('span', { className: styles.hint }, t('volume.hint'))),
        React.createElement('input', {
          type: 'range', className: styles.range, min: 0, max: 100, step: 1,
          value: config.volume ?? 70, disabled: !config.enabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setVolume(e.target.value),
        }),
        React.createElement('span', { className: styles.hint }, t('volume.value', { count: config.volume ?? 70 }))),
      React.createElement('div', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, t('web.test')),
          React.createElement('span', { className: styles.hint }, webHint())),
        webStatus === 'granted'
          ? React.createElement('button', { type: 'button', className: styles.test, onClick: testWeb }, t('web.button.test'))
          : (webStatus === 'denied' || webStatus === 'unsupported')
            ? React.createElement('span', { className: styles.hint }, webStatus === 'denied' ? t('web.status.blocked') : t('web.status.unsupported'))
            : React.createElement('button', { type: 'button', className: styles.test, onClick: enableWeb }, t('web.button.enable'))),
      GROUPS.map((g) => renderGroup(g)),
      React.createElement('div', { className: styles.footer },
        error ? React.createElement('p', { className: styles.status + ' ' + styles.statusErr }, String(error)) : null,
        React.createElement('button', { type: 'button', className: styles.test, onClick: () => setAdvanced((v) => !v) }, advanced ? t('details.hide') : t('details.show')),
        advanced
          ? React.createElement('div', { className: styles.adv },
            React.createElement('p', { className: styles.status }, t('details.backend', { platform: platformName(snap?.platform, t) })),
            React.createElement('p', { className: styles.status }, presenceLine()))
          : null))
  }

  return React.createElement('li', { className: styles.card + (open ? ' ' + styles.open : '') }, header, body)
}
