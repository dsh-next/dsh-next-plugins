/**
 * Browser-half entry for the notifier plugin — runs inside the dsh web GUI.
 *
 * Registers the "DSH Next Notifier" card in the `settings.plugin.item` slot
 * (keyed by the settings namespace), wires presence reporting and the web
 * notification drainer, and reports the browser permission to the Host.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
// Pulls the settings-plugins SlotMap merge, declaring `settings.plugin.item`
// (keyed by the settings namespace) so `slots.register` type-checks.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { NotifierCard } from './card.tsx'
import { createDrainer, showWebNotification, webPermission } from './drainer.ts'
import { createPresenceReporter } from './presence.ts'
import type { TimerLike } from '../core/timer.ts'

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

export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  const sessions = ctx.get('sessions') as ISessions | undefined
  const timer = ctx.get('timer') as TimerLike | undefined

  const send = (method: string, args?: unknown): Promise<unknown> => rpc(method, args)

  // Shared config ref: the settings card and the drainer both read the
  // notification auto-dismiss duration from it, so a slider change is honored
  // by the next drained notification without an extra round-trip.
  const configRef: { notificationSeconds: number } = { notificationSeconds: 12 }
  const onConfig = (config: { notificationSeconds?: number } | undefined): void => {
    if (config && typeof config.notificationSeconds === 'number') {
      configRef.notificationSeconds = config.notificationSeconds
    }
  }

  const presence = createPresenceReporter(sessions, timer, (m, a) => rpc(m, a))
  const drainer = createDrainer(
    sessions,
    timer,
    () => rpc('getPendingNotifications'),
    () => configRef.notificationSeconds,
  )

  // Report the web-notification permission up front and on change.
  const perm = webPermission()
  if (perm !== 'unsupported') void rpc('reportWebPermission', { status: perm }).catch(() => {})
  const offPerm = (): void => { if (webPermission() !== 'unsupported') void rpc('reportWebPermission', { status: webPermission() }).catch(() => {}) }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('focus', offPerm)
  }

  if (slots && typeof slots.register === 'function') {
    const off = slots.register(
      { name: 'settings.plugin.item', key: 'dsh-next-notifier', registrant: 'dsh-next-notifier' },
      () => React.createElement(NotifierCard, {
        rpc: send,
        sessions,
        timer,
        showWebNotification: (e, timeoutMs) => showWebNotification(e, sessions, timeoutMs),
        onConfig,
      }),
    )
    ctx.effect(() => off)
  }

  ctx.effect(() => () => {
    presence.dispose()
    drainer.dispose()
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('focus', offPerm)
    }
  })
}
