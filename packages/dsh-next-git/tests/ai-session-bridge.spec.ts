import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type {
  ISessions, SessionBinding, SessionCreateError, SessionEventChange, SessionEventLikeEntry,
  SessionEventWindow, SessionFace, SessionListState, SessionReference, SessionRetainOptions, SessionTarget,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import {
  createSessionBridge, SessionBridgeError, type SessionBridgeDependencies, type SessionDeliveryInput,
} from '../src/client/ai/session-bridge.ts'

// Only nominal IDs are asserted. Every service method and fixture payload is checked against SDK types.
const sourceId = 'source' as SessionId
const otherId = 'other' as SessionId
const freshId = 'fresh' as SessionId
const workspaceId = 'workspace' as WorkspaceId
const cwd = '/checkout'
const input: SessionDeliveryInput = { target: 'new', sourceSessionId: sourceId, expectedCwd: cwd, text: 'Review changes' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function observable<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  })
  return {
    getSnapshot: (): T => snapshot, subscribe, listeners,
    publish(value: T) { snapshot = value; for (const listener of listeners) listener() },
  }
}

function fixture() {
  const catalog = observable<SessionListState>({
    ids: [sourceId, otherId], phase: 'ready', subagentsByParent: {}, jobsBySession: {},
    byId: {
      [sourceId]: { id: sourceId, displayTitle: 'Source title', cwd, blank: true, running: false, retainedBy: {}, updatedAt: 0 },
      [otherId]: { id: otherId, displayTitle: 'Other title', cwd: '/other', blank: true, running: false, retainedBy: {}, updatedAt: 0 },
    },
  })
  const workspace: WorkspaceView = {
    workspaceId, title: 'Checkout title', path: cwd, sessionIds: [sourceId], createdAt: '', updatedAt: '',
  }
  const workspaces = observable<WorkspaceSnapshot>({
    items: [workspace], archivedSessionIds: [], phase: 'ready', state: 'idle', error: null,
  })
  const events = observable<SessionEventWindow>({ entries: [], hasMore: false, revision: 0, change: { kind: 'replace', entries: [] } })
  const prompt = vi.fn<SessionFace['prompt']>().mockResolvedValue({ ok: true, value: { accepted: true } })
  const create = vi.fn<ISessions['create']>().mockResolvedValue(freshId)
  const openSession = vi.fn<UiWorkspace['openSession']>()
  const release = vi.fn<SessionReference['release']>()
  const ready = deferred<Pick<SessionBinding, 'eventSource'>>()
  const usingCalls: { target: SessionTarget; options: SessionRetainOptions }[] = []
  const hooks = { beforeUsing: async () => {}, afterUsing: () => {} }
  const retain = vi.fn<SessionBridgeDependencies['sessions']['retain']>(() => ({ ready: ready.promise, release }))
  const deps: SessionBridgeDependencies = {
    sessions: {
      list: catalog, create, retain,
      async using(target, options, operation) {
        usingCalls.push({ target, options })
        await hooks.beforeUsing()
        const result = await operation({ binding: { session: { prompt } } })
        hooks.afterUsing()
        return result
      },
    },
    workspaces: { list: workspaces }, uiWorkspace: { openSession },
  }
  const bridge = createSessionBridge(deps)
  return { bridge, deps, catalog, workspaces, workspace, events, prompt, create, openSession, release, ready, retain, usingCalls, hooks }
}

