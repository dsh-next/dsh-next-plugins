/**
 * Browser-half entry for the skills manager — runs inside the dsh web GUI.
 *
 * Registers a top-level "Skills" section in the `settings.section` slot (the
 * seat General/Models/Plugins occupy — the panel gets the whole settings
 * content column instead of a cramped plugin card) and hands it the Host RPC
 * plus a workspace reader so installs and toggles can be scoped per
 * workspace.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
// Pulls the settings SlotMap merges — this package's client declares both
// `settings.section` (the main settings nav) and `settings.plugin.item`, so
// `slots.register` type-checks against the section registration contract.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { SkillsPanel } from './SkillsPanel.tsx'
import { extractWorkspaces } from './workspaces.ts'

const RPC_PATH = '/dsh-next-skills/rpc'

function rpc(method: string, args?: unknown): Promise<unknown> {
  return fetch(RPC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args: args === undefined ? null : args }),
  }).then((res) => {
    if (res.ok) return res.json()
    // Prefer the server's JSON `{ error }` message so business failures surface
    // readable text; fall back to a generic HTTP status when the body is not JSON.
    return res.json()
      .then((body) => {
        const msg = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `HTTP ${res.status}`
        throw new Error(msg)
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message !== '') throw error
        throw new Error('dsh-next-skills rpc ' + method + ' failed: HTTP ' + res.status)
      })
  })
}

export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  const workspaces = ctx.get('workspaces') as IWorkspaces | undefined

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

  if (slots && typeof slots.register === 'function') {
    // The Plugins section registers at order 15; Skills sits right after it.
    const off = slots.register(
      { name: 'settings.section', id: 'skills', order: 16, label: 'Skills' },
      () => React.createElement(SkillsPanel, {
        rpc: (method: string, args?: unknown) => rpc(method, args),
        getWorkspaces,
        notifyInstalledChanged,
      }),
    )
    ctx.effect(() => off)
  }
}
