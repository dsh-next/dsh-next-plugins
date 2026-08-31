/**
 * Browser-half entry for the Claude Code marketplace bridge — runs inside
 * the dsh web GUI.
 *
 * Registers a top-level "Claude Plugins" section in the `settings.section`
 * slot (the seat General/Models/Plugins/Skills occupy) and hands the panel
 * the Host RPC plus a workspace reader so installs can be scoped global or
 * per workspace.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
// Pulls the settings SlotMap merges — this package's client declares
// `settings.section`, so `slots.register` type-checks against the section
// registration contract.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { CcPanel } from './CcPanel.tsx'
import { extractWorkspaces } from './workspaces.ts'

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

export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  const workspaces = ctx.get('workspaces') as IWorkspaces | undefined

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
    // Skills sits at order 16; the Claude bridge right after it.
    const off = slots.register(
      { name: 'settings.section', id: 'cc-plugins', order: 17, label: 'Claude Plugins' },
      () => React.createElement(CcPanel, {
        rpc: (method: string, args?: unknown) => rpc(method, args),
        getWorkspaces,
        notifyInstalledChanged,
      }),
    )
    ctx.effect(() => off)
  }
}
