import { EventEmitter } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { GitDrafting, currentDraftModel, gitSettingsSchema, parseDraftInput, type DraftingPorts, type DraftSettings } from '../src/host/drafting.ts'
import { GitError, GitRunner } from '../src/host/git-runner.ts'
import { GitService } from '../src/host/git-service.ts'
import { nodeFs } from '../src/host/fs-adapter.ts'
import { registerRpc } from '../src/host/rpc.ts'
import { createFixture } from './git-fixture.ts'

const oid = 'a'.repeat(40)
const request = { sessionId: 'session-1', kind: 'commit', message: 'old text' } as const
const good: StreamChunk[] = [{ type: 'text-delta', index: 0, text: 'New subject\n\nDescription' }, { type: 'finish', reason: { kind: 'stop' } }]
function setup(chunks: StreamChunk[] = good) {
  let config: DraftSettings = { draftingProvider: '', draftingModel: '', draftingInstructions: '' }
  const runOk = vi.fn(async (args: readonly string[]): Promise<string> => args.includes('config') ? '' : args.includes('ls-files') ? '' : 'diff --git a/test b/test\n+change')
  const repoFor = vi.fn(async () => ({ root: '/repo', toplevel: '/repo', commonDir: '/repo/.git', gitDir: '/repo/.git', cwd: '/repo' }))
  const stream = vi.fn(async function* (_options: GenerateOptions) { yield* chunks })
  const ports: DraftingPorts = {
    runner: { runOk, ok: vi.fn(async () => true) }, service: { repoFor }, stream,
    modelFor: vi.fn(() => ({ provider: 'session-provider', model: 'session-model' })),
    scope: { get: () => config, update: vi.fn(async patch => { config = { ...config, ...patch } }) }, writable: () => true,
  }
  return { ports, draft: new GitDrafting(ports), runOk, repoFor, stream }
}

describe('draft input validation', () => {
  it('copies valid inputs and accepts both hash widths', () => {
    expect(parseDraftInput(request)).toEqual(request)
    const input = { ...request, kind: 'squash', commits: [oid, 'b'.repeat(64)] }
    expect(parseDraftInput(input)).toEqual(input)
    expect(parseDraftInput(input).commits).not.toBe(input.commits)
  })
  it.each([null, [], {}, { ...request, sessionId: '' }, { ...request, sessionId: '\0' }, { ...request, sessionId: 'a'.repeat(257) },
    { ...request, cwd: '/other' }, { ...request, kind: 'unknown' }, { ...request, message: null }, { ...request, message: '\0' },
    { ...request, message: 'x'.repeat(16001) }, { ...request, mode: 'other' }, { ...request, commits: [oid] },
    { ...request, commits: 'HEAD' }, { ...request, kind: 'reword' }, { ...request, kind: 'reword', commits: [oid, oid] },
    { ...request, kind: 'squash', commits: [] }, { ...request, kind: 'squash', commits: ['--all'] },
    { ...request, kind: 'reword', commits: [oid], mode: 'all' }, { ...request, kind: 'squash', commits: Array(21).fill(oid) },
  ])('rejects malformed request %#', input => expect(() => parseDraftInput(input)).toThrow(GitError))
})

describe('current session model', () => {
  const model = (name: string) => ({ provider: name, model: name })
  it.each([
    [model('pending'), model('logged'), model('default'), model('pending')],
    [null, model('logged'), model('default'), model('logged')],
    [null, undefined, model('default'), model('default')],
    [null, undefined, undefined, undefined],
  ])('resolves pending, logged and default in order %#', (pending, logged, fallback, expected) => {
    const services: Record<string, unknown> = {
      sessions: { get: () => ({ requestHeader: () => logged ? { config: logged } : undefined }) },
      sessionProjections: { stateOf: () => ({ pending }) }, agentDefaultModel: { currentSelection: () => fallback },
    }
    expect(currentDraftModel({ get: (name: string) => services[name] } as unknown as Context, 'session-1')).toEqual(expected)
  })
  it('never uses a deployment default for an unknown session', () => {
    const services: Record<string, unknown> = { sessions: { get: () => undefined }, agentDefaultModel: { currentSelection: () => model('default') } }
    expect(currentDraftModel({ get: (name: string) => services[name] } as unknown as Context, 'other')).toBeUndefined()
  })
})

