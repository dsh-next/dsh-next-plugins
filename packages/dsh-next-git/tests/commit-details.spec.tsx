import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { CommitDetailsModal, type CommitDetailsModalProps } from '../src/client/history/CommitDetailsModal.tsx'
import { englishTranslate as t, interpolate, zh } from '../src/client/dictionaries.ts'
import type { GitApi } from '../src/client/api.ts'
import type { CommitSummary, DiffFile } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const oid = (n: number): string => n.toString(16).padStart(40, '0')
const commit: CommitSummary = { hash: oid(3), short: 'c3', parents: [oid(2)], author: 'Author', timestamp: 3, subject: 'feat: do a thing', refs: [] }
const file = (path: string, overrides: Partial<DiffFile> = {}): DiffFile =>
  ({ path, displayPath: path, hunks: [], added: 1, removed: 1, binary: false, tooLarge: false, patch: 'patch ' + path, ...overrides })
const details = (files = [{ path: 'src/app.ts', status: 'M' }, { path: 'docs/readme.md', status: 'A' }, { path: 'old/name.ts', oldPath: 'older/name.ts', status: 'R' }]) =>
  ({ commit, parent: oid(2), message: 'Subject\n\nBody paragraph', files })
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let root: Root
let container: HTMLDivElement
let props: CommitDetailsModalProps
let call: Mock<(method: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>
function rows(): HTMLButtonElement[] { return [...document.querySelectorAll<HTMLButtonElement>('[data-dsh-git="commit-file"]')] }
function button(label: string): HTMLButtonElement { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent) === label)! }
async function render(overrides: Partial<CommitDetailsModalProps> = {}): Promise<void> { props = { ...props, ...overrides }; await act(async () => root.render(<CommitDetailsModal {...props} />)); await act(async () => { await Promise.resolve() }) }
async function flush(): Promise<void> { await act(async () => { await Promise.resolve() }) }
async function click(node: HTMLElement): Promise<void> { await act(async () => { node.click() }); await flush() }
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  call = vi.fn(async (method: string, args: Record<string, unknown>) => {
    if (method === 'getCommitDetails') return details()
    if (method === 'getCommitDiff') return { path: args.path, side: 'unstaged', empty: false, file: file(args.path as string, { patch: 'patch ' + args.path }) }
    throw new Error(method)
  })
  props = { sessionId: 'session-1', commits: [commit], t, api: { call } as GitApi, onClose: vi.fn() }
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })

describe('commit details modal', () => {
  it('reads the commit once and opens its first changed file by default', async () => {
    await render()
    expect(call).toHaveBeenCalledWith('getCommitDetails', { sessionId: 'session-1', hash: commit.hash }, expect.any(AbortSignal))
    expect(document.body.textContent).toContain('feat: do a thing')
    expect(document.body.textContent).toContain('c3')
    expect(rows()).toHaveLength(3)
    expect(rows()[0]!.getAttribute('aria-current')).toBe('true')
    expect(call).toHaveBeenLastCalledWith('getCommitDiff', { sessionId: 'session-1', hash: commit.hash, path: 'src/app.ts' }, expect.any(AbortSignal))
    expect(document.body.textContent).toContain('patch src/app.ts')
  })
  it('lists files with name, directory, rename origin and status, and switches the diff', async () => {
    await render()
    const labels = rows().map(row => row.textContent)
    expect(labels[0]).toBe('app.ts' + 'src' + 'M')
    expect(labels[1]).toBe('readme.md' + 'docs' + 'A')
    expect(labels[2]).toBe('name.ts' + 'old' + 'R')
    expect(rows()[2]!.title).toBe('older/name.ts → old/name.ts')
    await click(rows()[1]!)
    expect(rows()[1]!.getAttribute('aria-current')).toBe('true')
    expect(rows()[0]!.getAttribute('aria-current')).toBeNull()
    expect(call).toHaveBeenLastCalledWith('getCommitDiff', { sessionId: 'session-1', hash: commit.hash, path: 'docs/readme.md' }, expect.any(AbortSignal))
    expect(document.body.textContent).toContain('patch docs/readme.md')
    await click(rows()[2]!)
    expect(call).toHaveBeenLastCalledWith('getCommitDiff', { sessionId: 'session-1', hash: commit.hash, path: 'old/name.ts', oldPath: 'older/name.ts' }, expect.any(AbortSignal))
    expect(call.mock.calls.filter(([method]) => method === 'getCommitDetails')).toHaveLength(1)
  })
  it('surfaces a failed read with a retry that refetches', async () => {
    let fail = true
    call = vi.fn(async (method: string) => {
      if (method === 'getCommitDetails') { if (fail) throw new Error('boom'); return details() }
      throw new Error(method)
    })
    await render({ api: { call } as GitApi })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(t('historyDetails.readFailed'))
    fail = false
    await click(button(t('historyDetails.retry')))
    expect(call.mock.calls.filter(([method]) => method === 'getCommitDetails')).toHaveLength(2)
    expect(rows()).toHaveLength(3)
  })
  it('retries one file diff without re-reading the commit', async () => {
    let fail = true
    call = vi.fn(async (method: string, args: Record<string, unknown>) => {
      if (method === 'getCommitDetails') return details()
      if (fail) throw new Error('boom')
      return { path: args.path, side: 'unstaged', empty: false, file: file(args.path as string) }
    })
    await render({ api: { call } as GitApi })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(t('historyDetails.diffFailed'))
    fail = false
    await click(button(t('historyDetails.retry')))
    expect(call.mock.calls.filter(([method]) => method === 'getCommitDiff')).toHaveLength(2)
    expect(call.mock.calls.filter(([method]) => method === 'getCommitDetails')).toHaveLength(1)
    expect(document.body.textContent).toContain('patch src/app.ts')
  })
  it('names an empty commit and its close control', async () => {
    call = vi.fn(async () => details([]))
    await render({ api: { call } as GitApi })
    expect(document.body.textContent).toContain(t('historyDetails.empty'))
    await click(button(t('historyDetails.close')))
    expect(props.onClose).toHaveBeenCalledOnce()
  })
  it('shows the loading state until the commit read settles', async () => {
    const pending = deferred<unknown>()
    call = vi.fn(async (method: string, args: Record<string, unknown>) =>
      method === 'getCommitDetails'
        ? pending.promise
        : { path: args.path, side: 'unstaged', empty: false, file: file(args.path as string) })
    await act(async () => { root.render(<CommitDetailsModal {...props} api={{ call } as GitApi} />) })
    expect(document.body.textContent).toContain(t('diff.loading'))
    await act(async () => { pending.resolve(details()); await Promise.resolve() })
    expect(rows()).toHaveLength(3)
  })
  it('ignores a reply that arrives after unmount', async () => {
    const pending = deferred<unknown>()
    call = vi.fn(async () => pending.promise)
    await act(async () => { root.render(<CommitDetailsModal {...props} api={{ call } as GitApi} />) })
    await act(async () => { root.unmount() })
    await act(async () => { pending.resolve(details()); await Promise.resolve() })
    expect(document.body.textContent).toBe('')
    root = createRoot(container)
  })
  it('localizes the workspace chrome', async () => {
    await render({ t: (key, params) => interpolate(zh[key], params) })
    expect(document.body.textContent).toContain(zh['historyDetails.files'])
    expect(button(zh['historyDetails.close'])).toBeDefined()
  })
})
