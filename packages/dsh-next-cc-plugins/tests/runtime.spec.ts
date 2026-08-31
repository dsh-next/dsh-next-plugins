/**
 * Runtime bridge integration: slash-command registration from the cached
 * plugin files, the command handler's model-visible submission, and the
 * hook listeners' allow/deny decisions over the tools waterfalls. Uses a
 * structural Cordis double plus the in-memory FsLike-backed Store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { FetchLike } from '../src/core/types.ts'
import { CcRuntime } from '../src/host/runtime.ts'
import { Store } from '../src/host/store.ts'
import type { HookRunner, HookRunOutcome } from '../src/host/hook-runner.ts'
import { createMemFs, type MemFs } from './helpers/memfs.ts'

interface RegisteredCommand {
  name: string
  description: string
  handler: (invocation: {
    commandId: unknown
    rawInput: string
    agent: { followup: (message: unknown) => void }
    attachments: readonly unknown[]
    signal: AbortSignal
  }) => unknown | Promise<unknown>
}

type EventHandler = (...args: unknown[]) => Promise<unknown>

function makeFakeCtx(): {
  ctx: Context
  commands: RegisteredCommand[]
  handlers: Map<string, EventHandler>
  disposers: Array<() => void>
  effectCleanups: Array<() => void>
} {
  const commands: RegisteredCommand[] = []
  const handlers = new Map<string, EventHandler>()
  const disposers: Array<() => void> = []
  const effectCleanups: Array<() => void> = []
  const ctx = {
    commands: {
      register: (definition: RegisteredCommand) => {
        commands.push(definition)
        return () => { const i = commands.indexOf(definition); if (i >= 0) commands.splice(i, 1) }
      },
    },
    on: (event: string, handler: EventHandler) => {
      handlers.set(event, handler)
      const off = () => { handlers.delete(event) }
      disposers.push(off)
      return off
    },
    effect: (fn: () => () => void) => {
      effectCleanups.push(fn())
      return () => { /* covered by the captured cleanup */ }
    },
    logger: { warn: vi.fn() },
  } as unknown as Context
  return { ctx, commands, handlers, disposers, effectCleanups }
}

const FILES: Record<string, string> = {
  'commands/ship.md': '---\ndescription: Ship it\n---\nShip $ARGUMENTS to production.',
  'commands/Review.md': '---\ndescription: Review\n---\nReview everything.',
  'hooks/hooks.json': JSON.stringify({
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: 'log.sh' }] }],
  }),
}

interface Fixture {
  fs: MemFs
  store: Store
  fake: ReturnType<typeof makeFakeCtx>
  hookRuns: Array<{ command: string; payload: string; pluginRoot: string }>
  runHook: HookRunner & ReturnType<typeof vi.fn>
  /** Set the hook outcome while keeping the run-recording implementation. */
  setOutcome: (outcome: HookRunOutcome) => void
  runtime: CcRuntime
}

function makeFixture(config: { commands?: boolean; hooks?: boolean } = {}): Fixture {
  const fs = createMemFs()
  const store = new Store({ fs, fetch: (async () => { throw new Error('no network in tests') }) as FetchLike, root: '/home/u/.dsh/cc-plugins', home: '/home/u' })
  const fake = makeFakeCtx()
  const hookRuns: Fixture['hookRuns'] = []
  const record = (args: { command: string; payload: string; pluginRoot: string }) => {
    hookRuns.push({ command: args.command, payload: args.payload, pluginRoot: args.pluginRoot })
  }
  const runHook = vi.fn<HookRunner>(async (args) => {
    record(args)
    return { code: 0, stdout: '', stderr: '', timedOut: false } satisfies HookRunOutcome
  })
  const setOutcome = (outcome: HookRunOutcome) => {
    runHook.mockImplementation(async (args) => {
      record(args)
      return outcome
    })
  }
  const runtime = new CcRuntime({
    store,
    config: { commands: config.commands !== false, hooks: config.hooks === true },
    runHook,
    pluginRoot: (key) => `/home/u/.dsh/cc-plugins/plugins/${key.replace(/[^A-Za-z0-9_.-]+/g, '_')}`,
    pluginData: (key) => `/home/u/.dsh/cc-plugins/data/${key.replace(/[^A-Za-z0-9_.-]+/g, '_')}`,
  })
  return { fs, store, fake, hookRuns, runHook, setOutcome, runtime }
}

async function seedInstalled(store: Store, files: Record<string, string> = FILES): Promise<void> {
  await store.saveInstalled({
    plugins: [{
      key: 'github:o/r/team-tools',
      marketplaceId: 'github:o/r',
      marketplaceSpec: 'o/r',
      pluginName: 'team-tools',
      version: '1.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      scope: 'global',
      skills: [],
      mcpServers: [],
      agents: [],
      pending: { commands: ['ship'], hookEvents: ['PreToolUse', 'PostToolUse'] },
    }],
  })
  await store.saveCachedPluginFiles('github:o/r', 'team-tools', files)
}

