/**
 * Host `/reset` use-case: reincarnate into a blank session in the same
 * folder. The GUI switch is a client job; this half must not archive the
 * current row.
 */
import { sessionIsBlank } from '../core/blank.ts'
import { RESET_HANDOFF } from '../core/handoff.ts'

export const USAGE = 'Usage: /reset (no arguments)'

export interface ResetAgent {
  readonly id: string
  readonly status: 'idle' | 'running'
  readonly inbox: { readonly hasPending: boolean }
  readonly session: ResetSession
  readonly options: {
    readonly provider?: string
    readonly model?: string
    readonly reasoningEffort?: string
  }
}

export interface ResetSession {
  readonly id: string
  readonly header: {
    readonly cwd?: string
    readonly origin?: 'subagent'
    readonly agentPreset?: string
  }
  snapshotEvents(): readonly { readonly type: string }[]
  append(type: string, data: unknown): unknown
}

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'ask' | 'never'

export interface ResetPorts {
  readonly webUi: boolean
  create(input: {
    workspaceId?: string
    cwd?: string
    agentPreset?: string
  }): Promise<{ sessionId: string }>
  getSession(id: string): ResetSession | undefined
  resolveWorkspaceId(cwd: string): Promise<string | undefined>
  titleOf(session: ResetSession): string | undefined
  rename(session: ResetSession, title: string): void
  selectModel(input: {
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<void>
  sandboxOverride(session: ResetSession): SandboxMode | undefined
  setSandbox(session: ResetSession, mode: SandboxMode): void
  approvalOverride(session: ResetSession): ApprovalPolicy | undefined
  setApproval(session: ResetSession, policy: ApprovalPolicy): void
  reclaim?(from: string, to: string): Promise<void>
  archive(sessionId: string): Promise<void>
}

export type ResetOutcome =
  | { readonly kind: 'success'; readonly text: string; readonly nextSessionId?: string }
  | { readonly kind: 'error'; readonly text: string }

/** Single-flight so two `/reset`s cannot mint two blanks. */
export class ResetFlight {
  private readonly active = new Set<string>()

  run(sessionId: string, task: () => Promise<ResetOutcome>): Promise<ResetOutcome> {
    if (this.active.has(sessionId)) {
      return Promise.resolve({ kind: 'error', text: 'Reset is already in progress.' })
    }
    this.active.add(sessionId)
    const op = task()
    const retire = (): void => { this.active.delete(sessionId) }
    void op.then(retire, retire)
    return op
  }
}

/** Execute one `/reset` against the receiving agent. */
export async function executeReset(
  agent: ResetAgent,
  rawInput: string,
  ports: ResetPorts,
): Promise<ResetOutcome> {
  if (rawInput.trim() !== '') return { kind: 'error', text: USAGE }
  if (!ports.webUi) {
    return { kind: 'error', text: 'Reset is only available in the DeepSeek Harness web UI.' }
  }
  if (agent.status === 'running') {
    return { kind: 'error', text: 'Reset is unavailable because the agent is running.' }
  }
  if (agent.inbox.hasPending) {
    return { kind: 'error', text: 'Reset is unavailable because a prompt is still queued.' }
  }
  if (agent.session.header.origin === 'subagent') {
    return { kind: 'error', text: 'Reset cannot run in a subagent session.' }
  }
  const cwd = agent.session.header.cwd
  if (cwd === undefined || cwd === '') {
    return { kind: 'error', text: 'Reset needs a working directory on this session.' }
  }
  if (sessionIsBlank(agent.session.snapshotEvents())) {
    return { kind: 'success', text: 'Already a blank session.' }
  }

  const created = await ports.create({
    ...(await createLocation(cwd, ports)),
    ...(agent.session.header.agentPreset !== undefined
      ? { agentPreset: agent.session.header.agentPreset }
      : {}),
  })
  const nextId = created.sessionId
  let published = false
  try {
    const next = ports.getSession(nextId)
    if (next === undefined) {
      throw new Error(`created session "${nextId}" is not live`)
    }
    await copyKnobs(agent, next, ports)
    if (ports.reclaim !== undefined) await ports.reclaim(agent.id, nextId)
    agent.session.append(RESET_HANDOFF, { nextSessionId: nextId })
    published = true
    return { kind: 'success', text: 'Reset to a new session.', nextSessionId: nextId }
  } catch (error) {
    // Once handoff is on the old log the client may already have switched;
    // do not archive the session they are about to open.
    if (!published) {
      await ports.archive(nextId).catch(() => { /* fail-closed: leave the old session */ })
    }
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: `Reset failed; the current session was left unchanged (${message}).` }
  }
}

async function createLocation(
  cwd: string,
  ports: ResetPorts,
): Promise<{ workspaceId: string } | { cwd: string }> {
  const workspaceId = await ports.resolveWorkspaceId(cwd)
  return workspaceId !== undefined ? { workspaceId } : { cwd }
}

async function copyKnobs(
  agent: ResetAgent,
  next: ResetSession,
  ports: ResetPorts,
): Promise<void> {
  const title = ports.titleOf(agent.session)
  if (title !== undefined && title !== '') ports.rename(next, title)
  const { provider, model, reasoningEffort } = agent.options
  if (provider !== undefined && provider !== '' && model !== undefined && model !== '') {
    await ports.selectModel({
      sessionId: next.id,
      provider,
      model,
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    })
  }
  const sandbox = ports.sandboxOverride(agent.session)
  if (sandbox !== undefined) ports.setSandbox(next, sandbox)
  const approval = ports.approvalOverride(agent.session)
  if (approval !== undefined) ports.setApproval(next, approval)
}
