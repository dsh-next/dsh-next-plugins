/**
 * jsdom render test for the AI result card.
 *
 * Proves the card renders a settled draft answer from the real
 * createAiTaskResults feed, hides reasoning and tool output, waits when there is
 * no answer yet, writes the commit draft only through an explicit Use action
 * (and a confirmation when a draft exists), refuses a stale repository, keeps
 * non-draft answers out of the commit composer, and disposes its store
 * subscription on unmount. Assertions cover rendered text, the arguments the
 * card passes to the store, and the absence of writes where a write must not
 * happen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SessionEventLikeEntry, SessionEventWindow, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AgentResults } from '../src/client/ai/AgentResults.tsx'
import {
  createAiTaskResults,
  type AiTaskAdmission,
  type AiTaskRecord,
  type AiTaskResults,
  type AiTaskResultsDependencies,
} from '../src/client/ai/task-results.ts'
import type { AgentSessionControls } from '../src/client/ai/action-dialog.tsx'
import type { PanelSnapshot, PanelStore, PreparedAgentAction } from '../src/client/controller.ts'
import type { PanelState } from '../src/core/types.ts'
import type { Translate } from '../src/client/GitPanel.tsx'
import { en } from '../src/client/dictionaries/en.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const sourceId = 'source' as SessionId
const targetId = 'target' as SessionId
const ROOT = '/repo'
const CWD = '/repo/src'
const FINGERPRINT = 'fingerprint-v1'
const FINAL = 'feat: settle the ai result'
const REASONING = 'private chain of thought'
const TOOL_OUTPUT = 'raw tool output'
const DRAFT = 'Existing human draft'
const UNUSED_DELIVERY = 'AgentResults must not create deliveries'

/** English is the key source, so the real strings are the expected output. */
const t: Translate = (key) => en[key]

function admission(verb = 'draft', requestId = 'request'): AiTaskAdmission {
  return {
    accepted: true, sourceSessionId: sourceId, targetSessionId: targetId,
    requestId: requestId as SessionRequestId, root: ROOT, cwd: CWD, verb, fingerprint: FINGERPRINT,
  }
}

function event(type: string, data: unknown, seq: number): SessionEventLikeEntry {
  return { type: 'event', event: { type, data, seq, time: 0, surfaceOp: 'append' } } as SessionEventLikeEntry
}

/**
 * A completed turn whose final message carries reasoning next to the answer,
 * plus tool events that a live session window also contains. Only the text
 * block is adoptable.
 */
function settled(request = 'request', text = FINAL): SessionEventLikeEntry[] {
  return [
    event('turn/start', { turn: 1 }, 1),
    event('user/message', { role: 'user', source: { kind: 'user', rpcId: request }, content: [] }, 2),
    event('tool/call', { turn: 1, callId: 'call-1', name: 'read_file', input: {} }, 3),
    event('tool/result', { turn: 1, callId: 'call-1', output: TOOL_OUTPUT }, 4),
    event('assistant/message', {
      turn: 1, step: 1,
      message: { content: [{ type: 'reasoning', text: REASONING }, { type: 'text', text }] }, stream: [],
    }, 20),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 21),
  ]
}

/** A real AiTaskResults whose session window the test drives directly. */
function taskFixture() {
  let window: SessionEventWindow = { entries: [], revision: 0, hasMore: false, change: { kind: 'replace', entries: [] } }
  const watchers = new Set<() => void>()
  const release = vi.fn()
  const eventSource = {
    getSnapshot: () => window,
    subscribe: (fn: () => void) => { watchers.add(fn); return () => { watchers.delete(fn) } },
  }
  const retained = vi.fn(() => ({ release, ready: Promise.resolve({ eventSource }) }))
  const sessions: AiTaskResultsDependencies['sessions'] = {
    retain: retained,
    list: {
      getSnapshot: () => ({ byId: { [targetId]: { id: targetId, cwd: CWD } } } as unknown as SessionListState),
      subscribe: () => () => {},
    },
  }
  const results = createAiTaskResults({ sessions, sourceSessionId: sourceId, root: ROOT, storage: null })
  disposables.push(results)
  const emit = async (entries: SessionEventLikeEntry[], more = false): Promise<void> => {
    window = { entries, revision: window.revision + 1, hasMore: more, change: { kind: 'append', entries } }
    for (const notify of [...watchers]) notify()
    await Promise.resolve()
  }
  return { results, retained, release, watchers, emit }
}

const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

