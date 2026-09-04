/**
 * Host loader entry for the worktrees plugin — runs in the DSH host process.
 *
 * Wires the git runner and registry store into the orchestration service
 * and serves the same-origin RPC route. DSH touchpoints are exactly two
 * ports: session-cwd lookup through the session store, and the canonical
 * sandbox-knob writer (`setSandboxMode`) — the write that makes git usable
 * inside a linked worktree (proven in
 * docs/archive/2026-09-04-worktrees-m0-probe.md).
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Merges the host-side `sessions` service declaration (ctx.sessions).
import type {} from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { GitRunner } from './host/git.ts'
import { RegistryStore } from './host/registry-store.ts'
import {
  WorktreesService,
  type ApplySandboxMode,
  type GetSessionCwd,
} from './host/service.ts'
import { registerRpc } from './host/rpc.ts'

export const inject = ['webServer', 'sessions'] as const

export function apply(ctx: Context): void {
  const git = new GitRunner()
  const store = new RegistryStore()

  // The session store's keyed lookup takes a branded SessionId; the RPC
  // boundary deals in plain strings, so retype the face once, locally.
  const sessions = ctx.get('sessions') as unknown as
    | { get(id: string): { header: { cwd: string } } | undefined }
    | undefined

  const getSessionCwd: GetSessionCwd = (sessionId) => {
    const session = sessions?.get?.(sessionId)
    return session && typeof session.header?.cwd === 'string' ? session.header.cwd : null
  }

  const applySandboxMode: ApplySandboxMode = (sessionId, mode) => {
    const session = sessions?.get?.(sessionId)
    if (!session) return false
    try {
      // The retyped lookup face loses the full Session type; the knob
      // writer only reads the header and appends events.
      setSandboxMode(session as Parameters<typeof setSandboxMode>[0], mode)
      return true
    } catch {
      return false
    }
  }

  const service = new WorktreesService({
    git,
    store,
    getSessionCwd,
    applySandboxMode,
    copyFile: async (from, to) => {
      try {
        await mkdir(dirname(to), { recursive: true })
        await copyFile(from, to)
      } catch {
        // Best-effort convention: a missing source copies nothing.
      }
    },
  })
  registerRpc(ctx, service)
}