describe('Git drafting settings', () => {
  it.each(['commit', 'reword', 'squash'] as const)('applies writing preferences to %s while retaining the base prompt and no tools', async kind => {
    const { draft, stream } = setup()
    await draft.draft(kind === 'commit' ? request : { ...request, kind, commits: [oid] })
    const base = stream.mock.calls[0]![0].system as string
    await draft.setConfig({ draftingInstructions: '  Use Conventional Commits.\nWrite in English.  ' })
    await draft.setConfig({ draftingProvider: 'p', draftingModel: 'm' })
    expect(draft.getConfig().draftingInstructions).toBe('Use Conventional Commits.\nWrite in English.')
    await draft.draft(kind === 'commit' ? request : { ...request, kind, commits: [oid] })
    expect(stream.mock.calls[1]![0].system).toContain(base)
    expect(stream.mock.calls[1]![0].system).toContain('style only')
    expect(stream.mock.calls[1]![0].system).toContain('Use Conventional Commits.\nWrite in English.')
    expect(stream.mock.calls[1]![0].tools).toEqual([])
    await draft.setConfig({ draftingInstructions: ' \n ' })
    expect(draft.getConfig()).toEqual({ draftingProvider: 'p', draftingModel: 'm', draftingInstructions: '' })
    await draft.draft(kind === 'commit' ? request : { ...request, kind, commits: [oid] })
    expect(stream.mock.calls[2]![0].system).toBe(base)
  })
  it.each([null, 42, [], 'x'.repeat(4001), '\u0000', '\u0007'])('rejects invalid writing preferences %#', async draftingInstructions => {
    const { draft, ports } = setup()
    await expect(draft.setConfig({ draftingInstructions })).rejects.toThrow('Invalid')
    expect(ports.scope!.update).not.toHaveBeenCalled()
  })
  it('accepts exactly the instructions limit and preserves the model pair', async () => {
    const { draft } = setup()
    await draft.setConfig({ draftingProvider: 'p', draftingModel: 'm', draftingInstructions: 'x'.repeat(4000) })
    expect(draft.getConfig().draftingInstructions).toHaveLength(4000)
    await expect(draft.setConfig({ draftingProvider: 'p', draftingInstructions: '' })).rejects.toThrow('Invalid')
  })
  it('lists provider models without changing the session selection', async () => {
    const { ports } = setup()
    ports.modelCatalog = async () => ({ default: { provider: 'p', model: 'm' }, routableProviders: ['p'], failures: [],
      groups: [{ id: 'p', name: 'Provider', models: [{ id: 'm', name: 'Model' }] }] })
    expect(await new GitDrafting(ports).modelCatalog()).toEqual({ models: [{ provider: 'p', model: 'm', label: 'Provider / Model' }] })
    expect(ports.modelFor).not.toHaveBeenCalled()
    expect(await setup().draft.modelCatalog()).toEqual({ models: [] })
  })
  it('surfaces unavailable model catalogs rather than inventing options', async () => {
    const { ports } = setup()
    ports.modelCatalog = async () => { throw new Error('catalog unavailable') }
    await expect(new GitDrafting(ports).modelCatalog()).rejects.toThrow('catalog unavailable')
  })
  it('registers empty defaults and round trips an explicit model', async () => {
    expect(gitSettingsSchema({})).toEqual({ draftingProvider: '', draftingModel: '', draftingInstructions: '' })
    const { draft, ports, stream } = setup()
    expect(await draft.setConfig({ draftingProvider: ' custom ', draftingModel: ' chosen ' })).toEqual({ draftingProvider: 'custom', draftingModel: 'chosen', draftingInstructions: '' })
    await draft.draft(request)
    expect(stream.mock.calls[0]![0]).toMatchObject({ provider: 'custom', model: 'chosen' })
    expect(ports.modelFor).not.toHaveBeenCalled()
    expect(await draft.setConfig({ draftingProvider: '', draftingModel: '', draftingInstructions: '' })).toEqual({ draftingProvider: '', draftingModel: '', draftingInstructions: '' })
  })
  it.each([null, [], {}, { draftingProvider: 'p', draftingModel: '' }, { draftingProvider: '', draftingModel: 'm' },
    { draftingProvider: 'p', draftingModel: 'm', extra: true }, { draftingProvider: 'p', draftingModel: '\0' },
    { draftingProvider: 'x'.repeat(257), draftingModel: 'm' }, { draftingProvider: true, draftingModel: 'm' },
  ])('rejects invalid settings %#', async config => { await expect(setup().draft.setConfig(config)).rejects.toThrow('Invalid') })
  it('distinguishes read-only settings from unavailable settings storage', async () => {
    const { ports } = setup()
    await expect(new GitDrafting({ ...ports, writable: () => false }).setConfig({ draftingProvider: '', draftingModel: '', draftingInstructions: '' }))
      .rejects.toThrow('read-only')
    await expect(new GitDrafting({ ...ports, scope: null, writable: () => false }).setConfig({ draftingProvider: '', draftingModel: '', draftingInstructions: '' }))
      .rejects.toThrow('unavailable')
  })
})

