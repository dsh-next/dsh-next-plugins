import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ISessions, SessionFace, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AgentActionDialog, type AgentActionRequest, type AgentSessionControls } from '../src/client/ai/action-dialog.tsx'
import { createSessionBridge, type SessionBridgeDependencies } from '../src/client/ai/session-bridge.ts'
import { PanelStore } from '../src/client/controller.ts'
import type { GitApi } from '../src/client/api.ts'
import type { Translate } from '../src/client/GitPanel.tsx'
import type { AgentFileInput } from '../src/core/agent-verbs.ts'
import type { PanelState } from '../src/core/types.ts'
import { useDialogFocus } from '../src/client/ui/dialog-focus.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const sourceId = 'pane-source' as SessionId
const createdId = 'new-session' as SessionId
const cwd = '/repo/nested'
// Key labels keep the dialog suite independent of concurrently edited dictionaries.
const t: Translate = (key, params) => params ? key + ' ' + JSON.stringify(params) : key

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function state(): PanelState {
  return {
    root: '/repo', cwd, gitDir: '/repo/.git', bare: false,
    head: { oid: 'abc', branch: 'feature', upstream: null, ahead: 0, behind: 0, detached: false, unborn: false },
    operation: { kind: 'merge', step: null, message: null, conflicts: ['conflict.ts'] },
    changes: { staged: [], unstaged: [], untracked: [], ignored: [], conflicts: [], ignoredCount: 0, ignoredTruncated: false },
    worktrees: [], worktreeBase: { name: 'main', source: 'default-branch', candidates: ['main'] },
    branches: [], tags: [], identity: { name: 'Ada', email: 'ada@example.test' },
  }
}
const files: AgentFileInput[] = [
  { path: 'staged.ts', patch: '+staged evidence', added: 1, removed: 0, binary: false, staged: true },
  { path: 'unstaged.ts', patch: '+unstaged evidence', added: 1, removed: 0, binary: false, staged: false },
  { path: 'conflict.ts', patch: '+conflict evidence', added: 1, removed: 0, binary: false, staged: false },
]
type AgentFiles = { state: PanelState; files: readonly AgentFileInput[]; omittedPaths?: readonly string[] }

function fixture() {
  let currentState = state()
  const reads = vi.fn(async (args: Record<string, unknown>): Promise<AgentFiles> => ({
    state: currentState,
    files: files.filter(file => (!Array.isArray(args.paths) || args.paths.includes(file.path))
      && (args.side === undefined || file.staged === (args.side === 'staged'))),
  }))
  const api: GitApi = {
    async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
      if (method !== 'agentFiles') throw new Error('Unexpected RPC: ' + method)
      // The generic RPC boundary is the only payload assertion; all fixtures are typed.
      return await reads(args) as T
    },
  }
  const store = new PanelStore(api, sourceId)
  const queued = vi.spyOn(store, 'agentQueued')
  const catalog: SessionListState = {
    ids: [sourceId], phase: 'ready', subagentsByParent: {}, jobsBySession: {},
    byId: { [sourceId]: { id: sourceId, displayTitle: 'Pane source', cwd, blank: true, running: false, retainedBy: {}, updatedAt: 0 } },
  }
  const prompt = vi.fn<SessionFace['prompt']>().mockResolvedValue({ ok: true, value: { accepted: true } })
  const create = vi.fn<ISessions['create']>().mockResolvedValue(createdId)
  const openSession = vi.fn<SessionBridgeDependencies['uiWorkspace']['openSession']>()
  const deps: SessionBridgeDependencies = {
    sessions: {
      list: { getSnapshot: () => catalog, subscribe: () => () => {} }, create,
      async using(_target, _options, operation) { return operation({ binding: { session: { prompt } } }) },
      retain() { throw new Error('Dialog must not subscribe to task completion') },
    },
    workspaces: { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [], phase: 'ready', state: 'idle', error: null }), subscribe: () => () => {} } },
    uiWorkspace: { openSession },
  }
  const using = vi.spyOn(deps.sessions, 'using')
  const bridge = createSessionBridge(deps)
  const createDelivery = vi.fn<AgentSessionControls['createDelivery']>(input => bridge.createDelivery({ ...input, sourceSessionId: sourceId }))
  const sessions: AgentSessionControls = { getSource: () => bridge.getSource(sourceId), createDelivery, subscribeRefresh: () => () => {} }
  const onClose = vi.fn()
  return { store, queued, reads, catalog, prompt, create, openSession, using, sessions, createDelivery, onClose,
    setState(value: PanelState) { currentState = value } }
}
type Fixture = ReturnType<typeof fixture>
let root: Root | undefined
let container: HTMLDivElement
let trigger: HTMLButtonElement
const stores: PanelStore[] = []