/** Admit one task and drive its turn to the settled answer before rendering. */
async function settledTask(verb = 'draft'): Promise<{
  results: AiTaskResults
  emit: (entries: SessionEventLikeEntry[], more?: boolean) => Promise<void>
  record: AiTaskRecord
}> {
  const f = taskFixture()
  f.results.admit(admission(verb))
  await tick()
  await f.emit(settled())
  return { ...f, record: f.results.getSnapshot().records[0]! }
}

/**
 * The store face the card needs: a mirror commit message and a scripted
 * prepareAgentAction. Everything else on PanelStore is unused by the card.
 */
function storeDouble(options: {
  message?: string
  record?: AiTaskRecord
  repositoryVersion?: string
  root?: string
  fingerprint?: string
} = {}) {
  let message = options.message ?? ''
  const setMessage = vi.fn((value: string) => { message = value })
  const root = options.root ?? options.record?.root ?? ROOT
  const fingerprint = options.fingerprint ?? options.record?.fingerprint ?? FINGERPRINT
  const prepareAgentAction = vi.fn(async (): Promise<PreparedAgentAction> => ({
    payload: { verb: 'draft', prompt: '', includedFiles: [], droppedFiles: [], truncated: false },
    state: { root } as PanelState,
    fingerprint,
    ...(options.repositoryVersion === undefined ? {} : { repositoryVersion: options.repositoryVersion }),
  }))
  const store = {
    isDisposed: false,
    getSnapshot: () => ({ message } as PanelSnapshot),
    setMessage,
    prepareAgentAction,
  } as unknown as PanelStore
  return { store, prepareAgentAction, setMessage, message: () => message }
}

function sessionsDouble(openSession = vi.fn()): AgentSessionControls {
  return {
    getSource: () => ({ sessionId: sourceId, title: 'Test session', cwd: CWD }),
    createDelivery: () => { throw new Error(UNUSED_DELIVERY) },
    subscribeRefresh: () => () => {},
    openSession,
  }
}

let container: HTMLDivElement
let root: Root | undefined
const disposables: AiTaskResults[] = []

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  for (const results of disposables.splice(0)) results.dispose()
  act(() => { root?.unmount() })
  root = undefined
  container.remove()
  vi.restoreAllMocks()
})

async function render(results: AiTaskResults, store: PanelStore, sessions: AgentSessionControls = sessionsDouble()): Promise<void> {
  await act(async () => {
    root!.render(<AgentResults results={results} sessions={sessions} store={store} t={t} />)
  })
}

function button(text: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll('button')].find(element => element.textContent === text)
}
function preview(): string | undefined { return document.querySelector('pre')?.textContent ?? undefined }
function alertText(): string | undefined { return document.querySelector('[role="alert"]')?.textContent ?? undefined }