describe('tool-free Git generation', () => {
  it('uses authorized staged evidence, an official identified message and session defaults', async () => {
    const { draft, stream, repoFor, runOk } = setup()
    expect(await draft.draft(request)).toBe('New subject\n\nDescription')
    expect(repoFor).toHaveBeenCalledWith({ sessionId: 'session-1' }, expect.any(AbortSignal))
    expect(runOk.mock.calls[0]![0]).toContain('--cached')
    const options = stream.mock.calls[0]![0]
    expect(options).toMatchObject({ provider: 'session-provider', model: 'session-model', tools: [], maxTokens: 2048 })
    expect(options.messages[0]!.id).toBeTruthy()
    expect(options.messages[0]!.content).toEqual([{ type: 'text', text: expect.stringContaining('old text') }])
    expect(options.system).toContain('untrusted')
    expect(options.signal!.aborted).toBe(true)
  })
  it('includes staged, unstaged, and untracked names in all mode', async () => {
    const { draft, runOk, stream } = setup()
    runOk.mockImplementation(async args => args.includes('config') ? '' : args.includes('ls-files') ? 'new.txt\0' : '+changed')
    await draft.draft({ ...request, mode: 'all' })
    expect(runOk).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(stream.mock.calls[0]![0].messages)).toContain('new.txt')
  })
  it.each(['reword', 'squash'])('reads selected reachable commits for %s', async kind => {
    const { draft, ports, runOk } = setup()
    await draft.draft({ ...request, kind, commits: [oid] })
    expect(ports.runner.ok).toHaveBeenCalledWith(expect.arrayContaining(['merge-base', '--is-ancestor', oid, 'HEAD']), '/repo', expect.any(Object))
    expect(runOk.mock.calls[0]![0]).toEqual(expect.arrayContaining(['show', '--no-ext-diff', '--no-textconv', oid]))
  })
  it('refuses commits outside current history before generation', async () => {
    const { ports, stream } = setup(); ports.runner.ok = async () => false
    await expect(new GitDrafting(ports).draft({ ...request, kind: 'reword', commits: [oid] })).rejects.toThrow('Invalid')
    expect(stream).not.toHaveBeenCalled()
  })
  it('refuses unresolvable sessions without generating', async () => {
    const { ports, stream } = setup(); ports.service.repoFor = async () => { throw new GitError({ code: 'session-not-ready', detail: 'unknown session' }) }
    await expect(new GitDrafting(ports).draft(request)).rejects.toThrow('unknown session')
    expect(stream).not.toHaveBeenCalled()
  })
  it('refuses missing session model', async () => {
    const { ports } = setup(); ports.modelFor = () => undefined
    await expect(new GitDrafting(ports).draft(request)).rejects.toThrow('Select a model')
  })
  it('refuses incomplete persisted configuration', async () => {
    const { ports } = setup(); ports.scope!.get = () => ({ draftingProvider: 'p', draftingModel: '', draftingInstructions: '' })
    await expect(new GitDrafting(ports).draft(request)).rejects.toThrow('Select both')
  })
  it('blocks executable filters only for worktree evidence', async () => {
    const { draft, runOk } = setup(); runOk.mockResolvedValue('filter.evil.clean\nrun-me\0')
    await expect(draft.draft({ ...request, mode: 'all' })).rejects.toThrow('filters')
    await expect(draft.draft(request)).resolves.toBeTruthy()
  })
  it.each(['', 'x'.repeat(64001)])('refuses empty or oversized evidence', async evidence => {
    const { draft, runOk, stream } = setup(); runOk.mockResolvedValue(evidence)
    await expect(draft.draft(request)).rejects.toThrow()
    expect(stream).not.toHaveBeenCalled()
  })
  it('accepts complete text blocks without doubling streamed deltas; excludes reasoning', async () => {
    const { draft } = setup([{ type: 'reasoning-delta', index: 1, text: 'private' }, ...good.slice(0, 1), { type: 'block-end', index: 0, block: { type: 'text', text: 'complete' } }, good[1]!])
    expect(await draft.draft(request)).toBe('complete')
  })
  it.each(['max-tokens', 'tool-calls', 'error', 'aborted'])('rejects incomplete finish %s', async kind => {
    const { draft } = setup([good[0]!, { type: 'finish', reason: { kind, failure: { message: 'secret provider error', code: 'test' } } } as StreamChunk])
    await expect(draft.draft(request)).rejects.toThrow('did not complete')
  })
  it.each<StreamChunk[]>([
    [], [good[0]!], [good[1]!], [good[0]!, good[1]!, good[0]!],
    [{ type: 'text-delta', index: 0, text: '\0' }, good[1]!],
    [{ type: 'text-delta', index: 0, text: 'x'.repeat(16001) }, good[1]!],
    [{ type: 'block-start', index: 0, blockType: 'tool-call' }],
    [{ type: 'tool-call-delta', index: 0, id: 'call' as never, argumentsDelta: '{}' }],
    [{ type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call' as never, name: 'bash', arguments: '{}' } }],
  ])('rejects invalid output %#', async (...chunks) => { await expect(setup(chunks).draft.draft(request)).rejects.toThrow() })
  it('sanitizes unexpected provider failures and releases its slot', async () => {
    const { ports } = setup(); ports.stream = async function* () { throw new Error('provider secret') }
    const draft = new GitDrafting(ports)
    await expect(draft.draft(request)).rejects.toThrow('Check the selected model')
    ports.stream = async function* () { yield* good }
    await expect(draft.draft(request)).resolves.toBeTruthy()
  })
  it('limits chunk counts even if reasoning produces no text', async () => {
    const { ports } = setup(); ports.stream = async function* () { for (let i = 0; i < 20001; i++) yield { type: 'reasoning-delta', index: 0, text: '' } }
    await expect(new GitDrafting(ports).draft(request)).rejects.toThrow('output limit')
  })
})

describe('draft cancellation and lifecycle', () => {
  function hanging() {
    const { ports } = setup()
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    ports.stream = () => ({ [Symbol.asyncIterator]: () => ({ next: () => { started(); return new Promise<IteratorResult<StreamChunk>>(() => {}) } }) })
    return { ports, ready }
  }
  it('cancels an uncooperative provider when the caller disconnects', async () => {
    const { ports, ready } = hanging(); const draft = new GitDrafting(ports); const abort = new AbortController()
    const result = draft.draft(request, abort.signal); await ready; abort.abort()
    await expect(result).rejects.toThrow('cancelled')
    ports.stream = async function* () { yield* good }; await expect(draft.draft(request)).resolves.toBeTruthy()
  })
  it('refuses already cancelled requests before discovery', async () => {
    const { draft, repoFor } = setup(); const abort = new AbortController(); abort.abort()
    await expect(draft.draft(request, abort.signal)).rejects.toThrow('cancelled'); expect(repoFor).not.toHaveBeenCalled()
  })
  it('times out an uncooperative provider', async () => {
    const { ports } = hanging(); await expect(new GitDrafting({ ...ports, timeoutMs: 10 }).draft(request)).rejects.toThrow('timed out')
  })
  it('bounds concurrency per session and globally and disposes all calls', async () => {
    const { ports, ready } = hanging(); const draft = new GitDrafting(ports)
    const first = draft.draft(request); await ready
    await expect(draft.draft(request)).rejects.toThrow('busy')
    const rest = [2, 3, 4].map(i => draft.draft({ ...request, sessionId: `session-${i}` }))
    await expect(draft.draft({ ...request, sessionId: 'session-5' })).rejects.toThrow('busy')
    draft.dispose()
    await Promise.all([first, ...rest].map(result => expect(result).rejects.toThrow('cancelled')))
    await expect(draft.draft(request)).rejects.toThrow('unavailable')
  })
})

it('real Git evidence is read-only and bound to the authorized session', async () => {
  const fixture = createFixture('clean')
  try {
    fixture.write('draft.txt', 'content to describe\n'); fixture.gitOk(['add', 'draft.txt'])
    const before = fixture.gitOk(['status', '--porcelain=v1'])
    const runner = new GitRunner()
    const service = new GitService({ runner, fs: nodeFs(), cwdOf: id => id === 'session-1' ? fixture.dir : undefined, platform: process.platform, env: process.env })
    const { ports, stream } = setup()
    const draft = new GitDrafting({ ...ports, service, runner })
    await expect(draft.draft(request)).resolves.toBeTruthy()
    expect(JSON.stringify(stream.mock.calls[0]![0].messages)).toContain('content to describe')
    expect(fixture.gitOk(['status', '--porcelain=v1'])).toBe(before)
    await expect(draft.draft({ ...request, sessionId: 'other' })).rejects.toThrow('working directory')
  } finally { fixture.dispose() }
})

it.each(['aborted', 'close'] as const)('cancels drafting and releases RPC listeners on %s', async event => {
  const { draft, ports } = setup()
  let signal: AbortSignal | undefined
  ports.stream = async function* (options) {
    signal = options.signal
    await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  }
  let handler!: (req: any, res: any) => void
  const ctx = { get: () => ({ register: (route: { handler: typeof handler }) => { handler = route.handler; return () => {} } }), effect: (run: () => void) => run() } as unknown as Context
  registerRpc(ctx, {} as GitService, draft)
  const req = Object.assign(new EventEmitter(), { method: 'POST' })
  const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, writeHead: vi.fn(), end: vi.fn() })
  handler(req, res); req.emit('data', JSON.stringify({ method: 'draftInput', args: request })); req.emit('end')
  await vi.waitFor(() => expect(signal).toBeDefined())
  res.destroyed = true
  if (event === 'close') res.emit('close'); else req.emit('aborted')
  await vi.waitFor(() => {
    expect(signal!.aborted).toBe(true)
    expect(req.listenerCount('aborted')).toBe(0)
    expect(res.listenerCount('close')).toBe(0)
  })
  expect(res.end).not.toHaveBeenCalled()
})

