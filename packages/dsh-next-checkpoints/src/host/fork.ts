/**
 * Rewind fork: a live Agent on a checkpoint prefix, not a bare Session.
 * Host `sessions.fork` leaves a live session with no Agent; the next prompt
 * then tries to resume it and fails with "cannot prepare session while it is live".
 */
import type { SessionLike } from './service.ts'

/** Build a rewind-fork seed. Session start is an empty child. */
export function forkSeed<T extends { readonly seq: number }>(
  events: readonly T[],
  boundary: number,
  turn: number,
): readonly T[] {
  if (turn === 0) return []
  return events.filter((event) => event.seq <= boundary)
}

export interface AgentCreateHandle {
  readonly agent: { readonly session: SessionLike }
}

export interface AgentForkPorts {
  create(opts: Record<string, unknown>): Promise<AgentCreateHandle>
  get?(id: string): { options?: { provider?: string; model?: string } } | undefined
  defaultSelection?(): { provider: string; model: string }
  resolvePreset?(id?: string): Promise<{ id: string }>
  mountPreset?(agentCtx: unknown, id: string): Promise<void>
  newSessionId(): string
}

/** Create a promptable Agent whose log ends at the checkpoint. */
export async function createAgentFork(
  source: SessionLike,
  boundary: number,
  turn: number,
  ports: AgentForkPorts,
): Promise<SessionLike> {
  const parentId = String(source.id)
  const seed = forkSeed(source.snapshotEvents?.() ?? [], boundary, turn)
  const parent = ports.get?.(parentId)
  const fallback = ports.defaultSelection?.()
  const provider = parent?.options?.provider ?? fallback?.provider
  const model = parent?.options?.model ?? fallback?.model
  const meta: Record<string, unknown> = {
    parentSession: parentId,
    isSeeded: true,
  }
  if (source.header.cwd !== undefined && source.header.cwd !== '') meta.cwd = source.header.cwd
  if (source.header.agentPreset !== undefined) meta.agentPreset = source.header.agentPreset
  const opts: Record<string, unknown> = {
    sessionId: ports.newSessionId(),
    seed,
    inheritedEventCount: seed.length,
    meta,
  }
  if (provider !== undefined && model !== undefined) opts.agentOptions = { provider, model }
  const mountPreset = ports.mountPreset
  if (mountPreset !== undefined) {
    opts.setup = async (agentCtx: unknown) => {
      const resolved = ports.resolvePreset === undefined
        ? { id: source.header.agentPreset }
        : await ports.resolvePreset(source.header.agentPreset)
      if (resolved?.id !== undefined) await mountPreset(agentCtx, resolved.id)
    }
  }
  const handle = await ports.create(opts)
  return handle.agent.session
}