const SIGNAL = new AbortController().signal

describe('CcRuntime commands', () => {
  let f: Fixture
  beforeEach(() => { f = makeFixture() })

  it('registers slash commands from the cached plugin files', async () => {
    await seedInstalled(f.store)
    f.runtime.attach(f.fake.ctx)
    await vi.waitFor(() => expect(f.fake.commands.map((c) => c.name)).toEqual(['cc-team-tools-review', 'ship']))
    expect(f.fake.commands.find((c) => c.name === 'ship')?.description).toBe('Ship it')
  })

  it('the handler expands $ARGUMENTS and submits a user turn to the agent', async () => {
    await seedInstalled(f.store)
    f.runtime.attach(f.fake.ctx)
    await vi.waitFor(() => expect(f.fake.commands.length).toBe(2))
    const ship = f.fake.commands.find((c) => c.name === 'ship')!
    const followup = vi.fn()
    const result = await ship.handler({
      commandId: 'c1',
      rawInput: ' --fast ',
      agent: { followup },
      attachments: [],
      signal: SIGNAL,
    })
    expect(result).toEqual({ kind: 'success', text: 'submitted /ship prompt to the agent' })
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0][0] as { role: string; content: Array<{ type: string; text: string }>; source: { kind: string } }
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'user' })
    expect(message.content[0]).toEqual({ type: 'text', text: 'Ship --fast to production.' })
  })

  it('re-registers after refresh (install flow) and disposes cleanly', async () => {
    f.runtime.attach(f.fake.ctx)
    await f.runtime.refresh()
    expect(f.fake.commands).toEqual([])
    await seedInstalled(f.store)
    await f.runtime.refresh()
    expect(f.fake.commands.length).toBe(2)
    f.fake.effectCleanups[0]()
    expect(f.fake.commands).toEqual([])
  })

  it('registers nothing while commands are disabled', async () => {
    const disabled = makeFixture({ commands: false })
    await seedInstalled(disabled.store)
    disabled.runtime.attach(disabled.fake.ctx)
    await disabled.runtime.refresh()
    expect(disabled.fake.commands).toEqual([])
  })

  it('survives a duplicate-name registration failure', async () => {
    await seedInstalled(f.store)
    // The first registration of "ship" throws like a real duplicate
    // collision; the failed command is skipped and a later refresh (the
    // retry path an install triggers) registers it once the collision clears.
    let first = true
    const register = (f.fake.ctx as unknown as { commands: { register: (d: RegisteredCommand) => () => void } }).commands.register
    ;(f.fake.ctx as unknown as { commands: { register: (d: RegisteredCommand) => () => void } }).commands.register = ((definition: RegisteredCommand) => {
      if (definition.name === 'ship' && first) {
        first = false
        throw new Error('duplicate command name')
      }
      return register(definition)
    })
    f.runtime.attach(f.fake.ctx)
    await f.runtime.refresh()
    // The attach-time pass skipped "ship" (duplicate); the explicit retry
    // pass re-registered everything and now "ship" succeeds.
    expect(f.fake.commands.map((c) => c.name)).toEqual(['cc-team-tools-review', 'ship'])
  })
})

