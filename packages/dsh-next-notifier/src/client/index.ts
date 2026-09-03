/**
 * Browser-half entry for the notifier plugin — runs inside the dsh web GUI.
 *
 * Registers the "DSH Next Notifier" card in the `settings.plugin.item` slot
 * (keyed by the settings namespace), wires presence reporting and the web
 * notification drainer, and reports the browser permission to the Host.
 *
 * Localization rides the platform `locale` service: the dictionaries register
 * under this package's namespace through `register` (both locales in one
 * call), `bind` returns a stable translator reading the active locale at call
 * time, and the card title the component renders re-resolves per call.
 * Without the service the card renders English unchanged
 * (`englishTranslate`). The `settings.plugin.item` registration carries no
 * label field (the slot contract's owner props are empty — the card draws its
 * own internals), so the translated title lives inside the component.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
// Pulls the settings-plugins SlotMap merge, declaring `settings.plugin.item`
// (keyed by the settings namespace) so `slots.register` type-checks, plus the
// locale plugin's Context merge (typed `ctx.get('locale')`).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { NotifierCard, type Translate } from './card.tsx'
import { createDrainer, showWebNotification, webPermission } from './drainer.ts'
import { createPresenceReporter } from './presence.ts'
import { en, englishTranslate, NS, zh, type MessageKey } from './dictionaries.ts'
import type { TimerLike } from '../core/timer.ts'

// Merge this package's namespace into the locale namespace table: any
// compilation that also sees the locale service's declarations (the dsh web
// shell) accepts 'notifier' in its typed register/bind overloads.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'notifier': MessageKey
  }
}

const RPC_PATH = '/dsh-next-notifier/rpc'

function rpc(method: string, args?: unknown): Promise<unknown> {
  return fetch(RPC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args: args === undefined ? null : args }),
  }).then((res) => {
    if (!res.ok) throw new Error('dsh-next-notifier rpc ' + method + ' failed: HTTP ' + res.status)
    return res.json()
  })
}

// Required services (fiber inject waiting — the renderer owns the slot
// registry since 0.1.2, and the session controller applies later, so both
// must be up before the card registers and reports presence).
export const inject = ['slots', 'locale', 'sessions'] as const

export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  const sessions = ctx.get('sessions') as ISessions | undefined
  const timer = ctx.get('timer') as TimerLike | undefined

  // The optional service read goes through ctx.get (a ctx.locale property
  // access requires the service in `inject` and fails at runtime otherwise).
  const locale = ctx.get('locale')

  // Register both dictionaries under this package's namespace in one call.
  // A duplicate registration throws (aggregate bundles can double-apply); the
  // first registration's dictionaries then win.
  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(NS, { en, zh })
      } catch {
        return () => {}
      }
    }, 'dsh-next-notifier: dictionaries')
  }

  // bind returns a stable translator reading the active locale at call time;
  // without the service, English keeps the card fully functional.
  const t: Translate = locale !== undefined ? locale.bind(NS) : englishTranslate

  const send = (method: string, args?: unknown): Promise<unknown> => rpc(method, args)

  const presence = createPresenceReporter(sessions, timer, (m, a) => rpc(m, a))
  const drainer = createDrainer(sessions, timer, () => rpc('getPendingNotifications'))

  // Report the web-notification permission up front and on change.
  const perm = webPermission()
  if (perm !== 'unsupported') void rpc('reportWebPermission', { status: perm }).catch(() => {})
  const offPerm = (): void => { if (webPermission() !== 'unsupported') void rpc('reportWebPermission', { status: webPermission() }).catch(() => {}) }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('focus', offPerm)
  }

  if (slots && typeof slots.inject === 'function') {
    // settings.plugin.item is declared by the configurable-plugins tab at boot,
    // so the registration waits on that declaration through slots.inject.
    slots.inject('settings.plugin.item', () => slots.register(
      { name: 'settings.plugin.item', key: 'dsh-next-notifier', registrant: 'dsh-next-notifier' },
      () => React.createElement(NotifierCard, {
        rpc: send,
        sessions,
        timer,
        t,
        showWebNotification: (e) => showWebNotification(e, sessions),
      }),
    ))
  }

  ctx.effect(() => () => {
    presence.dispose()
    drainer.dispose()
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('focus', offPerm)
    }
  })
}
