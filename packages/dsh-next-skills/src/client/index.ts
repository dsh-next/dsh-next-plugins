/**
 * Browser-half entry for the skills manager — runs inside the dsh web GUI.
 *
 * Registers a top-level "Skills" section in the `settings.section` slot (the
 * seat General/Models/Plugins occupy — the panel gets the whole settings
 * content column instead of a cramped plugin card) and hands it the Host RPC
 * plus a workspace reader so installs and toggles can be scoped per
 * workspace.
 *
 * Localization rides the platform `locale` service and nothing else: the
 * dictionaries register under this package's namespace through the typed
 * `register` (both locales in one compile-checked call — see
 * `dictionaries.ts`), `bind` returns a stable translator reading the active
 * locale at call time (lookup chain: this namespace -> en -> the shared
 * common vocabulary -> the key itself), and the section label is a function
 * label carrying the namespace so the Settings shell re-renders it on
 * language switches. Without the service the panel renders English
 * unchanged (`englishTranslate`).
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// settings SlotMap merges — this package's client declares
// `settings.section` (the main settings nav), so `slots.register`
// type-checks against the section registration contract.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { SkillsPanel } from './SkillsPanel.tsx'
import { en, englishTranslate, NS, zh, type MessageKey } from './dictionaries.ts'
import { extractWorkspaces } from './workspaces.ts'

// Merge this package's namespace into the locale namespace table: the
// settings.section slot's `locale` field and the typed register/bind
// overloads then accept it (the same declaration DSH's own UI packages use).
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'skills': MessageKey
  }
}

const RPC_PATH = '/dsh-next-skills/rpc'

function rpc(method: string, args: unknown | undefined, t: (key: MessageKey, params?: Record<string, string | number>) => string): Promise<unknown> {
  return fetch(RPC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args: args === undefined ? null : args }),
  }).then((res) => {
    if (res.ok) return res.json()
    // Prefer the server's JSON `{ error }` message so business failures surface
    // readable text; fall back to a localized HTTP status when the body is not JSON.
    return res.json()
      .then((body) => {
        const msg = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : t('rpc.failed', { method, status: res.status })
        throw new Error(msg)
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message !== '') throw error
        throw new Error(t('rpc.failed', { method, status: res.status }))
      })
  })
}

// Required services (fiber inject waiting — the renderer owns the slot
// registry since 0.1.2, and the workspace controller applies later, so both
// must be up before the section registers and reads the workspace list).
export const inject = ['slots', 'locale', 'workspaces'] as const

export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  const workspaces = ctx.get('workspaces') as IWorkspaces | undefined

  // The optional service read goes through ctx.get — a ctx.locale property
  // access requires the service in `inject` and fails at runtime otherwise.
  const locale = ctx.get('locale')

  // Register both dictionaries under this package's namespace in one typed
  // call (the LocaleNamespaceMap entry above makes the key set compile-
  // checked; the platform enforces bilingual balance and single ownership).
  // A duplicate registration throws (aggregate bundles can double-apply);
  // the first registration's dictionaries then win.
  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(NS, { en, zh })
      } catch {
        return () => {}
      }
    }, 'dsh-next-skills: dictionaries')
  }

  // bind returns a stable translator reading the active locale at call time;
  // without the service, English keeps the panel fully functional.
  const t = locale !== undefined ? locale.bind(NS) : englishTranslate

  const getWorkspaces = () => extractWorkspaces(workspaces)

  // The core UI caches each session's skill catalog until the connection
  // resets, so a skill removed through this panel would still show up in the
  // composer's "/" menu of every later "new" chat in the same page. Emit the
  // same signal the client runtime emits on (re)connect: every store that
  // caches session-scoped data treats it as "refetch now" — the skill source
  // included. Listeners only do background refetches, nothing destructive.
  const notifyInstalledChanged = (): void => {
    try {
      ;(ctx as { emit?: (event: string) => void }).emit?.('connection/reset')
    } catch {
      // A broken event bus must never break the mutation itself.
    }
  }

  if (slots && typeof slots.inject === 'function') {
    // The Plugins section registers at order 15; Skills sits right after it.
    // The label binds at call time so a language switch re-resolves it. The
    // settings.section slot is declared by the settings shell at boot, so the
    // registration waits on that declaration through slots.inject (the shell's
    // own settings pages use the same pattern).
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'skills', order: 16, label: () => t('nav'), locale: NS },
      () => React.createElement(SkillsPanel, {
        rpc: (method: string, args?: unknown) => rpc(method, args, t),
        getWorkspaces,
        notifyInstalledChanged,
        t,
      }),
    ))
  }
}