describe('CcRuntime hooks', () => {
  let f: Fixture
  beforeEach(async () => {
    f = makeFixture({ hooks: true })
    await seedInstalled(f.store)
    f.runtime.attach(f.fake.ctx)
    await f.runtime.refresh()
  })

  it('registers both waterfall listeners', () => {
    expect(f.fake.handlers.has('tools/pre-execute')).toBe(true)
    expect(f.fake.handlers.has('tools/post-execute')).toBe(true)
  })

  it('runs matching PreToolUse hooks and allows on exit 0', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const decision = await f.fake.handlers.get('tools/pre-execute')!(
      { name: 'Bash', arguments: { command: 'ls' }, agent: { id: 'session-1' }, signal: SIGNAL },
      next,
    )
    expect(decision).toEqual({ kind: 'allow' })
    expect(next.mock.calls.length).toBeGreaterThan(0)
    expect(f.hookRuns).toHaveLength(1)
    expect(f.hookRuns[0].command).toBe('guard.sh')
    expect(f.hookRuns[0].pluginRoot).toBe('/home/u/.dsh/cc-plugins/plugins/github_o_r_team-tools')
    const payload = JSON.parse(f.hookRuns[0].payload)
    expect(payload.tool_name).toBe('Bash')
    expect(payload.session_id).toBe('session-1')
    expect(payload.hook_event_name).toBe('PreToolUse')
  })

  it('does not run hooks for non-matching tools', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await f.fake.handlers.get('tools/pre-execute')!({ name: 'Read', arguments: {}, signal: SIGNAL }, next)
    expect(f.hookRuns).toHaveLength(0)
  })

  it('denies the call when a PreToolUse hook exits 2', async () => {
    f.setOutcome({ code: 2, stdout: '', stderr: 'demo hook says no', timedOut: false })
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const decision = await f.fake.handlers.get('tools/pre-execute')!(
      { name: 'Bash', arguments: {}, signal: SIGNAL },
      next,
    )
    expect(decision).toEqual({ kind: 'deny', reason: 'demo hook says no' })
    expect(next.mock.calls).toHaveLength(0)
  })

  it('runs PostToolUse hooks and always continues the waterfall', async () => {
    const next = vi.fn(async () => ({ kind: 'accept' as const }))
    const decision = await f.fake.handlers.get('tools/post-execute')!(
      { name: 'Bash', arguments: {}, agent: { id: 's' }, signal: SIGNAL },
      { kind: 'ok' },
      next,
    )
    expect(decision).toEqual({ kind: 'accept' })
    expect(f.hookRuns.map((r) => r.command)).toEqual(['log.sh'])
    const payload = JSON.parse(f.hookRuns[0].payload)
    expect(payload.hook_event_name).toBe('PostToolUse')
  })

  it('contains a thrown hook run instead of failing the tool call', async () => {
    f.runHook.mockRejectedValue(new Error('spawn failed'))
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const decision = await f.fake.handlers.get('tools/pre-execute')!({ name: 'Bash', arguments: {}, signal: SIGNAL }, next)
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('skips timed-out hooks without denying', async () => {
    f.setOutcome({ code: -1, stdout: '', stderr: '', timedOut: true })
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const decision = await f.fake.handlers.get('tools/pre-execute')!({ name: 'Bash', arguments: {}, signal: SIGNAL }, next)
    expect(decision).toEqual({ kind: 'allow' })
  })
})

describe('CcRuntime hook listeners when disabled', () => {
  it('attaches no listeners while runtime.hooks is off', async () => {
    const f = makeFixture({ hooks: false })
    await seedInstalled(f.store)
    f.runtime.attach(f.fake.ctx)
    await f.runtime.refresh()
    for (const event of ['tools/pre-execute', 'tools/post-execute', 'agent/pre-step', 'agent/session-start', 'agent/turn-stopping', 'subagent/end']) {
      expect(f.fake.handlers.has(event)).toBe(false)
    }
  })
})

const LIFECYCLE_FILES: Record<string, string> = {
  'hooks/hooks.json': JSON.stringify({
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'prompt-guard.sh' }] }],
    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'session-log.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'stop-check.sh' }] }],
    SubagentStop: [{ hooks: [{ type: 'command', command: 'sub-stop.sh' }] }],
  }),
}

