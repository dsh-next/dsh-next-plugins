/**
 * Host loader entry for the checkpoints plugin — runs in the DSH host process.
 *
 * Captures a touched-path tree at each turn/end, serves the Changes-tab RPC,
 * and rewinds files plus model-visible history in place via a surface replace.
 */
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-tools'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { absFromCwd } from './core/paths.ts'
import { DiskBlobStore } from './host/blobs.ts'
import { GitRunner } from './host/git.ts'
import { registerRpc } from './host/rpc.ts'
import { createAgentFork, type AgentForkPorts } from './host/fork.ts'
import { CheckpointsService, defaultDisk, type SessionLike } from './host/service.ts'
import { attachForkToWorkspace } from './host/workspace.ts'

export const inject = ['webServer', 'sessions'] as const

/** Tool-fs passes the execute context as the write/edit-intent actor. */
export function actorSession(actor: object | undefined): SessionLike | undefined {
  if (actor === undefined || typeof actor !== 'object') return undefined
  const rec = actor as { agent?: { session?: SessionLike }; session?: SessionLike }
  return rec.agent?.session ?? rec.session
}

export function toolSession(exec: ToolDispatchExecution): SessionLike | undefined {
  const agent = exec.agent as { session?: SessionLike } | undefined
  return agent?.session ?? actorSession(exec)
}

export function toolFilePath(exec: ToolDispatchExecution): string | undefined {
  const args = exec.arguments as { file_path?: unknown; path?: unknown } | undefined
  if (args === undefined || args === null || typeof args !== 'object') return undefined
  if (typeof args.file_path === 'string' && args.file_path !== '') return args.file_path
  if (typeof args.path === 'string' && args.path !== '') return args.path
  return undefined
}

export function apply(ctx: Context): void {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dataDir = join(dshHome, 'dsh-next-checkpoints')
  const sessions = ctx.get('sessions') as
    | { get(id: string): SessionLike | undefined }
    | undefined
  const fs = ctx.get('fs') as
    | { processPath?(target: FsTarget): string }
    | undefined
  // Same key dsh-next-worktrees provides; look up structurally, never import.
  const worktrees = ctx.get('dsh-next-worktrees') as
    | { reclaim?(from: string, to: string): Promise<unknown> }
    | undefined

  const service = new CheckpointsService({
    blobs: new DiskBlobStore(join(dataDir, 'blobs')),
    git: new GitRunner(),
    disk: defaultDisk,
    dataDir,
    now: () => Date.now(),
    getSession: (sessionId) => sessions?.get?.(sessionId),
    forkSession: (session, boundary, turn) => {
      const ports = rewindForkPorts(ctx)
      return ports === undefined ? undefined : createAgentFork(session, boundary, turn, ports)
    },
    reclaimWorktree: async (from, to) => {
      if (typeof worktrees?.reclaim !== 'function') return
      await worktrees.reclaim(from, to)
    },
    attachWorkspace: (from, to) => attachForkToWorkspace(ctx.get('workspaceRegistry'), from, to),
  })

  const noteTarget = async (
    session: SessionLike,
    target: FsTarget,
  ): Promise<void> => {
    const abs = fs?.processPath?.(target) ?? target.displayPath
    await service.noteIntent(session, String(target.targetKey), target.displayPath, abs)
  }

  ctx.effect(() => {
    const offs = [
      ctx.on('session/created', (session) => {
        service.attach(session as SessionLike)
      }, { global: true }),
      ctx.on('session/event', (session, event) => {
        service.onEvent(session as SessionLike, event as { type: string; seq: number; data?: { turn?: number } })
      }, { global: true }),
      ctx.on('agent/status', (payload) => {
        if (payload.status !== 'idle') return
        const session = (payload.agent as { session?: SessionLike }).session
        if (session !== undefined) service.onAgentIdle(session)
      }, { global: true }),
      ctx.on('fs/write-intent', async (target, actor, next) => {
        const session = actorSession(actor)
        if (session !== undefined) await noteTarget(session, target)
        return await next()
      }, { global: true }),
      ctx.on('fs/edit-intent', async (target, actor, next) => {
        const session = actorSession(actor)
        if (session !== undefined) await noteTarget(session, target)
        return await next()
      }, { global: true }),
      ctx.on('tools/execute', async (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> => {
        const session = toolSession(exec)
        if (session !== undefined) {
          if (/^(write|edit)$/i.test(exec.name)) {
            const rel = toolFilePath(exec)
            if (rel !== undefined) {
              const cwd = typeof session.header.cwd === 'string' ? session.header.cwd : ''
              const abs = rel.startsWith('/') || cwd === '' ? rel : absFromCwd(cwd, rel)
              await service.noteIntent(session, abs, rel, abs)
            }
          }
        }
        return await next()
      }, { global: true }),
    ]
    return () => {
      for (const off of offs) {
        if (typeof off === 'function') off()
      }
    }
  }, 'dsh-next-checkpoints: listeners')

  registerRpc(ctx, service)
}

function rewindForkPorts(ctx: Context): AgentForkPorts | undefined {
  const agents = ctx.get('agents') as
    | {
      create(opts: Record<string, unknown>): Promise<{ agent: { session: SessionLike } }>
      get(id: string): { options?: { provider?: string; model?: string } } | undefined
    }
    | undefined
  if (agents === undefined || typeof agents.create !== 'function') return undefined
  const defaults = ctx.get('agentDefaultModel') as
    | { currentSelection(): { provider: string; model: string } }
    | undefined
  const presets = ctx.get('agentPresets') as
    | {
      resolve(id?: string): Promise<{ id: string }>
      mount(agentCtx: unknown, id: string): Promise<void>
    }
    | undefined
  return {
    create: (opts) => agents.create(opts),
    get: (id) => agents.get?.(id),
    newSessionId: () => `session-${randomUUID()}`,
    ...defaults === undefined ? {} : { defaultSelection: () => defaults.currentSelection() },
    ...presets === undefined || typeof presets.mount !== 'function'
      ? {}
      : {
        resolvePreset: (id) => presets.resolve(id),
        mountPreset: (agentCtx, id) => presets.mount(agentCtx, id),
      },
  }
}
