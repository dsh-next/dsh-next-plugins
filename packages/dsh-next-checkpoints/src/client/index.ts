/**
 * Browser-half entry: registers the Changes conversation view and locales.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ChangesView } from './ChangesView.tsx'
import { en, englishTranslate, NS, zh, type MessageKey } from './dictionaries.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'checkpoints': MessageKey
  }
}

export const inject = ['slots', 'locale', 'sessions'] as const

export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  const locale = ctx.get('locale')

  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(NS, { en, zh })
      } catch {
        return () => {}
      }
    }, 'dsh-next-checkpoints: dictionaries')
  }

  const t = locale !== undefined ? locale.bind(NS) : englishTranslate

  if (slots && typeof slots.inject === 'function') {
    ctx.effect(() => {
      const off = slots.inject('conversation.view', () => slots.register(
        {
          name: 'conversation.view',
          id: 'changes',
          order: 20,
          locale: NS,
          label: () => t('view.changes'),
          inject: (sessionId: string) => {
            const sessions = ctx.get('sessions') as
              | { open(id: string): void }
              | undefined
            const workspaces = ctx.get('workspaces') as
              | { archiveSession?(id: string): Promise<void> }
              | undefined
            return {
              sessionId,
              t,
              openSession: (id: string) => { sessions?.open(id) },
              archiveSession: (id: string) => workspaces?.archiveSession?.(id),
            }
          },
        },
        ChangesView,
      ))
      return typeof off === 'function' ? off : () => {}
    }, 'dsh-next-checkpoints: changes view')
  }
}
