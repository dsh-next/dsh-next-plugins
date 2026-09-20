import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictWorkspaceView, type ConflictWorkspaceViewProps } from '../src/client/conflicts/ConflictWorkspace.tsx'
import { GitApiError, type GitApi } from '../src/client/api.ts'
import { englishTranslate as t, interpolate, zh } from '../src/client/dictionaries.ts'
import type { ConflictFile, ConflictWorkspace } from '../src/core/conflict-types.ts'
import { parseConflictText, validateConflictResult } from '../src/core/conflicts.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const markers = 'before\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\nafter\n'
function text(content: string): ConflictFile { return { kind: 'text', content, mode: '100644', oid: 'blob', size: content.length } }
function workspace(path = 'a.txt', content = markers, version = 'v1'): ConflictWorkspace {
  return { path, version, markerSize: 7, stages: { base: text('base\n'), current: text('ours\n'), incoming: text('theirs\n') },
    worktree: text(content), labels: { operation: 'merge', base: 'host base', current: 'host current', incoming: 'host incoming', currentRef: 'main', incomingRef: 'topic' },
    model: parseConflictText(content), canSave: true, canMarkResolved: validateConflictResult(content).valid,
    choices: ['current', 'incoming', 'base', 'delete'], unsupportedReason: null }
}
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let root: Root
let container: HTMLDivElement
let props: ConflictWorkspaceViewProps
let call: ReturnType<typeof vi.fn>
let host: Record<string, ConflictWorkspace>
let mounted: boolean
async function render(overrides: Partial<ConflictWorkspaceViewProps> = {}): Promise<void> {
  props = { ...props, ...overrides }
  await act(async () => { root.render(<ConflictWorkspaceView {...props} />) })
}
function button(key: Parameters<typeof t>[0]): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => (item.getAttribute('aria-label') ?? item.textContent) === props.t(key))
  expect(found, key).toBeDefined()
  return found!
}
async function click(key: Parameters<typeof t>[0]): Promise<void> { await act(async () => { button(key).click() }) }
function result(): HTMLTextAreaElement { return document.querySelector<HTMLTextAreaElement>('textarea')! }
async function edit(value: string): Promise<void> {
  await act(async () => {
    const node = result()
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function file(path: string): Promise<void> {
  const node = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find((item) => item.querySelector('span')?.textContent === path)!
  await act(async () => { node.click() })
}

beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); mounted = true
  host = { 'a.txt': workspace(), 'b.txt': workspace('b.txt', markers.replace('ours', 'second')) }
  call = vi.fn(async (method: string, args: Record<string, unknown>) => {
    const path = args.path as string
    if (method === 'getConflict') return host[path]
    if (method === 'saveConflict') {
      host[path] = workspace(path, args.content as string, 'v2')
      return { workspace: host[path], backupId: 'backup-save' }
    }
    if (method === 'chooseConflict') {
      const old = host[path]!
      const chosen = args.side === 'delete' ? { kind: 'absent', content: null, oid: null, mode: null, size: 0 } as const : old.stages[args.side as 'current' | 'incoming' | 'base']
      host[path] = { ...old, version: 'v2', worktree: chosen, model: chosen.content === null ? null : parseConflictText(chosen.content), canMarkResolved: true }
      return { workspace: host[path], backupId: 'backup-choice' }
    }
    if (method === 'markConflictResolved') return { path, resolved: true, backupId: 'backup-resolved' }
    throw new Error(method)
  })
  props = { sessionId: 'source', initialPath: 'a.txt', paths: ['a.txt', 'b.txt'], api: { call } as GitApi,
    t, onClose: vi.fn(), onChanged: vi.fn(), onAskAgent: vi.fn() }
})
afterEach(async () => { if (mounted) await act(async () => root.unmount()); document.body.replaceChildren() })

