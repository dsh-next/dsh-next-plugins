import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitCommandDialog, type CommitCommandDialogProps } from '../src/client/repository/CommitCommandDialog.tsx'
import { GitApiError, type GitApi } from '../src/client/api.ts'
import { en } from '../src/client/dictionaries/en.ts'
import type { PanelState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement, props: CommitCommandDialogProps
const entry: PanelState['changes']['staged'][number] = { path: 'a.txt', xy: 'M.', index: 'modified', untracked: false, ignored: false }
function state(): PanelState {
  return { root: '/repo', cwd: '/repo', gitDir: '/repo/.git', bare: false,
    head: { oid: 'a'.repeat(40), branch: 'main', unborn: false, detached: false, upstream: null, ahead: 0, behind: 0 },
    operation: { kind: null, message: null, conflicts: [], step: null },
    changes: { staged: [entry], unstaged: [], untracked: [], ignored: [], conflicts: [], ignoredCount: 0, ignoredTruncated: false },
    worktrees: [], branches: [], tags: [], identity: { name: 'A', email: 'a@b' }, worktreeBase: { name: 'main', source: 'default-branch', candidates: ['main'] } }
}
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function render(overrides: Partial<CommitCommandDialogProps> = {}): Promise<void> {
  props = { sessionId: 's', state: state(), api: { call: vi.fn().mockResolvedValue({}) } as GitApi, t: key => en[key], mode: 'staged', amend: false, signoff: false, onClose: vi.fn(), onChanged: vi.fn(), ...overrides }
  await act(async () => root.render(<CommitCommandDialog {...props} />))
}
const summary = (): HTMLInputElement => document.querySelector('input:not([type="checkbox"])')!
const button = (): HTMLButtonElement => document.querySelector('button[type="submit"]')!
async function value(node: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, text)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const click = async (node: HTMLElement): Promise<void> => { await act(async () => node.click()) }

describe('menu commit dialog', () => {
  it.each(['staged', 'all'] as const)('submits %s with full message and sign-off and minimal controls', async mode => {
    await render({ mode, signoff: true })
    expect(button().disabled).toBe(true)
    await value(summary(), 'Subject'); await value(document.querySelector('textarea')!, 'Body\nSecond line')
    expect(document.querySelectorAll('button')).toHaveLength(2)
    await click(button())
    expect(props.api.call).toHaveBeenCalledWith(mode === 'all' ? 'commitAll' : 'commit', expect.objectContaining({ sessionId: 's', message: 'Subject\n\nBody\nSecond line', amend: false, signoff: true, requestId: expect.any(String) }))
    expect(props.onChanged).toHaveBeenCalledOnce(); expect(props.onClose).toHaveBeenCalledOnce()
  })
  it('prefills the full previous message and requires amend acknowledgement even with an empty index', async () => {
    const current = { ...state(), changes: { ...state().changes, staged: [] } }
    const call = vi.fn().mockResolvedValue({ message: 'Previous\n\nParagraph one\n\nParagraph two\n' })
    await render({ state: current, amend: true, api: { call } })
    expect(call).toHaveBeenCalledWith('getCommitDetails', { sessionId: 's', hash: current.head.oid }, expect.any(AbortSignal))
    expect(summary().value).toBe('Previous'); expect(document.querySelector('textarea')!.value).toBe('Paragraph one\n\nParagraph two')
    expect(button().disabled).toBe(true)
    await click(document.querySelector('input[type="checkbox"]')!)
    expect(button().disabled).toBe(false)
    await click(button())
    expect(call).toHaveBeenLastCalledWith('commit', expect.objectContaining({ amend: true, expectedHead: current.head.oid, message: 'Previous\n\nParagraph one\n\nParagraph two' }))
  })
  it('keeps an amend draft and refuses submission when HEAD changes', async () => {
    const call = vi.fn().mockResolvedValue({ message: 'Previous' })
    await render({ amend: true, api: { call } })
    await value(summary(), 'My edited message')
    await click(document.querySelector('input[type="checkbox"]')!)
    props = { ...props, state: { ...props.state, head: { ...props.state.head, oid: 'b'.repeat(40) } } }
    await act(async () => root.render(<CommitCommandDialog {...props} />))
    expect(summary().value).toBe('My edited message')
    expect(button().disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['commands.amendStale'])
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('blocks conflicts, operations and empty staged mode but allows all-mode untracked files', async () => {
    const current = { ...state(), changes: { ...state().changes, staged: [], untracked: [entry] } }
    await render({ state: current }); await value(summary(), 'Subject'); expect(button().disabled).toBe(true)
    await render({ state: current, mode: 'all' }); await value(summary(), 'Subject'); expect(button().disabled).toBe(false)
    current.operation = { ...current.operation, kind: 'merge' }
    await render({ state: current }); await value(summary(), 'Subject'); expect(button().disabled).toBe(true)
  })
  it('renders localized hook errors with escaped host output and allows retry', async () => {
    const call = vi.fn().mockRejectedValue(new GitApiError({ code: 'hook-failed', detail: '<img src=x onerror=alert(1)> hook output' }, null))
    await render({ api: { call } }); await value(summary(), 'Subject'); await click(button())
    expect(document.querySelector('[role="alert"]')!.textContent).toContain(en['failure.hookFailed'])
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('<img src=x')
    expect(document.querySelector('img')).toBeNull(); expect(button().disabled).toBe(false)
    await click(button()); expect(call).toHaveBeenCalledTimes(2)
  })
  it('guards duplicate form submits and cancels through X while a hook is pending', async () => {
    let resolve!: (value: unknown) => void
    const pending = new Promise(done => { resolve = done })
    const call = vi.fn((method: string) => method === 'cancelCommit' ? Promise.resolve(true) : pending) as GitApi['call']
    await render({ api: { call } }); await value(summary(), 'Subject')
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(call).toHaveBeenCalledTimes(1)
    await click(document.querySelector('button[aria-label="' + en['repository.close'] + '"]')!)
    expect(call).toHaveBeenLastCalledWith('cancelCommit', expect.objectContaining({ sessionId: 's', requestId: expect.any(String) }))
    expect(props.onClose).toHaveBeenCalledOnce()
    await act(async () => resolve({}))
  })
  it('does not repeat a successful commit when the refresh fails', async () => {
    await render({ onChanged: vi.fn().mockRejectedValue(new Error('refresh failed')) })
    await value(summary(), 'Subject'); await click(button())
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('refresh failed')
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(props.api.call).toHaveBeenCalledOnce()
  })
  it('shows amend prefill failure and closes through Escape', async () => {
    await render({ amend: true, api: { call: vi.fn().mockRejectedValue(new Error('read failed')) } })
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('read failed')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})
