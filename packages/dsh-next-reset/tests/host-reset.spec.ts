import { describe, expect, it, vi } from 'vitest'
import { RESET_HANDOFF } from '../src/core/handoff.ts'
import {
  executeReset,
  ResetFlight,
  USAGE,
  type ResetAgent,
  type ResetPorts,
  type ResetSession,
} from '../src/host/reset.ts'

function session(overrides: Partial<ResetSession> & { events?: { type: string }[] } = {}): ResetSession {
  const events = overrides.events ?? [{ type: 'user/message' }]
  return {
    id: overrides.id ?? 'old',
    header: { cwd: '/repo', ...overrides.header },
    snapshotEvents: () => events,
    append: overrides.append ?? vi.fn(),
  }
}

function agent(overrides: Partial<ResetAgent> = {}): ResetAgent {
  return {
    id: 'old',
    status: 'idle',
    inbox: { hasPending: false },
    session: session(),
    options: { provider: 'deepseek', model: 'v3' },
    ...overrides,
  }
}

function ports(overrides: Partial<ResetPorts> = {}): ResetPorts & { created: string[] } {
  const created: string[] = []
  const next = session({ id: 'next', events: [] })
  const live = new Map<string, ResetSession>([['next', next]])
  const base: ResetPorts = {
    webUi: true,
    create: async () => {
      created.push('next')
      return { sessionId: 'next' }
    },
    getSession: (id) => live.get(id),
    resolveWorkspaceId: async () => 'ws-1',
    titleOf: () => 'Old topic',
    rename: vi.fn(),
    selectModel: vi.fn().mockResolvedValue(undefined),
    sandboxOverride: () => 'workspace-write',
    setSandbox: vi.fn(),
    approvalOverride: () => 'never',
    setApproval: vi.fn(),
    archive: vi.fn().mockResolvedValue(undefined),
  }
  return Object.assign(base, overrides, { created })
}

describe('executeReset', () => {
  it('rejects arguments', async () => {
    const p = ports()
    await expect(executeReset(agent(), ' extra ', p)).resolves.toEqual({ kind: 'error', text: USAGE })
    expect(p.created).toEqual([])
  })

  it('rejects ACP/headless (no web UI)', async () => {
    const p = ports({ webUi: false })
    await expect(executeReset(agent(), '', p)).resolves.toMatchObject({
      kind: 'error',
      text: 'Reset is only available in the DeepSeek Harness web UI.',
    })
    expect(p.created).toEqual([])
  })

  it('rejects a running agent', async () => {
    const p = ports()
    await expect(executeReset(agent({ status: 'running' }), '', p)).resolves.toMatchObject({
      kind: 'error',
      text: /agent is running/,
    })
  })

  it('rejects a pending inbox', async () => {
    const p = ports()
    await expect(executeReset(agent({ inbox: { hasPending: true } }), '', p)).resolves.toMatchObject({
      kind: 'error',
      text: /prompt is still queued/,
    })
  })

  it('rejects a subagent session', async () => {
    const p = ports()
    await expect(executeReset(agent({
      session: session({ header: { cwd: '/repo', origin: 'subagent' } }),
    }), '', p)).resolves.toMatchObject({ kind: 'error', text: /subagent/ })
  })

  it('rejects a missing cwd', async () => {
    const p = ports()
    await expect(executeReset(agent({
      session: session({ header: { cwd: undefined } }),
    }), '', p)).resolves.toMatchObject({ kind: 'error', text: /working directory/ })
  })

  it('no-ops on an already-blank session', async () => {
    const p = ports()
    const a = agent({
      session: session({ events: [{ type: 'command/run' }, { type: 'command/done' }] }),
    })
    await expect(executeReset(a, '', p)).resolves.toEqual({
      kind: 'success',
      text: 'Already a blank session.',
    })
    expect(p.created).toEqual([])
  })

  it('creates, copies knobs, reclaims, and appends handoff without archiving old', async () => {
    const reclaim = vi.fn().mockResolvedValue(undefined)
    const create = vi.fn().mockResolvedValue({ sessionId: 'next' })
    const p = ports({ reclaim, create })
    const append = vi.fn()
    const a = agent({
      options: { provider: 'deepseek', model: 'v3', reasoningEffort: 'high' },
      session: session({ append, header: { cwd: '/repo', agentPreset: 'coder' } }),
    })
    const result = await executeReset(a, '', p)
    expect(result).toEqual({
      kind: 'success',
      text: 'Reset to a new session.',
      nextSessionId: 'next',
    })
    expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-1', agentPreset: 'coder' })
    expect(p.rename).toHaveBeenCalledWith(expect.objectContaining({ id: 'next' }), 'Old topic')
    expect(p.selectModel).toHaveBeenCalledWith({
      sessionId: 'next',
      provider: 'deepseek',
      model: 'v3',
      reasoningEffort: 'high',
    })
    expect(p.setSandbox).toHaveBeenCalledWith(expect.objectContaining({ id: 'next' }), 'workspace-write')
    expect(p.setApproval).toHaveBeenCalledWith(expect.objectContaining({ id: 'next' }), 'never')
    expect(reclaim).toHaveBeenCalledWith('old', 'next')
    expect(append).toHaveBeenCalledWith(RESET_HANDOFF, { nextSessionId: 'next' })
    expect(p.archive).not.toHaveBeenCalled()
  })

  it('creates with cwd when no workspace is registered', async () => {
    const create = vi.fn().mockResolvedValue({ sessionId: 'next' })
    const p = ports({
      create,
      resolveWorkspaceId: async () => undefined,
    })
    await executeReset(agent(), '', p)
    expect(create).toHaveBeenCalledWith({ cwd: '/repo' })
  })

  it('skips reclaim when the worktrees plugin is absent', async () => {
    const p = ports()
    delete (p as { reclaim?: unknown }).reclaim
    await expect(executeReset(agent(), '', p)).resolves.toMatchObject({ kind: 'success' })
  })

  it('archives the new blank and leaves the old session on failure', async () => {
    const p = ports({
      selectModel: vi.fn().mockRejectedValue(new Error('model down')),
    })
    const result = await executeReset(agent(), '', p)
    expect(result.kind).toBe('error')
    expect(result.text).toMatch(/left unchanged/)
    expect(p.archive).toHaveBeenCalledWith('next')
  })

  it('fail-closes when reclaim throws', async () => {
    const p = ports({
      reclaim: vi.fn().mockRejectedValue(new Error('registry locked')),
    })
    const result = await executeReset(agent(), '', p)
    expect(result.kind).toBe('error')
    expect(p.archive).toHaveBeenCalledWith('next')
  })

  it('archives next when the handoff append throws', async () => {
    const append = vi.fn(() => { throw new Error('log full') })
    const p = ports()
    const result = await executeReset(agent({ session: session({ append }) }), '', p)
    expect(result.kind).toBe('error')
    expect(p.archive).toHaveBeenCalledWith('next')
  })
})

describe('ResetFlight', () => {
  it('rejects a second /reset while the first is in flight', async () => {
    const flight = new ResetFlight()
    let resolveFirst!: (value: { kind: 'success'; text: string }) => void
    const first = flight.run('old', () => new Promise<{ kind: 'success'; text: string }>((resolve) => {
      resolveFirst = resolve
    }))
    const second = await flight.run('old', async () => ({ kind: 'success', text: 'nope' }))
    expect(second).toEqual({ kind: 'error', text: 'Reset is already in progress.' })
    resolveFirst({ kind: 'success', text: 'done' })
    await expect(first).resolves.toEqual({ kind: 'success', text: 'done' })
  })
})