describe('AI result card', () => {
  it('renders a settled answer live and hides reasoning and tool output', async () => {
    const f = taskFixture()
    f.results.admit(admission())
    await tick()
    const openSession = vi.fn()
    const store = storeDouble({ record: f.results.getSnapshot().records[0] })
    await render(f.results, store.store, sessionsDouble(openSession))

    // Admitted but unsettled: the card already exists and waits.
    expect(document.querySelector('[data-dsh-git="agent-results"]')).not.toBeNull()
    expect(preview()).toBeUndefined()
    expect(document.body.textContent).toContain(en['agent.result.phase.queued'])

    await act(async () => { await f.emit(settled()) })

    expect(preview()).toBe(FINAL)
    expect(document.body.textContent).toContain(en['agent.draft'])
    expect(document.body.textContent).toContain(en['agent.result.phase.needs-review'])
    expect(document.body.textContent).not.toContain(REASONING)
    expect(document.body.textContent).not.toContain(TOOL_OUTPUT)

    const open = button(en['agent.openSession'])!
    expect(open.disabled).toBe(false)
    await act(async () => { open.click() })
    expect(openSession).toHaveBeenCalledExactlyOnceWith(targetId)
  })

  it('shows a waiting phase for a task with no answer yet', async () => {
    const f = taskFixture()
    f.results.admit(admission())
    await tick()
    await render(f.results, storeDouble().store)

    expect(document.querySelector('[data-dsh-git="agent-results"]')).not.toBeNull()
    expect(preview()).toBeUndefined()
    expect(document.body.textContent).toContain(en['agent.result.phase.queued'])
    expect(document.body.textContent).toContain(en['agent.draft'])
    // No adoption affordance exists while there is nothing to adopt.
    expect(button(en['agent.result.useMessage'])).toBeUndefined()
  })

  it('writes the final text exactly once through the explicit Use action', async () => {
    const task = await settledTask()
    const store = storeDouble({ record: task.record })
    await render(task.results, store.store)

    const use = button(en['agent.result.useMessage'])!
    expect(use.disabled).toBe(false)
    await act(async () => { use.click() })

    expect(store.prepareAgentAction).toHaveBeenCalledExactlyOnceWith('draft', { side: 'staged' })
    expect(store.setMessage).toHaveBeenCalledExactlyOnceWith(FINAL)
    expect(store.message()).toBe(FINAL)
  })

  it('asks before replacing a non-empty draft and writes only after confirmation', async () => {
    const task = await settledTask()
    const store = storeDouble({ message: DRAFT, record: task.record })
    await render(task.results, store.store)
    await act(async () => { button(en['agent.result.useMessage'])!.click() })

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.getAttribute('aria-label')).toBe(en['agent.result.replaceTitle'])
    expect(dialog.textContent).toContain(en['agent.result.replaceBody'])
    // The draft is untouched until the explicit confirmation.
    expect(store.prepareAgentAction).not.toHaveBeenCalled()
    expect(store.setMessage).not.toHaveBeenCalled()
    expect(store.message()).toBe(DRAFT)

    await act(async () => { button(en['agent.result.useMessage'], dialog)!.click() })
    expect(store.prepareAgentAction).toHaveBeenCalledExactlyOnceWith('draft', { side: 'staged' })
    expect(store.setMessage).toHaveBeenCalledExactlyOnceWith(FINAL)
    expect(store.message()).toBe(FINAL)
  })

  it('leaves the draft untouched when the replacement is cancelled', async () => {
    const task = await settledTask()
    const store = storeDouble({ message: DRAFT, record: task.record })
    await render(task.results, store.store)
    await act(async () => { button(en['agent.result.useMessage'])!.click() })

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    await act(async () => { button(en['confirm.cancel'], dialog)!.click() })

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(store.prepareAgentAction).not.toHaveBeenCalled()
    expect(store.setMessage).not.toHaveBeenCalled()
    expect(store.message()).toBe(DRAFT)
  })

  const refusalCases: { label: string; options: { repositoryVersion?: string; root?: string } }[] = [
    { label: 'repository version', options: { repositoryVersion: 'stale-version' } },
    { label: 'checkout root', options: { root: '/elsewhere' } },
  ]
  it.each(refusalCases)('refuses a result whose $label no longer matches', async ({ options }) => {
    const task = await settledTask()
    const store = storeDouble({ record: task.record, ...options })
    await render(task.results, store.store)

    await act(async () => { button(en['agent.result.useMessage'])!.click() })

    expect(store.prepareAgentAction).toHaveBeenCalledExactlyOnceWith('draft', { side: 'staged' })
    expect(store.setMessage).not.toHaveBeenCalled()
    expect(store.message()).toBe('')
    expect(alertText()).toBe(en['agent.result.useFailed'])
  })

  it.each(['review', 'explain', 'resolve', 'unknown-draft'])('does not offer a %s result as the commit message', async (verb) => {
    const task = await settledTask(verb)
    const store = storeDouble({ record: task.record })
    await render(task.results, store.store)

    expect(preview()).toBe(FINAL)
    expect(document.body.textContent).toContain(en['agent.result.phase.needs-review'])
    expect(button(en['agent.result.useMessage'])).toBeUndefined()
    expect(document.body.textContent).toContain(verb === 'unknown-draft' ? en['agent.title'] : en[('agent.' + verb) as keyof typeof en])
    // Without the affordance nothing reaches the store.
    expect(store.prepareAgentAction).not.toHaveBeenCalled()
    expect(store.setMessage).not.toHaveBeenCalled()
  })

  it('disposes the store subscription on unmount and performs no further renders', async () => {
    const f = taskFixture()
    f.results.admit(admission())
    await tick()
    const getSnapshot = vi.spyOn(f.results, 'getSnapshot')
    const subscribeThrough = f.results.subscribe.bind(f.results)
    const unsubscribe = vi.fn()
    vi.spyOn(f.results, 'subscribe').mockImplementation((listener) => {
      const off = subscribeThrough(listener)
      return () => { unsubscribe(); off() }
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = storeDouble({ record: f.results.getSnapshot().records[0] })
    await render(f.results, store.store)
    await act(async () => { await f.emit(settled()) })
    expect(preview()).toBe(FINAL)

    act(() => { root!.unmount(); root = undefined })
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    const snapshotCalls = getSnapshot.mock.calls.length
    errors.mockClear()
    await act(async () => { await f.emit(settled('request', 'feat: late rewrite')) })

    // A disposed subscription never wakes React again, so no re-render runs.
    expect(getSnapshot.mock.calls.length).toBe(snapshotCalls)
    expect(document.querySelector('pre')).toBeNull()
    expect(errors).not.toHaveBeenCalled()
  })
})