beforeEach(() => {
  trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root?.unmount())
  for (const store of stores.splice(0)) store.dispose()
  container.remove()
  trigger.remove()
  vi.restoreAllMocks()
})
async function render(f: Fixture, request: AgentActionRequest = { verb: 'review' }, strict = false) {
  if (!stores.includes(f.store)) stores.push(f.store)
  const dialog = <AgentActionDialog request={request} store={f.store} sessions={f.sessions} t={t} onClose={f.onClose} />
  await act(async () => root!.render(strict ? <React.StrictMode>{dialog}</React.StrictMode> : dialog))
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(element => element.textContent === text)
  expect(found, 'button ' + text).toBeDefined()
  return found!
}
function radio(target: 'current' | 'new'): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[value="' + target + '"]')!
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
async function key(element: HTMLElement, value: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })
  await act(async () => { element.dispatchEvent(event) })
  return event
}
function preview() { return document.querySelector('pre')?.textContent }
function alert() { return document.querySelector('[role="alert"]')?.textContent }
function noDelivery(f: Fixture) {
  expect(f.createDelivery).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
  expect(f.prompt).not.toHaveBeenCalled()
  expect(f.queued).not.toHaveBeenCalled()
}
async function start(target: 'current' | 'new') {
  await click(radio(target))
  await click(button('agent.start'))
}

