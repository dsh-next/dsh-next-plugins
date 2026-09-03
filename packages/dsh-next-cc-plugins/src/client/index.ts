/**
 * Browser-half entry for the Claude Code marketplace bridge — runs inside
 * the dsh web GUI.
 *
 * Registers a top-level "Claude Plugins" section in the `settings.section`
 * slot (the seat General/Models/Plugins/Skills occupy) and hands the panel
 * the Host RPC plus a workspace reader so installs can be scoped global or
 * per workspace.
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
// `settings.section`, so `slots.register` type-checks against the section
// registration contract.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { CcPanel } from './CcPanel.tsx'
import { en, englishTranslate, NS, zh, type MessageKey } from './dictionaries.ts'
import { extractWorkspaces } from './workspaces.ts'

// Merge this package's namespace into the locale namespace table: the
// settings.section slot's `locale` field and the typed register/bind
// overloads then accept it (the same declaration DSH's own UI packages use).
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'cc-plugins': MessageKey
  }
}

const RPC_PATH = '/dsh-next-cc-plugins/rpc'

function rpc(method: string, args?: unknown): Promise<unknown> {
  return fetch(RPC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args: args === undefined ? null : args }),
  }).then((res) => {
    if (res.ok) return res.json()
    // Prefer the server's JSON `{ error }` message so business failures
    // surface readable text; fall back to a generic HTTP status.
    return res.json()
      .then((body) => {
        const msg = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `HTTP ${res.status}`
        throw new Error(msg)
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message !== '') throw error
        throw new Error('dsh-next-cc-plugins rpc ' + method + ' failed: HTTP ' + res.status)
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
    }, 'dsh-next-cc-plugins: dictionaries')
  }

  // bind returns a stable translator reading the active locale at call time;
  // without the service, English keeps the panel fully functional.
  const t = locale !== undefined ? locale.bind(NS) : englishTranslate

  const getWorkspaces = () => extractWorkspaces(workspaces)

  // Skills installed through this panel land in roots the client caches per
  // session until the connection resets; emit the same signal the client
  // runtime emits on (re)connect so every store refetches now.
  const notifyInstalledChanged = (): void => {
    try {
      ;(ctx as { emit?: (event: string) => void }).emit?.('connection/reset')
    } catch {
      // A broken event bus must never break the mutation itself.
    }
  }

  if (slots && typeof slots.inject === 'function') {
    // Skills sits at order 16; the Claude bridge right after it. The label
    // binds at call time so a language switch re-resolves it. The
    // settings.section slot is declared by the settings shell at boot, so the
    // registration waits on that declaration through slots.inject.
    slots.inject('settings.section', () => slots.register(
      {
        name: 'settings.section',
        id: 'cc-plugins',
        order: 17,
        label: () => t('nav'),
        locale: NS,
      },
      () => React.createElement(CcPanel, {
        rpc: (method: string, args?: unknown) => rpc(method, args),
        getWorkspaces,
        notifyInstalledChanged,
        t,
      }),
    ))
  }
}
