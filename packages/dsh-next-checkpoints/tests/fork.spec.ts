import { describe, expect, it, vi } from 'vitest'
import { createAgentFork, forkSeed } from '../src/host/fork.ts'
import type { SessionLike } from '../src/host/service.ts'

describe('forkSeed', () => {
  const events = [
    { seq: 0, type: 'session/start' },
    { seq: 1, type: 'turn/start' },
    { seq: 4, type: 'turn/end' },
    { seq: 5, type: 'turn/start' },
    { seq: 9, type: 'turn/end' },
  ]

  it('drops every later turn when rewinding to session start', () => {
    expect(forkSeed(events, 0, 0)).toEqual([])
  })

  it('keeps the inclusive prefix through a later turn checkpoint', () => {
    expect(forkSeed(events, 4, 1).map((event) => event.seq)).toEqual([0, 1, 4])
  })
})

describe('createAgentFork', () => {
  it('creates a seeded Agent with parent cwd and model', async () => {
    const child: SessionLike = { id: 'session-child', header: { cwd: '/repo' } }
    const create = vi.fn(async (_opts: Record<string, unknown>) => ({ agent: { session: child } }))
    const source: SessionLike = {
      id: 's1',
      header: { cwd: '/repo', agentPreset: 'web' },
      snapshotEvents: () => [
        { type: 'turn/start', seq: 1 },
        { type: 'turn/end', seq: 4 },
        { type: 'turn/start', seq: 5 },
        { type: 'turn/end', seq: 9 },
      ],
    }
    const forked = await createAgentFork(source, 4, 1, {
      create,
      get: () => ({ options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }),
      newSessionId: () => 'session-child',
    })
    expect(forked).toBe(child)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-child',
      inheritedEventCount: 2,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      meta: expect.objectContaining({
        cwd: '/repo',
        parentSession: 's1',
        isSeeded: true,
        agentPreset: 'web',
      }),
    }))
    const payload = create.mock.calls[0][0] as { seed: { seq: number }[] }
    expect(payload.seed.map((event) => event.seq)).toEqual([1, 4])
  })
})