describe('mandatory AI destination dialog', () => {
  it('previews read-only context without a default, creation or submission', async () => {
    const f = fixture()
    await render(f)
    expect(f.reads).toHaveBeenCalledExactlyOnceWith({ sessionId: sourceId, verb: 'review' })
    expect(preview()).toContain('Review the uncommitted changes')
    expect(document.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0)
    expect(button('agent.start').disabled).toBe(true)
    await click(button('agent.start'))
    noDelivery(f)
    expect(document.body.textContent).toContain('agent.queueHint')
    expect(document.body.textContent).toContain('agent.readPermission')
    expect(document.body.textContent).toContain('Pane source')
  })

  it.each(['current', 'new'] as const)('delivers scoped context to %s with the source cwd, not the repository root', async target => {
    const f = fixture()
    const request: AgentActionRequest = { verb: 'explain', scope: { paths: ['unstaged.ts'], side: 'unstaged' } }
    await render(f, request)
    const text = preview()
    expect(text).toContain('+unstaged evidence')
    expect(text).not.toContain('+staged evidence')
    await click(radio(target))
    noDelivery(f)
    await click(button('agent.start'))
    expect(f.reads).toHaveBeenCalledTimes(2)
    expect(f.reads).toHaveBeenLastCalledWith({ sessionId: sourceId, verb: 'explain', paths: ['unstaged.ts'], side: 'unstaged' })
    expect(f.createDelivery).toHaveBeenCalledExactlyOnceWith({ target, expectedCwd: cwd, text })
    expect(f.using.mock.calls[0]?.[0]).toBe(target === 'current' ? sourceId : createdId)
    expect(f.prompt).toHaveBeenCalledExactlyOnceWith([{ type: 'text', text }], 'queue', expect.any(AbortSignal), expect.any(String))
    expect(f.create.mock.calls).toEqual(target === 'new' ? [[{ cwd }]] : [])
    expect(f.openSession.mock.calls).toEqual(target === 'new' ? [[createdId]] : [])
    expect(f.onClose).toHaveBeenCalledTimes(1)
    expect(f.store.getSnapshot().notice).toBe('agent.sent')
    expect(f.store.getSnapshot().state).toBeNull() // Queue admission is not Git task completion.
  })

  it.each([
    { verb: 'review', phrase: 'Review the uncommitted changes' },
    { verb: 'explain', phrase: 'Explain what the change below does' },
    { verb: 'draft', phrase: 'Draft a single Conventional Commit' },
    { verb: 'resolve', phrase: 'Resolve only the conflicts' },
  ] as const)('supports $verb without silently submitting', async ({ verb, phrase }) => {
    const f = fixture()
    await render(f, { verb })
    expect(preview()).toContain(phrase)
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('agent.' + verb)
    expect(document.body.textContent).toContain(verb === 'resolve' ? 'agent.editPermission' : 'agent.readPermission')
    noDelivery(f)
    await start('current')
    expect(f.prompt).toHaveBeenCalledTimes(1)
  })

  it.each([
    { entry: 'commit composer', scope: { side: 'staged' as const }, included: '+staged evidence', excluded: '+unstaged evidence' },
    { entry: 'diff action', scope: { paths: ['unstaged.ts'], side: 'unstaged' as const }, included: '+unstaged evidence', excluded: '+staged evidence' },
  ])('honors parent-controlled draft scope from $entry', async ({ scope, included, excluded }) => {
    const f = fixture()
    f.store.setMessage('Human draft remains unchanged')
    await render(f, { verb: 'draft', scope })
    expect(preview()).toContain(included)
    expect(preview()).not.toContain(excluded)
    await start('new')
    expect(f.reads).toHaveBeenLastCalledWith({ sessionId: sourceId, verb: 'draft', ...scope })
    expect(f.store.getSnapshot().message).toBe('Human draft remains unchanged')
  })

  it.each(['button', 'Escape'] as const)('cancels the initial dialog with %s without side effects', async method => {
    const f = fixture()
    await render(f)
    if (method === 'button') await click(button('confirm.cancel'))
    else await key(document.activeElement as HTMLElement, 'Escape')
    expect(f.onClose).toHaveBeenCalledTimes(1)
    noDelivery(f)
  })

  it('requires a new choice after refreshing stale preview evidence', async () => {
    const f = fixture()
    await render(f)
    f.setState({ ...state(), head: { ...state().head, branch: 'changed' } })
    await start('new')
    noDelivery(f)
    expect(alert()).toBe('agent.contextChanged')
    expect(preview()).toContain('Branch: changed')
    expect(document.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0)
    expect(button('agent.start').disabled).toBe(true)
    await start('current')
    expect(f.createDelivery.mock.calls[0]?.[0].text).toContain('Branch: changed')
    expect(f.create).not.toHaveBeenCalled()
  })

  it('recovers an initial context read failure without dismissing or submitting', async () => {
    const f = fixture()
    f.reads.mockRejectedValueOnce(new Error('unreadable'))
    await render(f)
    expect(alert()).toBe('agent.error.context')
    await click(button('state.retry'))
    expect(alert()).toBeUndefined()
    expect(preview()).toContain('Review the uncommitted changes')
    noDelivery(f)
    expect(button('agent.start').disabled).toBe(true)
    await start('current')
    expect(f.prompt).toHaveBeenCalledTimes(1)
  })

  it('retries revalidation read failures before creating a delivery', async () => {
    const f = fixture()
    await render(f)
    f.reads.mockRejectedValueOnce(new Error('read failed'))
    await start('current')
    expect(alert()).toBe('agent.error.context')
    noDelivery(f)
    await click(button('agent.start'))
    expect(f.prompt).toHaveBeenCalledTimes(1)
  })

  it.each(['current', 'new'] as const)('reuses the %s delivery and request identity after send failure', async target => {
    const f = fixture()
    f.prompt.mockRejectedValueOnce(new Error('lost acknowledgement'))
    await render(f)
    await start(target)
    expect(alert()).toBe('agent.error.send-failed')
    expect(f.queued).not.toHaveBeenCalled()
    if (target === 'new') expect(document.body.textContent).toContain('agent.createdRetry')
    expect(radio('current').matches(':disabled')).toBe(true)
    const firstCall = f.prompt.mock.calls[0]
    f.setState({ ...state(), head: { ...state().head, branch: 'later' } })
    await click(button('agent.start'))
    expect(f.createDelivery).toHaveBeenCalledTimes(1)
    expect(f.create).toHaveBeenCalledTimes(target === 'new' ? 1 : 0)
    expect(f.reads).toHaveBeenCalledTimes(2)
    expect(f.prompt).toHaveBeenCalledTimes(2)
    expect(f.prompt.mock.calls[1]?.[0]).toEqual(firstCall?.[0])
    expect(f.prompt.mock.calls[1]?.[3]).toBe(firstCall?.[3])
    expect(f.queued).toHaveBeenCalledTimes(1)
  })

  it('retries creation on the same delivery after a creation failure', async () => {
    const f = fixture()
    f.create.mockRejectedValueOnce(new Error('create failed'))
    await render(f)
    await start('new')
    expect(alert()).toBe('agent.error.create-failed')
    expect(f.prompt).not.toHaveBeenCalled()
    await click(button('agent.start'))
    expect(f.createDelivery).toHaveBeenCalledTimes(1)
    expect(f.create).toHaveBeenCalledTimes(2)
    expect(f.prompt).toHaveBeenCalledTimes(1)
  })

  it('names partial workspace attachment failure and retries the same created identity', async () => {
    const f = fixture()
    f.create.mockRejectedValueOnce(Object.assign(new Error('attach failed'), {
      rpcError: { code: 'session/workspace-attach-failed', details: { sessionId: createdId } },
    }))
    await render(f)
    await start('new')
    expect(alert()).toBe('agent.error.workspace-attach-failed')
    expect(document.body.textContent).toContain('agent.createdRetry')
    expect(f.prompt).not.toHaveBeenCalled()
    await click(button('agent.start'))
    expect(f.createDelivery).toHaveBeenCalledTimes(1)
    expect(f.create).toHaveBeenLastCalledWith({ cwd, sessionId: createdId })
    expect(f.prompt).toHaveBeenCalledTimes(1)
  })

  it('retries only navigation when an accepted new session cannot open', async () => {
    const f = fixture()
    f.openSession.mockImplementationOnce(() => { throw new Error('navigation failed') })
    await render(f)
    await start('new')
    expect(alert()).toBe('agent.error.open-failed')
    expect(f.onClose).not.toHaveBeenCalled()
    expect(f.queued).toHaveBeenCalledTimes(1)
    await click(button('agent.openSession'))
    expect(f.openSession).toHaveBeenCalledTimes(2)
    expect(f.prompt).toHaveBeenCalledTimes(1)
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.queued).toHaveBeenCalledTimes(1)
    expect(f.onClose).toHaveBeenCalledTimes(1)
  })

  it('names cancellation after session creation and retains the identity for retry', async () => {
    const f = fixture()
    f.prompt.mockResolvedValueOnce({ ok: false, error: Object.assign(new Error('cancelled'), { code: 'gateway/cancelled' as const, details: {}, isDSHRemoteError: true as const }) })
    await render(f)
    await start('new')
    expect(alert()).toBe('agent.error.cancelled')
    expect(document.body.textContent).toContain('agent.createdRetry')
    expect(f.onClose).not.toHaveBeenCalled()
    await click(button('agent.start'))
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.createDelivery).toHaveBeenCalledTimes(1)
  })

  it('disables both destinations when the source is absent', async () => {
    const f = fixture()
    delete f.catalog.byId[sourceId]
    await render(f)
    expect(radio('current').disabled).toBe(true)
    expect(radio('new').disabled).toBe(true)
    expect(button('agent.start').disabled).toBe(true)
    expect(document.body.textContent).toContain('agent.unavailable')
    noDelivery(f)
  })

  it('reports a source removed after preview without creating or submitting', async () => {
    const f = fixture()
    await render(f)
    await click(radio('new'))
    delete f.catalog.byId[sourceId]
    await click(button('agent.start'))
    expect(alert()).toBe('agent.error.missing-source')
    expect(f.create).not.toHaveBeenCalled()
    expect(f.prompt).not.toHaveBeenCalled()
  })

  it('rejects a source cwd changed after preview instead of sending to the wrong checkout', async () => {
    const f = fixture()
    await render(f)
    f.catalog.byId[sourceId].cwd = '/different'
    await start('new')
    expect(alert()).toBe('agent.error.cwd-mismatch')
    expect(f.create).not.toHaveBeenCalled()
    expect(f.prompt).not.toHaveBeenCalled()
  })

  it('does not report queue admission for a rejected prompt', async () => {
    const f = fixture()
    f.prompt.mockResolvedValueOnce({ ok: false, error: Object.assign(new Error('rejected'), { code: 'gateway/internal' as const, details: {}, isDSHRemoteError: true as const }) })
    await render(f)
    await start('current')
    expect(alert()).toBe('agent.error.prompt-rejected')
    expect(f.queued).not.toHaveBeenCalled()
    expect(f.onClose).not.toHaveBeenCalled()
    await click(button('agent.start'))
    expect(f.createDelivery).toHaveBeenCalledTimes(1)
    expect(f.queued).toHaveBeenCalledTimes(1)
  })

  it('guards duplicate Start events while revalidating and submitting', async () => {
    const f = fixture()
    const pending = deferred<AgentFiles>()
    const sending = deferred<Awaited<ReturnType<SessionFace['prompt']>>>()
    await render(f)
    f.reads.mockReturnValueOnce(pending.promise)
    f.prompt.mockReturnValueOnce(sending.promise)
    await click(radio('new'))
    const action = button('agent.start')
    await act(async () => { action.click(); action.click() })
    expect(f.reads).toHaveBeenCalledTimes(2)
    noDelivery(f)
    await act(async () => pending.resolve({ state: state(), files }))
    expect(button('busy.agent').disabled).toBe(true)
    await click(button('busy.agent'))
    expect(f.prompt).toHaveBeenCalledTimes(1)
    await act(async () => sending.resolve({ ok: true, value: { accepted: true } }))
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.queued).toHaveBeenCalledTimes(1)
  })

  it('shows detached and truncated evidence explicitly', async () => {
    const f = fixture()
    f.reads.mockResolvedValue({ state: { ...state(), head: { ...state().head, branch: null, detached: true } }, files, omittedPaths: ['omitted.ts'] })
    await render(f)
    expect(document.body.textContent).toContain('header.detached')
    expect(document.body.textContent).toContain('agent.truncated')
    expect(document.body.textContent).toContain('agent.fileCount {"count":3}')
    noDelivery(f)
  })
})

