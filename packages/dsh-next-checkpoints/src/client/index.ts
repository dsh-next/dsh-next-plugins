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

/** The workspace-navigation face that shows an existing session. */
interface UiWorkspaceLike {
  openSession(sessionId: string): void
}

/** The pre-0.1.6 session face, kept as a fallback for older hosts. */
interface LegacySessionsLike {
  open?(sessionId: string): void
}

/**
 * Resolve how to show a session this plugin already created.
 *
 * The live client navigates through `uiWorkspace.openSession`; `sessions.open`
 * was removed from the session service, so it is only a fallback for older
 * hosts. Undefined means the host cannot navigate at all, and the caller omits
 * the action rather than switching nothing.
 *
 * @param ctx - the client context.
 * @returns the navigation call, or undefined when the host cannot navigate.
 */
export function makeSessionOpener(ctx: Context): ((sessionId: string) => void) | undefined {
  const navigation = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
  if (navigation !== undefined && typeof navigation.openSession === 'function') {
    return (sessionId: string) => navigation.openSession(sessionId)
  }
  const legacy = ctx.get('sessions') as LegacySessionsLike | undefined
  if (legacy !== undefined && typeof legacy.open === 'function') {
    return (sessionId: string) => legacy.open?.(sessionId)
  }
  return undefined
}

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
            const workspaces = ctx.get('workspaces') as
              | { archiveSession?(id: string): Promise<void> }
              | undefined
            const openSession = makeSessionOpener(ctx)
            return {
              sessionId,
              t,
              ...(openSession === undefined ? {} : { openSession }),
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