const turnEnd: SessionEventLikeEntry = {
  type: 'event', event: { type: 'turn/end', seq: 1 as SessionSeq, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
}
const turnStart: SessionEventLikeEntry = {
  type: 'event', event: { type: 'turn/start', seq: 0 as SessionSeq, time: 0, data: { turn: 1 } },
}
function publish(f: ReturnType<typeof fixture>, change: SessionEventChange) {
  f.events.publish({ ...f.events.getSnapshot(), revision: f.events.getSnapshot().revision + 1, change })
}

const remoteError = (code: 'gateway/internal' | 'gateway/cancelled') => Object.assign(new Error('Transport diagnostic'), {
  code, details: {}, isDSHRemoteError: true as const,
})
function partialCreateError(): SessionCreateError {
  return Object.assign(new Error('Host attachment failed'), {
    name: 'SessionCreateError' as const, requestedSessionId: undefined,
    rpcError: Object.assign(new Error('Attachment failed'), {
      code: 'session/workspace-attach-failed' as const, details: { sessionId: freshId, workspaceId }, isDSHRemoteError: true as const,
    }),
  })
}

describe('official session bridge contracts', () => {
  it('accepts real SDK services without structural casts', () => {
    expectTypeOf<{ sessions: ISessions; workspaces: IWorkspaces; uiWorkspace: UiWorkspace }>()
      .toExtend<SessionBridgeDependencies>()
  })

  it('exposes source metadata by authoritative id and workspace membership', () => {
    const f = fixture()
    expect(f.bridge.getSource(sourceId)).toEqual({
      sessionId: sourceId, title: 'Source title', cwd, workspaceId, workspaceTitle: 'Checkout title', workspacePath: cwd,
    })
    expect(f.bridge.getSource(freshId)).toBeUndefined()
    expect(f.bridge.getSource(otherId)).toMatchObject({ sessionId: otherId, cwd: '/other', workspaceId: undefined })
    delete f.catalog.getSnapshot().byId[sourceId].cwd
    expect(f.bridge.getSource(sourceId)?.cwd).toBe(cwd)
  })

  it('queues into the slot source, retaining through using rather than a borrowed scope', async () => {
    const f = fixture()
    const controller = new AbortController()
    const delivery = f.bridge.createDelivery({ ...input, target: 'current' })
    expect(delivery.getSnapshot()).toMatchObject({ accepted: false, opened: false })
    await expect(delivery.send(controller.signal)).resolves.toMatchObject({ sessionId: sourceId, accepted: true, opened: false })
    expect(f.create).not.toHaveBeenCalled()
    expect(f.usingCalls).toEqual([{ target: sourceId, options: { source: 'dshNextGit', signal: controller.signal } }])
    expect(f.prompt).toHaveBeenCalledWith([{ type: 'text', text: input.text }], 'queue', controller.signal, expect.any(String))
    expect(f.openSession).not.toHaveBeenCalled()
    expect(delivery.open()).toMatchObject({ accepted: true, opened: true })
    delivery.open()
    expect(f.openSession).toHaveBeenCalledExactlyOnceWith(sourceId)
  })

  it('creates a genuinely fresh session even when the source catalog contains a blank', async () => {
    const f = fixture()
    const delivery = f.bridge.createDelivery(input)
    await expect(delivery.send()).resolves.toMatchObject({ createdSessionId: freshId, accepted: true, opened: false })
    expect(f.create).toHaveBeenCalledExactlyOnceWith({ workspaceId })
    expect(f.usingCalls[0].target).toBe(freshId)
    expect(f.openSession).not.toHaveBeenCalled()
    delivery.open()
    expect(f.openSession).toHaveBeenCalledExactlyOnceWith(freshId)
  })

  it('uses the frozen cwd when the source has no workspace membership', async () => {
    const f = fixture()
    f.workspaces.publish({ ...f.workspaces.getSnapshot(), items: [{ ...f.workspace, sessionIds: [otherId] }] })
    await f.bridge.createDelivery(input).send()
    expect(f.create).toHaveBeenCalledExactlyOnceWith({ cwd })
  })

  it('uses source cwd rather than a mismatched workspace path', async () => {
    const f = fixture()
    f.workspaces.publish({ ...f.workspaces.getSnapshot(), items: [{ ...f.workspace, path: '/different' }] })
    await f.bridge.createDelivery(input).send()
    expect(f.create).toHaveBeenCalledExactlyOnceWith({ cwd })
  })

  it('freezes caller inputs rather than retargeting to mutated chooser state', async () => {
    const f = fixture()
    const mutable = { ...input }
    const delivery = f.bridge.createDelivery(mutable)
    mutable.sourceSessionId = otherId
    mutable.expectedCwd = '/other'
    mutable.text = 'Wrong prompt'
    await delivery.send()
    expect(f.create).toHaveBeenCalledWith({ workspaceId })
    expect(f.prompt.mock.calls[0][0]).toEqual([{ type: 'text', text: input.text }])
  })

  it.each(['missing-source', 'cwd-mismatch'] as const)('rejects %s before any side effect', async code => {
    const f = fixture()
    if (code === 'missing-source') delete f.catalog.getSnapshot().byId[sourceId]
    else f.catalog.getSnapshot().byId[sourceId].cwd = '/moved'
    await expect(f.bridge.createDelivery(input).send()).rejects.toMatchObject({ code })
    expect(f.create).not.toHaveBeenCalled()
    expect(f.prompt).not.toHaveBeenCalled()
  })

  it('rechecks the checkout after asynchronous acquisition', async () => {
    const f = fixture()
    f.hooks.beforeUsing = async () => { f.catalog.getSnapshot().byId[sourceId].cwd = '/moved' }
    await expect(f.bridge.createDelivery(input).send()).rejects.toMatchObject({ code: 'cwd-mismatch' })
    expect(f.prompt).not.toHaveBeenCalled()
  })

  it('rejects a created session whose catalog shows a different checkout', async () => {
    const f = fixture()
    f.catalog.getSnapshot().byId[freshId] = { ...f.catalog.getSnapshot().byId[sourceId], id: freshId, cwd: '/wrong' }
    await expect(f.bridge.createDelivery(input).send()).rejects.toMatchObject({ code: 'cwd-mismatch', sessionId: freshId })
    expect(f.prompt).not.toHaveBeenCalled()
  })

  it('checks RemoteResult.ok and reuses the created identity after prompt rejection', async () => {
    const f = fixture()
    f.prompt.mockResolvedValueOnce({ ok: false, error: remoteError('gateway/internal') })
    const delivery = f.bridge.createDelivery(input)
    await expect(delivery.send()).rejects.toMatchObject({ code: 'prompt-rejected', sessionId: freshId })
    expect(delivery.getSnapshot()).toMatchObject({ createdSessionId: freshId, accepted: false })
    await delivery.send()
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.prompt).toHaveBeenCalledTimes(2)
  })

  it('reuses creation after a thrown send failure and never falls back to source', async () => {
    const f = fixture()
    f.prompt.mockRejectedValueOnce(new Error('disconnected'))
    const delivery = f.bridge.createDelivery(input)
    await expect(delivery.send()).rejects.toMatchObject({ code: 'send-failed', sessionId: freshId })
    await delivery.send()
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.usingCalls.map(call => call.target)).toEqual([freshId, freshId])
  })

  it('shares concurrent sends and never sends again after acceptance', async () => {
    const f = fixture()
    const gate = deferred<Awaited<ReturnType<SessionFace['prompt']>>>()
    f.prompt.mockReturnValueOnce(gate.promise)
    const delivery = f.bridge.createDelivery(input)
    const first = delivery.send()
    expect(delivery.send()).toBe(first)
    gate.resolve({ ok: true, value: { accepted: true } })
    await first
    await delivery.send()
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.prompt).toHaveBeenCalledTimes(1)
  })

  it('keeps acceptance if reference cleanup fails after prompt admission', async () => {
    const f = fixture()
    f.hooks.afterUsing = () => { throw new Error('release failure') }
    const delivery = f.bridge.createDelivery(input)
    await expect(delivery.send()).resolves.toMatchObject({ accepted: true })
    await delivery.send()
    expect(f.prompt).toHaveBeenCalledTimes(1)
  })

  it('separates navigation failure from admission and permits only navigation retry', async () => {
    const f = fixture()
    const delivery = f.bridge.createDelivery(input)
    expect(() => delivery.open()).toThrow(expect.objectContaining({ code: 'not-accepted' }))
    await delivery.send()
    f.openSession.mockImplementationOnce(() => { throw new Error('navigation failed') })
    expect(() => delivery.open()).toThrow(expect.objectContaining({ code: 'open-failed', sessionId: freshId }))
    expect(delivery.getSnapshot()).toMatchObject({ accepted: true, opened: false })
    await delivery.send()
    delivery.open()
    expect(f.prompt).toHaveBeenCalledTimes(1)
    expect(f.openSession).toHaveBeenCalledTimes(2)
  })

  it('does not create or send when already cancelled', async () => {
    const f = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(f.bridge.createDelivery(input).send(controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.create).not.toHaveBeenCalled()
  })

  it('retains a created id when cancellation happens during creation', async () => {
    const f = fixture()
    const controller = new AbortController()
    f.create.mockImplementationOnce(async () => { controller.abort(); return freshId })
    const delivery = f.bridge.createDelivery(input)
    await expect(delivery.send(controller.signal)).rejects.toMatchObject({ code: 'cancelled', sessionId: freshId })
    expect(f.prompt).not.toHaveBeenCalled()
    await delivery.send()
    expect(f.create).toHaveBeenCalledTimes(1)
  })

  it('honors cancellation while awaiting acquisition', async () => {
    const f = fixture()
    const controller = new AbortController()
    f.hooks.beforeUsing = async () => { controller.abort() }
    await expect(f.bridge.createDelivery(input).send(controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.prompt).not.toHaveBeenCalled()
  })

  it('maps both folded and thrown cancellation without claiming acceptance', async () => {
    const f = fixture()
    f.prompt.mockResolvedValueOnce({ ok: false, error: remoteError('gateway/cancelled') })
    const delivery = f.bridge.createDelivery(input)
    await expect(delivery.send()).rejects.toMatchObject({ code: 'cancelled' })
    const controller = new AbortController()
    f.prompt.mockImplementationOnce(async () => { controller.abort(); throw new Error('abort') })
    await expect(delivery.send(controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(delivery.getSnapshot().accepted).toBe(false)
  })

  it('preserves acceptance when an abort races a successful prompt response', async () => {
    const f = fixture()
    const controller = new AbortController()
    f.prompt.mockImplementationOnce(async () => { controller.abort(); return { ok: true, value: { accepted: true } } })
    await expect(f.bridge.createDelivery(input).send(controller.signal)).resolves.toMatchObject({ accepted: true })
  })

  it.each([new Error('offline'), null, { rpcError: null }, { rpcError: { code: 'gateway/internal' } }])(
    'wraps create failure without sending elsewhere', async error => {
      const f = fixture()
      f.create.mockRejectedValueOnce(error)
      await expect(f.bridge.createDelivery(input).send()).rejects.toMatchObject({ code: 'create-failed', cause: error })
      expect(f.prompt).not.toHaveBeenCalled()
    },
  )

  it('preserves partial-create identity and explicitly retries attachment with that id', async () => {
    const f = fixture()
    f.create.mockRejectedValueOnce(partialCreateError())
    const delivery = f.bridge.createDelivery(input)
    await expect(delivery.send()).rejects.toMatchObject({ code: 'workspace-attach-failed', sessionId: freshId })
    expect(delivery.getSnapshot()).toMatchObject({ createdSessionId: freshId, accepted: false })
    expect(f.prompt).not.toHaveBeenCalled()
    await delivery.send()
    expect(f.create.mock.calls).toEqual([[{ workspaceId }], [{ workspaceId, sessionId: freshId }]])
    expect(f.usingCalls[0].target).toBe(freshId)
  })

  it.each([undefined, {}, { sessionId: '' }, { sessionId: 42 }])(
    'never creates another session after an unidentified partial create', async details => {
      const f = fixture()
      f.create.mockRejectedValueOnce({ rpcError: { code: 'session/workspace-attach-failed', details } })
      const delivery = f.bridge.createDelivery(input)
      await expect(delivery.send()).rejects.toMatchObject({ code: 'workspace-attach-failed' })
      await expect(delivery.send()).rejects.toMatchObject({ code: 'workspace-attach-failed' })
      expect(f.create).toHaveBeenCalledTimes(1)
      expect(f.prompt).not.toHaveBeenCalled()
    },
  )

  it('passes the optional SDK request identity unchanged', async () => {
    const f = fixture()
    const requestId = 'request-1' as NonNullable<Parameters<SessionFace['prompt']>[3]>
    await f.bridge.createDelivery({ ...input, requestId }).send()
    expect(f.prompt.mock.calls[0][3]).toBe(requestId)
  })

  it('refuses attachment retry after the original workspace changes checkout', async () => {
    const f = fixture()
    f.create.mockRejectedValueOnce(partialCreateError())
    const delivery = f.bridge.createDelivery(input)
    await expect(delivery.send()).rejects.toMatchObject({ code: 'workspace-attach-failed' })
    f.workspaces.publish({ ...f.workspaces.getSnapshot(), items: [{ ...f.workspace, path: '/moved' }] })
    await expect(delivery.send()).rejects.toMatchObject({ code: 'cwd-mismatch', sessionId: freshId })
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.prompt).not.toHaveBeenCalled()
  })

  it('fails closed when the frozen checkout is empty or metadata has no cwd', async () => {
    const f = fixture()
    await expect(f.bridge.createDelivery({ ...input, expectedCwd: '' }).send()).rejects.toMatchObject({ code: 'cwd-mismatch' })
    delete f.catalog.getSnapshot().byId[sourceId].cwd
    f.workspaces.publish({ ...f.workspaces.getSnapshot(), items: [] })
    await expect(f.bridge.createDelivery(input).send()).rejects.toMatchObject({ code: 'cwd-mismatch' })
    expect(f.create).not.toHaveBeenCalled()
  })

  it('exposes typed errors with the diagnostic cause but no user-facing transport text', () => {
    const cause = new Error('details')
    const error = new SessionBridgeError('send-failed', freshId, cause)
    expect(error).toMatchObject({ name: 'SessionBridgeError', message: 'send-failed', code: 'send-failed', sessionId: freshId, cause })
  })
})

describe('retained turn-end subscription', () => {
  it('refreshes on appended turn/end and reconnect replacement, not old history or unrelated entries', async () => {
    const f = fixture()
    const refresh = vi.fn()
    f.events.publish({ entries: [turnEnd], hasMore: true, revision: 1, change: { kind: 'append', entries: [turnEnd] } })
    const dispose = f.bridge.subscribeTurnEnd(sourceId, refresh)
    f.ready.resolve({ eventSource: f.events })
    await Promise.resolve()
    expect(refresh).not.toHaveBeenCalled()
    publish(f, { kind: 'append', entries: [turnStart] })
    publish(f, { kind: 'prepend', entries: [turnEnd] })
    expect(refresh).not.toHaveBeenCalled()
    publish(f, { kind: 'append', entries: [turnStart, turnEnd] })
    expect(refresh).toHaveBeenLastCalledWith('turn-end')
    f.events.publish(f.events.getSnapshot())
    expect(refresh).toHaveBeenCalledTimes(1)
    publish(f, { kind: 'replace', entries: [turnEnd] })
    expect(refresh.mock.calls).toEqual([['turn-end'], ['reconnect']])
    dispose()
    dispose()
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(f.events.listeners.size).toBe(0)
    publish(f, { kind: 'append', entries: [turnEnd] })
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(f.retain.mock.calls[0][0]).toBe(sourceId)
    expect(f.retain.mock.calls[0][1].source).toBe('dshNextGit')
    expect(f.retain.mock.calls[0][1].signal?.aborted).toBe(true)
  })

  it.each(['resolve', 'reject'] as const)('cleans pending ready and ignores its later %s', async outcome => {
    const f = fixture()
    const refresh = vi.fn()
    const failed = vi.fn()
    const dispose = f.bridge.subscribeTurnEnd(sourceId, refresh, failed)
    dispose()
    if (outcome === 'resolve') f.ready.resolve({ eventSource: f.events })
    else f.ready.reject(new Error('cancelled ready'))
    await Promise.resolve()
    await Promise.resolve()
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(f.events.subscribe).not.toHaveBeenCalled()
    expect(failed).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('reports ready failure and releases immediately', async () => {
    const f = fixture()
    const failed = vi.fn()
    const dispose = f.bridge.subscribeTurnEnd(sourceId, vi.fn(), failed)
    f.ready.reject(new Error('history unavailable'))
    await Promise.resolve()
    await Promise.resolve()
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'subscription-failed', sessionId: sourceId }))
    expect(f.release).toHaveBeenCalledTimes(1)
    dispose()
    expect(f.release).toHaveBeenCalledTimes(1)
  })

  it('reports synchronous retain failure and returns a safe disposer', () => {
    const f = fixture()
    const failed = vi.fn()
    f.retain.mockImplementationOnce(() => { throw new Error('unavailable') })
    const dispose = f.bridge.subscribeTurnEnd(sourceId, vi.fn(), failed)
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'subscription-failed' }))
    dispose()
    expect(f.release).not.toHaveBeenCalled()
  })

  it('releases a retained reference when subscription setup fails', async () => {
    const f = fixture()
    const failed = vi.fn()
    f.events.subscribe.mockImplementationOnce(() => { throw new Error('subscribe failed') })
    f.bridge.subscribeTurnEnd(sourceId, vi.fn(), failed)
    f.ready.resolve({ eventSource: f.events })
    await Promise.resolve()
    await Promise.resolve()
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'subscription-failed' }))
  })
})