describe('CcRuntime lifecycle hooks', () => {
  let f: Fixture
  beforeEach(async () => {
    f = makeFixture({ hooks: true })
    await seedInstalled(f.store, LIFECYCLE_FILES)
    f.runtime.attach(f.fake.ctx)
    await f.runtime.refresh()
  })

  it('registers the four lifecycle listeners while runtime.hooks is on', () => {
    for (const event of ['agent/pre-step', 'agent/session-start', 'agent/turn-stopping', 'subagent/end']) {
      expect(f.fake.handlers.has(event)).toBe(true)
    }
  })

  it('injects UserPromptSubmit stdout as model context and continues the step', async () => {
    f.setOutcome({ code: 0, stdout: 'recall: staging is down', stderr: '', timedOut: false })
    const inject = vi.fn()
    const next = vi.fn(async () => ({ kind: 'enter' as const, messages: [] }))
    const decision = await f.fake.handlers.get('agent/pre-step')!({
      agent: { id: 'agent-1', inject },
      messages: [{ content: [{ type: 'text', text: 'deploy now' }], source: { kind: 'user' } }],
      turn: 1,
      step: 1,
      signal: SIGNAL,
    }, next)
    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(next).toHaveBeenCalled()
    expect(f.hookRuns.map((r) => r.command)).toEqual(['prompt-guard.sh'])
    const payload = JSON.parse(f.hookRuns[0].payload)
    expect(payload.hook_event_name).toBe('UserPromptSubmit')
    expect(payload.prompt).toBe('deploy now')
    expect(inject).toHaveBeenCalledTimes(1)
    const injected = inject.mock.calls[0][0] as { content: Array<{ type: string; text: string }>; source: { kind: string; plugin: string } }
    expect(injected.content[0].text).toBe('recall: staging is down')
    expect(injected.source).toEqual({ kind: 'plugin', plugin: 'dsh-next-cc-plugins' })
  })

  it('rejects the step when a UserPromptSubmit hook blocks', async () => {
    f.setOutcome({ code: 2, stdout: '', stderr: 'prompt not allowed', timedOut: false })
    const inject = vi.fn()
    const next = vi.fn(async () => ({ kind: 'enter' as const, messages: [] }))
    const decision = await f.fake.handlers.get('agent/pre-step')!({
      agent: { id: 'agent-1', inject },
      messages: [{ content: [{ type: 'text', text: 'rm -rf /' }], source: { kind: 'user' } }],
      turn: 1,
      step: 1,
      signal: SIGNAL,
    }, next)
    expect(decision).toEqual({ kind: 'reject' })
    expect(next).not.toHaveBeenCalled()
    expect(inject).not.toHaveBeenCalled()
  })

  it('skips UserPromptSubmit hooks when the step has no user-authored message', async () => {
    const next = vi.fn(async () => ({ kind: 'enter' as const, messages: [] }))
    await f.fake.handlers.get('agent/pre-step')!({
      agent: { id: 'agent-1', inject: vi.fn() },
      messages: [{ content: [{ type: 'text', text: 'internal' }], source: { kind: 'plugin', plugin: 'other' } }],
      turn: 1,
      step: 2,
      signal: SIGNAL,
    }, next)
    expect(f.hookRuns).toHaveLength(0)
    expect(next).toHaveBeenCalled()
  })

  it('runs SessionStart hooks on matching sources and injects stdout', async () => {
    f.setOutcome({ code: 0, stdout: 'session context', stderr: '', timedOut: false })
    const inject = vi.fn()
    f.fake.handlers.get('agent/session-start')!({ agent: { id: 'agent-1', inject }, source: 'startup' })
    await vi.waitFor(() => expect(inject).toHaveBeenCalledTimes(1))
    expect(f.hookRuns.map((r) => r.command)).toEqual(['session-log.sh'])
    const payload = JSON.parse(f.hookRuns[0].payload)
    expect(payload.hook_event_name).toBe('SessionStart')
    expect(payload.source).toBe('startup')
  })

  it('skips SessionStart hooks on non-matching sources', async () => {
    f.fake.handlers.get('agent/session-start')!({ agent: { id: 'agent-1', inject: vi.fn() }, source: 'resume' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(f.hookRuns).toHaveLength(0)
  })

  it('steers the agent when a Stop hook blocks the stop boundary', async () => {
    f.setOutcome({ code: 2, stdout: '', stderr: 'checks still failing', timedOut: false })
    const steer = vi.fn()
    f.fake.handlers.get('agent/turn-stopping')!({ agent: { id: 'agent-1', steer }, turn: 3, signal: SIGNAL })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(1))
    const steered = steer.mock.calls[0][0] as { content: Array<{ type: string; text: string }>; source: { kind: string; plugin: string } }
    expect(steered.content[0].text).toBe('checks still failing')
    expect(steered.source).toEqual({ kind: 'plugin', plugin: 'dsh-next-cc-plugins' })
    const payload = JSON.parse(f.hookRuns[0].payload)
    expect(payload.hook_event_name).toBe('Stop')
    expect(payload.stop_hook_active).toBe(false)
  })

  it('does not steer again for the same turn (loop guard)', async () => {
    f.setOutcome({ code: 2, stdout: '', stderr: 'still failing', timedOut: false })
    const steer = vi.fn()
    f.fake.handlers.get('agent/turn-stopping')!({ agent: { id: 'agent-1', steer }, turn: 3, signal: SIGNAL })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(1))
    f.fake.handlers.get('agent/turn-stopping')!({ agent: { id: 'agent-1', steer }, turn: 3, signal: SIGNAL })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(steer).toHaveBeenCalledTimes(1)
    // The guarded pass still ran the hook, with Claude's stop_hook_active flag.
    const payload = JSON.parse(f.hookRuns[1].payload)
    expect(payload.stop_hook_active).toBe(true)
  })

  it('closes the turn when the Stop hook allows', async () => {
    f.setOutcome({ code: 0, stdout: '', stderr: '', timedOut: false })
    const steer = vi.fn()
    f.fake.handlers.get('agent/turn-stopping')!({ agent: { id: 'agent-1', steer }, turn: 4, signal: SIGNAL })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(steer).not.toHaveBeenCalled()
  })

  it('runs SubagentStop hooks observe-only with the child identity', async () => {
    f.fake.handlers.get('subagent/end')!({ runId: 'r1', provider: 'spawn', id: 'child-9', local: true, stopReason: 'completed' })
    await vi.waitFor(() => expect(f.hookRuns).toHaveLength(1))
    expect(f.hookRuns[0].command).toBe('sub-stop.sh')
    const payload = JSON.parse(f.hookRuns[0].payload)
    expect(payload.hook_event_name).toBe('SubagentStop')
    expect(payload.session_id).toBe('child-9')
    expect(payload.dsh.stopReason).toBe('completed')
  })
})
