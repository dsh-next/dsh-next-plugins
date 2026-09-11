/**
 * The "Notifier" settings card rendered in the `settings.plugin.item`
 * slot. Reads config over the Host RPC, persists edits, previews sounds, and
 * shows a live focus-tracking line. Every user-facing string goes through the
 * package's locale dictionaries via the injected `t` translator (English
 * unchanged without the platform locale service).
 */
import * as React from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { NotifierConfig, NotifierConfigPatch, NotifyGroup } from '../core/types.ts'
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

interface SettingsSession {
  active: boolean
  saved: StateSnapshot | null
  pending: NotifierConfigPatch[]
  volume: number | null
  previewRevision: number
  permissionPending: boolean
  tail: Promise<void>
}

/** Replay only outstanding fields over the last confirmed server snapshot. */
function optimisticSnapshot(session: SettingsSession): StateSnapshot | null {
  if (!session.saved?.config) return session.saved
  let config = session.saved.config
  for (const patch of session.pending) {
    config = {
      ...config, ...patch,
      finished: { ...config.finished, ...patch.finished },
      approval: { ...config.approval, ...patch.approval },
      question: { ...config.question, ...patch.question },
    }
  }
  if (session.volume !== null) config = { ...config, volume: session.volume }
  return { ...session.saved, config }
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
  /** Enqueue a synthetic in-page toast (the Test in-page toast button). */
  enqueueTestToast?: (event: {
    id?: number
    kind?: string
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

export function NotifierCard({ rpc, sessions, timer, t = englishTranslate, showWebNotification, enqueueTestToast }: CardDeps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [snap, setSnap] = React.useState<StateSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [presence, setPresence] = React.useState<Record<string, unknown> | null>(null)
  const [webStatus, setWebStatus] = React.useState<string | null>(null)
  const [advanced, setAdvanced] = React.useState(false)

  const settings = React.useRef<SettingsSession | null>(null)
  const volumeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    const session: SettingsSession = {
      active: true, saved: null, pending: [], volume: null,
      previewRevision: 0, permissionPending: false, tail: Promise.resolve(),
    }
    settings.current = session
    setSnap(null)
    session.tail = (async () => {
      try {
        const next = await rpc('getState') as StateSnapshot
        if (!session.active) return
        session.saved = next
        setSnap(optimisticSnapshot(session))
        setError(null)
      } catch (e) {
        if (session.active) setError(String(e))
      }
    })()
    return () => {
      session.active = false
      if (volumeTimer.current !== null) clearTimeout(volumeTimer.current)
      volumeTimer.current = null
    }
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

  function update(patch: NotifierConfigPatch, preview?: { group: 'finished' | 'approval' | 'question'; revision: number }): void {
    const session = settings.current
    if (!session?.active || !session.saved?.config) return
    session.pending.push(patch)
    setSnap(optimisticSnapshot(session))
    // Recovery reads and previews share the queue: neither can race a later save.
    session.tail = session.tail.then(async () => {
      if (!session.active) return
      let saved = false
      try {
        const next = await rpc('setConfig', patch) as StateSnapshot
        if (!session.active) return
        session.saved = next
        saved = true
        setError(null)
      } catch (e) {
        if (!session.active) return
        setError(String(e))
        try {
          const next = await rpc('getState') as StateSnapshot
          if (!session.active) return
          session.saved = next
        } catch {
          // Keep the last confirmed snapshot if the recovery read also fails.
        }
      }
      if (!session.active) return
      session.pending = session.pending.filter((pending) => pending !== patch)
      setSnap(optimisticSnapshot(session))
      if (saved && preview && preview.revision === session.previewRevision) {
        const id = session.saved?.config?.[preview.group].soundName
        if (id) {
          try { await rpc('preview', { id }) } catch (e) {
            if (session.active) setError(String(e))
          }
        }
      }
    })
  }

  function sendGroup(key: 'finished' | 'approval' | 'question', fields: Partial<NotifyGroup>): void {
    const session = settings.current
    if (!session?.active) return
    const preview = fields.soundName === undefined ? undefined : { group: key, revision: ++session.previewRevision }
    const patch: NotifierConfigPatch = { [key]: fields }
    // A sound selected during a slider drag must preview at the chosen volume.
    if (preview && session.volume !== null) {
      patch.volume = session.volume
      session.volume = null
      if (volumeTimer.current !== null) clearTimeout(volumeTimer.current)
      volumeTimer.current = null
    }
    update(patch, preview)
  }

  function setVolume(value: string | number): void {
    const session = settings.current
    if (!session?.active) return
    const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
    session.volume = v
    const revision = ++session.previewRevision
    setSnap(optimisticSnapshot(session))
    if (volumeTimer.current !== null) clearTimeout(volumeTimer.current)
    volumeTimer.current = setTimeout(() => {
      volumeTimer.current = null
      if (!session.active) return
      session.volume = null
      update({ volume: v }, { group: 'finished', revision })
    }, 600)
  }

  function enableWeb(): void {
    const session = settings.current
    if (!session?.active || session.permissionPending || typeof Notification === 'undefined') return
    session.permissionPending = true
    void (async () => {
      try {
        const status = await Notification.requestPermission()
        if (!session.active) return
        setWebStatus(status)
        await rpc('reportWebPermission', { status })
        if (session.active) setError(null)
      } catch (e) {
        if (session.active) setError(String(e))
      } finally {
        session.permissionPending = false
      }
    })()
  }

  function testWeb(): void {
    showWebNotification({
      id: Date.now(),
      title: t('web.testTitle'),
      body: t('web.testBody'),
      sessionId: currentSessionId(sessions),
    })
  }

  function testToast(): void {
    enqueueTestToast?.({
      id: Date.now(),
      title: t('toast.testTitle'),
      body: t('toast.testBody'),
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

  // The chevron is the shell's own disclosure icon (the same primitive the
  // harness PluginCard uses); the open state rotates it 180 degrees.
  const header = React.createElement('button', {
    type: 'button', className: styles.header, 'aria-expanded': open ? 'true' : 'false',
    onClick: () => setOpen((v) => !v),
  },
    React.createElement('span', { className: styles.headText },
      React.createElement('span', { className: styles.name }, t('card.title')),
      React.createElement('span', { className: styles.desc }, t('card.tagline'))),
    React.createElement(IconChevronDownOutline14, { className: styles.chevron + (open ? ' ' + styles.chevOpen : '') }))

  const errorLine = error ? React.createElement('p', { role: 'alert', className: styles.status + ' ' + styles.statusErr }, error) : null
  let body: React.ReactNode = open && errorLine ? React.createElement('div', { className: styles.body }, errorLine) : null
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
      React.createElement('div', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, t('toast.test')),
          React.createElement('span', { className: styles.hint }, t('toast.test.hint'))),
        React.createElement('button', { type: 'button', className: styles.test, onClick: testToast }, t('toast.button.test'))),
      GROUPS.map((g) => renderGroup(g)),
      React.createElement('div', { className: styles.footer },
        errorLine,
        React.createElement('button', { type: 'button', className: styles.test, onClick: () => setAdvanced((v) => !v) }, advanced ? t('details.hide') : t('details.show')),
        advanced
          ? React.createElement('div', { className: styles.adv },
            React.createElement('p', { className: styles.status }, t('details.backend', { platform: platformName(snap?.platform, t) })),
            React.createElement('p', { className: styles.status }, presenceLine()))
          : null))
  }

  return React.createElement('li', { className: styles.card + (open ? ' ' + styles.open : '') }, header, body)
}
