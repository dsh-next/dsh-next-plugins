import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { NotifierSettings } from './card.tsx'
import { PresenceView } from './PresenceView.tsx'
import { showWebNotification, type WebNotificationHandle } from './drainer.ts'
import { createPresenceReporter, currentSessionId } from './presence.ts'
import { createRpc } from './rpc.ts'
import { createAudioPlayer } from './audio.ts'
import { ToastLayer, enqueueTestToast } from './toasts.tsx'
import { en, englishTranslate, NS, zh, type MessageKey } from './dictionaries.ts'
import type { TimerLike } from '../core/timer.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { notifier: MessageKey }
}

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'configForms', 'layout', 'timer'] as const

export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  const sessions = ctx.get('sessions') as ISessions | undefined
  const navigation = ctx.get('uiWorkspace')
  const timer = ctx.get('timer') as TimerLike | undefined
  const locale = ctx.get('locale')
  if (locale) ctx.effect(() => locale.register(NS, { en, zh }))
  const t = locale?.bind(NS) ?? englishTranslate
  const transport = createRpc('/dsh-next-notifier/rpc', t)
  const presence = createPresenceReporter(sessions, timer, transport.request)
  const audio = createAudioPlayer()
  const rpc = (method: string, args?: unknown): Promise<unknown> => {
    if (method === 'getPendingNotifications') return transport.request(method, presence.snapshot())
    return transport.request(method, { ...(args && typeof args === 'object' ? args : {}), clientId: presence.clientId })
  }
  const web = new Set<WebNotificationHandle>()
  const testSystem = async (): Promise<boolean> => {
    const handle = showWebNotification({ id: Date.now(), title: t('web.testTitle'), body: t('web.testBody'),
      sessionId: currentSessionId(sessions) }, sessions, () => { if (handle) web.delete(handle) }, t, navigation)
    if (!handle) return false
    web.add(handle)
    return handle.shown
  }
  const testToast = (): void => enqueueTestToast({ title: t('toast.testTitle'), body: t('toast.testBody'),
    sessionId: currentSessionId(sessions) })

  const form = ctx.get('configForms')!.get<Record<string, unknown>>('dsh-next-notifier')
  slots.inject('plugins.bundle.config', () => slots.register({
    name: 'plugins.bundle.config', key: '@dsh-next/dsh-next-notifier', locale: NS,
  }, () => React.createElement(NotifierSettings, { form, t, preview: audio.play,
    testSystem, testToast, reportPermission: presence.report })))
  slots.inject('shell.overlay', () => slots.register({
    name: 'shell.overlay', id: 'dsh-next-notifier-toasts', order: 10, label: () => t('toast.layerLabel'),
  }, ({ usePanelInfo }: { usePanelInfo: UsePanelInfo }) => React.createElement(PresenceView, { usePanelInfo, onChange: presence.setPanelActive,
    children: React.createElement(ToastLayer, { rpc, sessions, navigation, timer, t, playSound: audio.play }) })))

  ctx.effect(() => () => {
    presence.dispose()
    transport.dispose()
    audio.dispose()
    for (const handle of web) handle.close()
  })
}