describe('conflict workspace', () => {
  it.each([
    ['conflict.acceptCurrent', 'before\nours\nafter\n'],
    ['conflict.acceptIncoming', 'before\ntheirs\nafter\n'],
    ['conflict.bothCurrentFirst', 'before\nours\ntheirs\nafter\n'],
    ['conflict.bothIncomingFirst', 'before\ntheirs\nours\nafter\n'],
  ] as const)('applies %s losslessly, saves new version/model, and marks separately', async (choice, content) => {
    await render()
    expect(button('conflict.mark').disabled).toBe(true)
    expect(document.querySelectorAll('pre[aria-label]').length).toBe(3)
    await click(choice)
    expect(result().value).toBe(content)
    expect(button('conflict.mark').disabled).toBe(true)
    expect(call.mock.calls.filter(([method]) => method !== 'getConflict')).toHaveLength(0)
    await click('conflict.save')
    expect(call).toHaveBeenCalledWith('saveConflict', { sessionId: 'source', path: 'a.txt', expectedVersion: 'v1', content }, expect.any(AbortSignal))
    expect(button('conflict.mark').disabled).toBe(false)
    expect(document.querySelector('fieldset')).toBeNull()
    expect(document.body.textContent).toContain('backup-save')
    await click('conflict.mark')
    expect(call).toHaveBeenCalledWith('markConflictResolved', { sessionId: 'source', path: 'a.txt', expectedVersion: 'v2' }, expect.any(AbortSignal))
    expect(document.body.textContent).toContain('backup-resolved')
    expect(props.onChanged).toHaveBeenCalledTimes(2)
    await click('conflict.next')
    expect(result().value).toContain('second')
    expect(document.querySelector('nav')?.textContent).toContain(t('conflict.resolved'))
  })

  it('reparses direct edits and preserves surrounding edits during later hunk choices', async () => {
    await render(); await edit(markers.replace('before', 'manual prefix'))
    await click('conflict.acceptIncoming')
    expect(result().value).toBe('manual prefix\ntheirs\nafter\n')
    await edit('<<<<<<< malformed\n')
    expect(document.body.textContent).toContain(t('conflict.malformed'))
    await click('conflict.save')
    expect(button('conflict.mark').disabled).toBe(true)
  })

  it.each(['binary', 'symlink'] as const)('confirms %s file choices; saves receipt before mark', async (kind) => {
    const opaque = { kind, content: null, mode: kind === 'symlink' ? '120000' : '100644', oid: 'opaque', size: 2 }
    host['a.txt'] = { ...workspace(), stages: { base: opaque, current: opaque, incoming: opaque }, worktree: opaque, canSave: false, model: null }
    await render()
    expect(result()).toBeNull()
    expect(button('conflict.mark').disabled).toBe(true)
    await click('conflict.chooseIncoming')
    expect(call).not.toHaveBeenCalledWith('chooseConflict', expect.anything(), expect.anything())
    await click('conflict.cancelChoice')
    await click('conflict.chooseIncoming'); await click('conflict.confirm')
    expect(call).toHaveBeenCalledWith('chooseConflict', { sessionId: 'source', path: 'a.txt', expectedVersion: 'v1', side: 'incoming' }, expect.any(AbortSignal))
    expect(document.body.textContent).toContain('backup-choice')
    await click('conflict.mark')
    expect(call).toHaveBeenCalledWith('markConflictResolved', expect.objectContaining({ expectedVersion: 'v2' }), expect.any(AbortSignal))
  })

  it('requires explicit deletion and includes an unsaved warning for whole-file replacements', async () => {
    await render(); await edit('local draft')
    await click('conflict.chooseDelete')
    expect(document.body.textContent).toContain(t('conflict.confirmDelete'))
    expect(document.body.textContent).toContain(t('conflict.discardBody'))
    await click('conflict.cancelChoice')
    expect(result().value).toBe('local draft')
    await click('conflict.chooseDelete'); await click('conflict.chooseDelete')
    expect(call).toHaveBeenCalledWith('chooseConflict', expect.objectContaining({ side: 'delete', expectedVersion: 'v1' }), expect.any(AbortSignal))
    expect(button('conflict.mark').disabled).toBe(false)
  })

  it('retains a stale draft/version, compares without overwrite, and guards explicit reload', async () => {
    await render(); await edit('local draft')
    call.mockImplementationOnce(async () => { throw new GitApiError({ code: 'dirty-tree', detail: 'changed externally' }, null) })
    await click('conflict.save')
    expect(result().value).toBe('local draft')
    expect(document.body.textContent).toContain(t('conflict.stale'))
    expect(button('conflict.save').disabled).toBe(true)
    host['a.txt'] = workspace('a.txt', 'remote result', 'v3')
    await click('conflict.compare')
    expect(result().value).toBe('local draft')
    expect(document.querySelector('pre[aria-label="' + t('conflict.latest') + '"]')?.textContent).toBe('remote result')
    await click('conflict.reload'); await click('conflict.cancel')
    expect(result().value).toBe('local draft')
    await click('conflict.reload'); await click('conflict.discard')
    expect(result().value).toBe('remote result')
    await edit('reviewed result'); await click('conflict.save')
    expect(call).toHaveBeenLastCalledWith('saveConflict', expect.objectContaining({ expectedVersion: 'v3', content: 'reviewed result' }), expect.any(AbortSignal))
  })

  it('localizes ordinary RPC failures and retains the original version for retry', async () => {
    await render({ t: (key, params) => interpolate(zh[key], params) }); await edit('draft')
    call.mockImplementationOnce(async () => { throw new Error('permission detail') })
    await click('conflict.save')
    expect(document.body.textContent).toContain(zh['conflict.failure'])
    expect(result().value).toBe('draft')
    await click('conflict.save')
    expect(call).toHaveBeenLastCalledWith('saveConflict', expect.objectContaining({ expectedVersion: 'v1' }), expect.any(AbortSignal))
  })

  it('guards unsaved file navigation, close and AI handoff', async () => {
    await render(); await edit('draft')
    await file('b.txt'); await click('conflict.cancel')
    expect(result().value).toBe('draft')
    await click('conflict.close'); await click('conflict.cancel')
    expect(props.onClose).not.toHaveBeenCalled()
    await click('conflict.resolve'); await click('conflict.cancel')
    expect(props.onAskAgent).not.toHaveBeenCalled()
    await file('b.txt'); await click('conflict.discard')
    expect(result().value).toContain('second')
    await click('conflict.close')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('only calls the agent chooser with explicit file or unresolved scopes', async () => {
    await render(); await click('conflict.explain'); await click('conflict.resolve'); await click('conflict.resolveAll')
    expect(props.onAskAgent).toHaveBeenNthCalledWith(1, { verb: 'explain', scope: { paths: ['a.txt'] } })
    expect(props.onAskAgent).toHaveBeenNthCalledWith(2, { verb: 'resolve', scope: { paths: ['a.txt'] } })
    expect(props.onAskAgent).toHaveBeenNthCalledWith(3, { verb: 'resolve', scope: { paths: ['a.txt', 'b.txt'] } })
    expect(call.mock.calls.every(([method]) => method === 'getConflict')).toBe(true)
    await edit('resolved'); await click('conflict.save'); await click('conflict.mark'); await click('conflict.resolveAll')
    expect(props.onAskAgent).toHaveBeenLastCalledWith({ verb: 'resolve', scope: { paths: ['b.txt'] } })
  })

  it('does not overwrite local edits when parent refreshes after an agent turn', async () => {
    await render(); await edit('local draft')
    host['a.txt'] = workspace('a.txt', 'agent proposal', 'agent-v2')
    await render({ paths: [...props.paths] })
    expect(result().value).toBe('local draft')
    expect(document.body.textContent).toContain('agent proposal')
    expect(button('conflict.save').disabled).toBe(true)
  })

  it('ignores late path loads and aborts requests on unmount', async () => {
    const old = deferred<ConflictWorkspace>()
    call.mockImplementationOnce(() => old.promise)
    await render()
    const signal = call.mock.calls[0]![2] as AbortSignal
    await file('b.txt')
    expect(signal.aborted).toBe(true)
    expect(result().value).toContain('second')
    await act(async () => old.resolve(workspace('a.txt', 'late old result')))
    expect(result().value).toContain('second')
    const pending = deferred<ConflictWorkspace>()
    call.mockImplementationOnce(() => pending.promise)
    await click('conflict.refresh')
    const lastSignal = call.mock.calls.at(-1)![2] as AbortSignal
    await act(async () => root.unmount()); mounted = false
    expect(lastSignal.aborted).toBe(true)
    await act(async () => pending.resolve(workspace()))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('ignores a late write after unmount without firing refresh callbacks', async () => {
    await render(); await edit('draft')
    const pending = deferred<unknown>()
    call.mockImplementationOnce(() => pending.promise)
    await click('conflict.save')
    const signal = call.mock.calls.at(-1)![2] as AbortSignal
    await act(async () => root.unmount()); mounted = false
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve({ workspace: workspace('a.txt', 'late write', 'v2'), backupId: 'late' }))
    expect(props.onChanged).not.toHaveBeenCalled()
  })

  it('renders an empty list without fetching an invented path', async () => {
    await render({ paths: [], initialPath: '' })
    expect(document.body.textContent).toContain(t('conflict.empty'))
    expect(call).not.toHaveBeenCalled()
    expect(button('conflict.resolveAll').disabled).toBe(true)
  })

  it('shows unsupported host detail without inventing text or editable content', async () => {
    const opaque = { kind: 'submodule', content: null, mode: '160000', oid: 'module', size: 0 } as const
    host['a.txt'] = { ...workspace(), stages: { base: opaque, current: opaque, incoming: opaque }, worktree: opaque,
      model: null, canSave: false, canMarkResolved: false, choices: [], unsupportedReason: 'Resolve the gitlink externally' }
    await render()
    expect(document.body.textContent).toContain(t('conflict.unsupported'))
    expect(document.body.textContent).toContain('Resolve the gitlink externally')
    expect(result()).toBeNull()
    expect(button('conflict.save').disabled).toBe(true)
    expect(button('conflict.mark').disabled).toBe(true)
  })

  it.each(['rebase', 'cherry-pick', 'revert', 'unknown'] as const)('uses localized operation-aware %s labels and refs', async (operation) => {
    host['a.txt'] = { ...workspace(), labels: { ...workspace().labels, operation } }
    await render()
    expect(document.body.textContent).toContain(t(('conflict.operation.' + operation) as Parameters<typeof t>[0]))
    expect(document.body.textContent).not.toContain('host current')
    expect(document.body.textContent).toContain('main')
    expect(document.body.textContent).toContain('topic')
  })

  it('traps keyboard focus, keeps hunk buttons accessible, cancels confirmation with Escape and restores opener', async () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus()
    await render()
    const close = button('conflict.close')
    expect(document.activeElement).toBe(close)
    await act(async () => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(button('conflict.resolve'))
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(close)
    button('conflict.acceptCurrent').focus()
    expect(document.activeElement).toBe(button('conflict.acceptCurrent'))
    await click('conflict.acceptCurrent'); await click('conflict.close')
    expect(document.querySelector('[data-dsh-git="conflict-confirmation"]')).not.toBeNull()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[data-dsh-git="conflict-confirmation"]')).toBeNull()
    expect(result().value).toContain('ours')
    expect(props.onClose).not.toHaveBeenCalled()
    await act(async () => root.unmount()); mounted = false
    expect(document.activeElement).toBe(opener)
  })
})
