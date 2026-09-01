/**
 * Browser-half entry for the Claude Code marketplace bridge — runs inside
 * the dsh web GUI.
 *
 * Registers a top-level "Claude Plugins" section in the `settings.section`
 * slot (the seat General/Models/Plugins/Skills occupy) and hands the panel
 * the Host RPC plus a workspace reader so installs can be scoped global or
 * per workspace.
 *
 * Localization follows the platform `locale` service pattern (the same one
 * DSH's own UI packages and the wider plugin ecosystem use): dictionaries
 * register under this package's namespace, the panel receives a bound
 * translate function reading the active locale at call time, and the
 * section label is a function label carrying the namespace so the Settings
 * shell re-renders it on language switches. Without the service the panel
 * renders English unchanged.
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

/** The locale face this entry consumes (structural, so tests can double it). */
interface LocaleFace {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string, params?: Record<string, string | number>) => string
}

/** Read the locale service defensively: compositions without it render English. */
function localeOf(ctx: Context): LocaleFace | undefined {
  // ctx.get is the only legal optional read — a ctx.locale property access
  // requires declaring the service in `inject` and fails at runtime
  // otherwise ("cannot get property without inject").
  const locale = ctx.get('locale')
  if (locale === undefined || typeof locale !== 'object') return undefined
  const face = locale as LocaleFace
  if (typeof face.register !== 'function' || typeof face.bind !== 'function') return undefined
  return face
}

/** A translator for the panel, typed to this package's dictionary keys. */
function translatorOf(ctx: Context): (key: MessageKey, params?: Record<string, string | number>) => string {
  const locale = localeOf(ctx)
  if (locale === undefined) return englishTranslate
  try {
    const bound = locale.bind(NS)
    return (key, params) => {
      try {
        // The lookup chain falls back to en then the key itself; translate
        // misses stay visible rather than blank.
        return bound(key, params)
      } catch {
        return englishTranslate(key, params)
      }
    }
  } catch {
    return englishTranslate
  }
}

export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  const workspaces = ctx.get('workspaces') as IWorkspaces | undefined

  // Register the dictionaries under this package's namespace. A duplicate
  // registration throws (aggregate bundles can double-apply); the panel
  // then simply keeps the first registration's dictionaries.
  const locale = localeOf(ctx)
  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(NS, { en, zh })
      } catch {
        return () => {}
      }
    }, 'dsh-next-cc-plugins: dictionaries')
  }

  const t = translatorOf(ctx)

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

  if (slots && typeof slots.register === 'function') {
    // Skills sits at order 16; the Claude bridge right after it. The label
    // binds at call time so a language switch re-resolves it.
    const off = slots.register(
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
    )
    ctx.effect(() => off)
  }
}