it('exposes exact RPC envelopes and persists settings through the host scope', async () => {
  const { draft } = setup()
  let handler!: (req: any, res: any) => void
  const ctx = { get: () => ({ register: (route: { handler: typeof handler }) => { handler = route.handler; return () => {} } }), effect: (run: () => void) => run() } as unknown as Context
  registerRpc(ctx, {} as GitService, draft)
  async function call(method: string, args: unknown) {
    const req = Object.assign(new EventEmitter(), { method: 'POST' })
    let resolve!: (value: unknown) => void
    const done = new Promise(resolveValue => { resolve = resolveValue })
    const res = Object.assign(new EventEmitter(), { writableEnded: false, writeHead: vi.fn(), end: (body: string) => { res.writableEnded = true; resolve(JSON.parse(body)) } })
    handler(req, res); req.emit('data', JSON.stringify({ method, args })); req.emit('end')
    return done
  }
  expect(await call('draftingModelCatalog', {})).toEqual({ ok: true, value: { models: [] } })
  expect(await call('getConfig', {})).toEqual({ ok: true, value: { draftingProvider: '', draftingModel: '', draftingInstructions: '' } })
  expect(await call('setConfig', { draftingProvider: 'p', draftingModel: 'm' })).toEqual({ ok: true, value: { draftingProvider: 'p', draftingModel: 'm', draftingInstructions: '' } })
  expect(await call('getConfig', {})).toEqual({ ok: true, value: { draftingProvider: 'p', draftingModel: 'm', draftingInstructions: '' } })
  expect(await call('setConfig', { draftingInstructions: 'Use Conventional Commits.' })).toEqual({ ok: true, value: { draftingProvider: 'p', draftingModel: 'm', draftingInstructions: 'Use Conventional Commits.' } })
  expect(await call('getConfig', {})).toEqual({ ok: true, value: { draftingProvider: 'p', draftingModel: 'm', draftingInstructions: 'Use Conventional Commits.' } })
  expect(await call('draftInput', request)).toEqual({ ok: true, value: 'New subject\n\nDescription' })
  expect(await call('draftInput', { ...request, cwd: '/other' })).toMatchObject({ ok: false, failure: { code: 'invalid-name' } })
})
