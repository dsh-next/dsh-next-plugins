/**
 * Host loader entry for the reset plugin — runs in the DSH host process.
 *
 * Registers `/reset`. The handler reincarnates: create a blank session in
 * the same folder, copy knobs, optionally reclaim a plugin worktree, append
 * `reset/handoff` on the old log. It does not archive the current row and
 * does not switch the GUI (`sessions.open` is browser-only).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { RESET_HANDOFF, WORKTREES_SERVICE_KEY } from './core/handoff.ts'
import {
  executeReset,
  ResetFlight,
  type ApprovalPolicy,
  type ResetAgent,
  type ResetPorts,
  type ResetSession,
  type SandboxMode,
} from './host/reset.ts'

export const inject = ['commands'] as const

interface WorktreesReclaim {
  reclaim(from: string, to: string): Promise<unknown>
}

/** Loose `ctx.get` so optional collaborators type-check without extra injects. */
function getNamed(ctx: Context, name: string): unknown {
  return (ctx.get as (key: string) => unknown).call(ctx, name)
}

/** Apply the host half. */
export function apply(ctx: Context): void {
  ;(KNOWN_SESSION_EVENT_TYPES as Set<string>).add(RESET_HANDOFF)
  const flight = new ResetFlight()
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'reset',
      description: 'Start a blank session in this folder and archive the current one',
      handler: (invocation) => flight.run(String(invocation.agent.id), () =>
        executeReset(invocation.agent as unknown as ResetAgent, invocation.rawInput, portsFor(ctx))),
    })
  }, 'dsh-next-reset: command')
}

function portsFor(ctx: Context): ResetPorts {
  return {
    webUi: getNamed(ctx, 'webServer') !== undefined && getNamed(ctx, 'sessionController') !== undefined,
    create: async (input) => {
      const controller = getNamed(ctx, 'sessionController') as
        | { create(input: unknown): Promise<{ sessionId: string }> }
        | undefined
      if (controller === undefined || typeof controller.create !== 'function') {
        throw new Error('session controller is unavailable')
      }
      return controller.create(input)
    },
    getSession: (id) => {
      const sessions = getNamed(ctx, 'sessions') as
        | { get(id: string): ResetSession | undefined }
        | undefined
      return sessions?.get?.(id)
    },
    resolveWorkspaceId: async (cwd) => {
      const registry = getNamed(ctx, 'workspaceRegistry') as
        | { resolveByPath(cwd: string): Promise<{ id: string } | undefined> }
        | undefined
      if (registry === undefined || typeof registry.resolveByPath !== 'function') return undefined
      const workspace = await registry.resolveByPath(cwd)
      return workspace?.id
    },
    titleOf: (session) => {
      const titles = getNamed(ctx, 'sessionTitle') as
        | { get(session: ResetSession): { title: string } | undefined }
        | undefined
      return titles?.get?.(session)?.title
    },
    rename: (session, title) => {
      const titles = getNamed(ctx, 'sessionTitle') as
        | { rename(session: ResetSession, title: string): void }
        | undefined
      titles?.rename?.(session, title)
    },
    selectModel: async (input) => {
      const controller = getNamed(ctx, 'sessionController') as
        | { selectModel(input: unknown): Promise<void> }
        | undefined
      if (controller === undefined || typeof controller.selectModel !== 'function') return
      await controller.selectModel(input)
    },
    sandboxOverride: (session) => {
      const policy = getNamed(ctx, 'sandboxPolicy') as
        | { overrideOf(session: ResetSession): SandboxMode | undefined }
        | undefined
      return policy?.overrideOf?.(session)
    },
    setSandbox: (session, mode) => {
      setSandboxMode(session as Parameters<typeof setSandboxMode>[0], mode)
    },
    approvalOverride: (session) => {
      const approval = getNamed(ctx, 'approval') as
        | { overrideOf(session: ResetSession): ApprovalPolicy | undefined }
        | undefined
      return approval?.overrideOf?.(session)
    },
    setApproval: (session, policy) => {
      setApprovalPolicy(session as Parameters<typeof setApprovalPolicy>[0], policy)
    },
    reclaim: async (from, to) => {
      const worktrees = getNamed(ctx, WORKTREES_SERVICE_KEY) as WorktreesReclaim | undefined
      if (worktrees === undefined || typeof worktrees.reclaim !== 'function') return
      await worktrees.reclaim(from, to)
    },
    archive: async (sessionId) => {
      const registry = getNamed(ctx, 'workspaceRegistry') as
        | { archiveSession(sessionId: string): Promise<void> }
        | undefined
      if (registry === undefined || typeof registry.archiveSession !== 'function') return
      await registry.archiveSession(sessionId)
    },
  }
}
