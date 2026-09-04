/**
 * Browser-half entry for the worktrees plugin — runs inside the dsh web GUI.
 *
 * Registers the `worktrees` locale namespace and two entries: the Isolated
 * toggle on the blank-session composer (`conversation.input.left`) and the
 * worktree chip on the session header (`conversation.session.header.actions`).
 *
 * Slot registration goes through a deliberately loose SlotsLike face (the
 * incumbent-proven approach): the strict register generics couple to the
 * evolving slot machinery, while the runtime contract — standard props
 * (sessionId, useSession, useInput) reaching list entries — is proven by
 * the e2e mount marker, not by types alone.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { IsolatedToggle } from './isolated-toggle.tsx'
import { WorktreeChip } from './worktree-chip.tsx'
import { en, englishTranslate, NS, zh, type MessageKey } from './dictionaries.ts'
import type {
  Rpc,
  Translate,
  WorktreeClientServices,
} from './types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'worktrees': MessageKey
  }
}

const RPC_PATH = '/dsh-next-worktrees/rpc'

/** Loose slot face (see file header). */
interface SlotsLike {
  inject(name: string, callback: () => unknown): void
  register(descriptor: Record<string, unknown>, component: unknown): unknown
}

/** Required client services (session/workspace create + focus). */
export const inject = ['slots', 'locale', 'sessions', 'workspaces'] as const

export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as unknown as SlotsLike | undefined
  const locale = ctx.get('locale')
  const services = {
    sessions: ctx.get('sessions') as WorktreeClientServices['sessions'],
    workspaces: ctx.get('workspaces') as WorktreeClientServices['workspaces'],
  } satisfies WorktreeClientServices

  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(NS, { en, zh })
      } catch {
        return () => {}
      }
    }, 'dsh-next-worktrees: dictionaries')
  }
  const t: Translate = locale !== undefined
    ? (locale.bind(NS) as Translate)
    : (englishTranslate as unknown as Translate)

  const rpc: Rpc = (method, args) =>
    fetch(RPC_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, args: args === undefined ? null : args }),
    }).then((res) => {
      if (!res.ok) throw new Error(t('error.rpc', { status: res.status }))
      return res.json()
    })

  if (slots === undefined || typeof slots.inject !== 'function') return

  slots.inject('conversation.input.left', () => slots.register(
    { name: 'conversation.input.left', id: 'dsh-next-worktrees-toggle', order: 40 },
    (props: Record<string, unknown>) => React.createElement(IsolatedToggle, {
      ...(props as object),
      rpc,
      t,
      services,
    }),
  ))

  slots.inject('conversation.session.header.actions', () => slots.register(
    { name: 'conversation.session.header.actions', id: 'dsh-next-worktrees-chip', order: 30 },
    (props: Record<string, unknown>) => React.createElement(WorktreeChip, {
      ...(props as object),
      rpc,
      t,
      services,
    }),
  ))
}