describe('dialog async lifetime and keyboard behavior', () => {
  it.each(['resolve', 'reject'] as const)('ignores late preparation %s after unmount', async outcome => {
    const f = fixture()
    const pending = deferred<AgentFiles>()
    f.reads.mockReturnValueOnce(pending.promise)
    await render(f)
    act(() => { root!.unmount(); root = undefined })
    await act(async () => {
      if (outcome === 'resolve') pending.resolve({ state: state(), files })
      else pending.reject(new Error('late failure'))
    })
    noDelivery(f)
    expect(f.onClose).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('aborts sending and ignores late prompt %s after unmount', async outcome => {
    const f = fixture()
    const pending = deferred<Awaited<ReturnType<SessionFace['prompt']>>>()
    f.prompt.mockReturnValueOnce(pending.promise)
    await render(f)
    await start('new')
    const signal = f.prompt.mock.calls[0]?.[2]
    expect(signal?.aborted).toBe(false)
    act(() => { root!.unmount(); root = undefined })
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      if (outcome === 'resolve') pending.resolve({ ok: true, value: { accepted: true } })
      else pending.reject(new Error('late failure'))
    })
    expect(f.queued).not.toHaveBeenCalled()
    expect(f.onClose).not.toHaveBeenCalled()
    expect(f.openSession).not.toHaveBeenCalled()
  })

  it('ignores late session creation after unmount without sending a prompt', async () => {
    const f = fixture()
    const pending = deferred<SessionId>()
    f.create.mockReturnValueOnce(pending.promise)
    await render(f)
    await start('new')
    act(() => { root!.unmount(); root = undefined })
    await act(async () => pending.resolve(createdId))
    expect(f.prompt).not.toHaveBeenCalled()
    expect(f.openSession).not.toHaveBeenCalled()
    expect(f.onClose).not.toHaveBeenCalled()
  })

  it('does not create a delivery when revalidation finishes after unmount', async () => {
    const f = fixture()
    const pending = deferred<AgentFiles>()
    await render(f)
    f.reads.mockReturnValueOnce(pending.promise)
    await start('new')
    act(() => { root!.unmount(); root = undefined })
    await act(async () => pending.resolve({ state: state(), files }))
    noDelivery(f)
  })

  it('invalidates in-flight work when close is requested before the parent unmounts', async () => {
    const f = fixture()
    const pending = deferred<AgentFiles>()
    await render(f)
    f.reads.mockReturnValueOnce(pending.promise)
    await start('new')
    await click(button('confirm.cancel'))
    await act(async () => pending.resolve({ state: state(), files }))
    noDelivery(f)
    expect(f.onClose).toHaveBeenCalledTimes(1)
  })

  it.each(['resolve', 'reject'] as const)('ignores superseded preparation %s on a new request', async outcome => {
    const f = fixture()
    const old = deferred<AgentFiles>()
    f.reads.mockReturnValueOnce(old.promise)
    await render(f, { verb: 'review' })
    await render(f, { verb: 'explain', scope: { paths: ['unstaged.ts'] } })
    await act(async () => {
      if (outcome === 'resolve') old.resolve({ state: state(), files })
      else old.reject(new Error('obsolete failure'))
    })
    expect(alert()).toBeUndefined()
    expect(preview()).toContain('Explain what the change below does')
    expect(preview()).not.toContain('+staged evidence')
    noDelivery(f)
  })

  it('does not resurrect a StrictMode-disposed preparation failure', async () => {
    const f = fixture()
    const old = deferred<AgentFiles>()
    f.reads.mockReturnValueOnce(old.promise)
    await render(f, { verb: 'review' }, true)
    await act(async () => old.reject(new Error('obsolete read')))
    expect(preview()).toContain('Review the uncommitted changes')
    expect(alert()).toBeUndefined()
  })

  it('resets destination and aborts old delivery when the parent changes request', async () => {
    const f = fixture()
    const pending = deferred<Awaited<ReturnType<SessionFace['prompt']>>>()
    f.prompt.mockReturnValueOnce(pending.promise)
    await render(f)
    await start('new')
    const signal = f.prompt.mock.calls[0]?.[2]
    await render(f, { verb: 'draft', scope: { side: 'staged' } })
    expect(signal?.aborted).toBe(true)
    expect(document.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0)
    await act(async () => pending.resolve({ ok: true, value: { accepted: true } }))
    expect(f.queued).not.toHaveBeenCalled()
    expect(f.onClose).not.toHaveBeenCalled()
    await start('current')
    expect(f.createDelivery).toHaveBeenCalledTimes(2)
    expect(f.createDelivery.mock.calls[1]?.[0].text).toContain('Draft a single Conventional Commit')
  })

  it('contains Tab and Shift+Tab and restores the initiating control on unmount', async () => {
    const f = fixture()
    await render(f)
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const first = document.activeElement as HTMLElement
    expect(dialog.contains(first)).toBe(true)
    await click(radio('current'))
    const last = button('agent.start')
    last.focus()
    expect((await key(last, 'Tab')).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
    expect((await key(first, 'Tab', true)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
    act(() => { root!.unmount(); root = undefined })
    expect(document.activeElement).toBe(trigger)
  })

  it('moves and selects destinations with arrows, Home/End and Space without submitting', async () => {
    const f = fixture()
    await render(f)
    radio('current').focus()
    await key(radio('current'), 'ArrowRight')
    expect(document.activeElement).toBe(radio('new'))
    expect(radio('new').checked).toBe(true)
    await key(radio('new'), 'ArrowDown')
    expect(radio('current').checked).toBe(true)
    await key(radio('current'), 'End')
    expect(radio('new').checked).toBe(true)
    await key(radio('new'), 'Home')
    expect(radio('current').checked).toBe(true)
    await key(radio('current'), 'ArrowLeft')
    expect(radio('new').checked).toBe(true)
    await key(radio('new'), 'ArrowUp')
    expect(radio('current').checked).toBe(true)
    radio('new').focus()
    await key(radio('new'), ' ')
    expect(radio('new').checked).toBe(true)
    noDelivery(f)
  })

  it('restores focus after Escape when the parent closes the dialog', async () => {
    const f = fixture()
    f.onClose.mockImplementation(() => { root!.render(null) })
    await render(f)
    await key(document.activeElement as HTMLElement, 'Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    noDelivery(f)
  })

  it('contains programmatic focus escape while pending and does not alter disabled choices', async () => {
    const f = fixture()
    const pending = deferred<Awaited<ReturnType<SessionFace['prompt']>>>()
    f.prompt.mockReturnValueOnce(pending.promise)
    await render(f)
    await start('current')
    trigger.focus()
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true)
    await key(radio('current'), 'ArrowRight')
    expect(radio('new').checked).toBe(false)
    await act(async () => pending.resolve({ ok: true, value: { accepted: true } }))
  })
})

function FocusFixture({ children }: { children?: React.ReactNode }) {
  const body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)
  return <div role="dialog" aria-modal="true"><div ref={body}>{children}</div></div>
}

describe('shared dialog focus edge cases', () => {
  it('focuses the dialog and prevents both Tab directions when no control is enabled', async () => {
    await act(async () => root!.render(<FocusFixture><button disabled>disabled</button></FocusFixture>))
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(document.activeElement).toBe(dialog)
    for (const shift of [false, true]) {
      expect((await key(dialog, 'Tab', shift)).defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(dialog)
    }
  })

  it('excludes hidden, inert, negative-tabindex and disabled-fieldset controls', async () => {
    await act(async () => root!.render(<FocusFixture>
      <div hidden><button>hidden</button></div>
      <div aria-hidden="true"><button>aria hidden</button></div>
      <div ref={node => node?.setAttribute('inert', '')}><button>inert</button></div>
      <button tabIndex={-1}>not tabbable</button>
      <fieldset disabled><input /></fieldset>
      <button>only tabbable</button>
    </FocusFixture>))
    const only = button('only tabbable')
    expect(document.activeElement).toBe(only)
    expect((await key(only, 'Tab')).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(only)
    expect((await key(only, 'Tab', true)).defaultPrevented).toBe(true)
  })

  it('does not steal focus from a nested modal and restores each origin', async () => {
    await act(async () => root!.render(<FocusFixture><button>outer</button></FocusFixture>))
    const outer = button('outer')
    const innerContainer = document.createElement('div')
    document.body.append(innerContainer)
    const innerRoot = createRoot(innerContainer)
    try {
      await act(async () => innerRoot.render(<FocusFixture><button>inner</button></FocusFixture>))
      expect(document.activeElement).toBe(button('inner'))
      trigger.focus()
      expect(document.activeElement).toBe(button('inner'))
    } finally {
      act(() => innerRoot.unmount())
      innerContainer.remove()
    }
    expect(document.activeElement).toBe(outer)
    act(() => { root!.unmount(); root = undefined })
    expect(document.activeElement).toBe(trigger)
  })

  it('does not restore a removed trigger or retain focus listeners after unmount', async () => {
    await act(async () => root!.render(<FocusFixture><button>inside</button></FocusFixture>))
    trigger.remove()
    act(() => { root!.unmount(); root = undefined })
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})
