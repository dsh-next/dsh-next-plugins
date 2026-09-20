import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { HistoryWorkspaceView, type HistoryWorkspaceViewProps } from '../src/client/history/HistoryWorkspace.tsx'
import { englishTranslate as t, interpolate, zh } from '../src/client/dictionaries.ts'
import { GitApiError, type GitApi } from '../src/client/api.ts'
import type { CommitSummary } from '../src/core/types.ts'
import type { HistoryAction, HistoryPreview, HistoryStatus } from '../src/core/history-plan.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const oid = (n: number): string => n.toString(16).padStart(40, '0')
const commit = (n: number): CommitSummary => ({ hash: oid(n), short: 'c' + n, parents: [oid(n - 1)], author: 'Author', timestamp: n, subject: 'Commit ' + n, refs: [] })
function preview(action: HistoryAction = 'squash', acknowledge = true): HistoryPreview {
  return { operationId: 'operation-1', createdAt: 'now', binding: { source: { sessionId: props.sessionId }, checkout: '/repo', gitDir: '/repo/.git', commonDir: '/repo/.git', head: oid(3), headRef: 'refs/heads/main', tree: oid(4) },
    plan: { eligible: true, action, selected: [oid(1), oid(2)], ordered: [oid(1), oid(2)], affected: [oid(1), oid(2), oid(3)], descendants: [oid(3)], base: oid(0), steps: [], message: 'Combined', rewrites: true },
    publication: { state: 'unknown', refs: [], warning: 'Host publication warning' }, requiresPublishedAcknowledgment: acknowledge, backupRef: 'refs/dsh/backup/operation-1',
    otherCheckouts: [{ checkout: '/other', headRef: 'refs/heads/main' }], diffSummary: '2 files changed', diffMeaning: 'Host diff meaning', warnings: ['Host warning'], permission: { source: { sessionId: props.sessionId }, checkout: '/repo', authority: 'apply-approved-history-plan' } }
}
function status(phase: HistoryStatus['phase'] = 'completed', value = preview()): HistoryStatus { return { preview: value, phase, native: { kind: null, remaining: [], conflicts: [], owned: false }, currentHead: oid(5), currentRef: 'refs/heads/main', clean: true, completedHead: oid(5), error: null, nextStep: 'Host next step', canRestore: phase === 'completed' } }
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let root: Root
let container: HTMLDivElement
let props: HistoryWorkspaceViewProps
let call: Mock<(method: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>
let latest: HistoryPreview
let hostStatus: HistoryStatus
let sequence = 0
let mounted: boolean
const key = (): string => 'dsh-next-git:history:' + JSON.stringify([props.sessionId, '/repo'])
function buttons(): HTMLButtonElement[] { return [...document.querySelectorAll<HTMLButtonElement>('button')] }
function button(key: Parameters<typeof t>[0]): HTMLButtonElement { const found = buttons().find(node => (node.getAttribute('aria-label') ?? node.textContent) === props.t(key)); expect(found, key).toBeDefined(); return found! }
async function click(key: Parameters<typeof t>[0]): Promise<void> { await act(async () => button(key).click()) }
async function render(overrides: Partial<HistoryWorkspaceViewProps> = {}): Promise<void> { props = { ...props, ...overrides }; await act(async () => root.render(<HistoryWorkspaceView {...props} />)) }
async function input(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): Promise<void> { await act(async () => { const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
async function acknowledge(): Promise<void> { await act(async () => { document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() }) }
async function remount(): Promise<void> { await act(async () => root.unmount()); root = createRoot(container); await render() }
const writes = (): unknown[][] => call.mock.calls.filter(([method]) => method === 'executeHistory' || method === 'recoverHistory')
beforeEach(() => {
  sessionStorage.clear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); mounted = true
  call = vi.fn(async (method: string, args: Record<string, unknown>) => {
    if (method === 'getState') return { state: { root: '/repo' } }
    if (method === 'getCommitDetails') return { commit: commit(Number.parseInt(args.hash as string, 16)), message: 'Full commit message', parent: oid(0), files: [{ path: 'new.txt', oldPath: 'old.txt', status: 'R' }, { path: 'second.txt', status: 'M' }] }
    if (method === 'getCommitDiff') return { path: args.path, side: 'unstaged', empty: false, file: { path: args.path, displayPath: args.path, hunks: [], added: 1, removed: 1, binary: false, tooLarge: false, patch: 'patch for ' + args.path } }
    if (method === 'compareCommits') return { from: args.from, to: args.to, summary: 'comparison summary', patch: 'comparison patch', truncated: false }
    if (method === 'previewHistory') { latest = { ...preview(args.action as HistoryAction), plan: { ...preview(args.action as HistoryAction).plan, selected: args.commits as string[], ordered: (args.order ?? args.commits) as string[] } }; hostStatus = status('preview', latest); return latest }
    if (method === 'executeHistory') { hostStatus = status('completed', latest); return hostStatus }
    if (method === 'historyOperationStatus') return hostStatus
    if (method === 'recoverHistory') { hostStatus = status(args.action === 'cancel' ? 'cancelled' : args.action === 'abort' ? 'aborted' : args.action === 'restore' ? 'recovered' : 'completed', latest); return hostStatus }
    throw new Error(method)
  })
  props = { sessionId: 'source-' + ++sequence, selection: [commit(1), commit(2)], initialAction: 'squash', t, api: { call } as GitApi, onClose: vi.fn(), onChanged: vi.fn(), onAskAgent: vi.fn() }
  latest = preview(); hostStatus = status('preview', latest)
})
afterEach(async () => { if (mounted) await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })

describe('history workspace plan safety', () => {
  it.each(['squash', 'fixup', 'reorder', 'reword', 'cherry-pick', 'revert'] as const)('constructs %s request order and requires explicit preview, ack, then apply', async action => {
    const selection = action === 'reword' ? [commit(2)] : [commit(1), commit(2)]
    await render({ initialAction: action, selection })
    expect(writes()).toHaveLength(0); expect(call.mock.calls.some(([method]) => method === 'previewHistory')).toBe(false)
    await click('historyPlan.preview')
    const ids = selection.map(item => item.hash)
    expect(call).toHaveBeenCalledWith('previewHistory', { sessionId: props.sessionId, action, commits: action === 'revert' ? [...ids].reverse() : ids, ...(action === 'reorder' ? { order: ids } : {}), ...(action === 'squash' || action === 'reword' ? { message: selection.map(item => item.subject).join('\n\n') } : {}) })
    expect(button('historyPlan.apply').disabled).toBe(true); expect(writes()).toHaveLength(0)
    expect(document.body.textContent).toContain('/repo'); expect(document.body.textContent).toContain(oid(3)); expect(document.body.textContent).toContain('/other'); expect(document.body.textContent).toContain('refs/dsh/backup/operation-1'); expect(document.body.textContent).toContain(t('historyPlan.noPush'))
    await acknowledge(); expect(button('historyPlan.apply').disabled).toBe(false)
    await click('historyPlan.apply')
    expect(call).toHaveBeenCalledWith('executeHistory', { sessionId: props.sessionId, operationId: 'operation-1', approved: true, acknowledgePublishedHistory: true })
    expect(button('historyPlan.apply').disabled).toBe(true); expect(props.onChanged).toHaveBeenCalledOnce()
  })
  it('edits batch and reorder order explicitly; changing inputs invalidates approval', async () => {
    await render({ initialAction: 'reorder' })
    await act(async () => buttons().find(node => node.getAttribute('aria-label') === t('historyPlan.moveDown', { hash: oid(1).slice(0, 7) }))!.click())
    await click('historyPlan.preview')
    expect(call).toHaveBeenLastCalledWith('previewHistory', { sessionId: props.sessionId, action: 'reorder', commits: [oid(1), oid(2)], order: [oid(2), oid(1)] })
    await acknowledge()
    await input(document.querySelector('select')!, 'revert')
    expect(document.querySelector('input[type="checkbox"]')).toBeNull()
    expect(button('historyPlan.preview').disabled).toBe(false)
    await click('historyPlan.preview'); expect(call).toHaveBeenLastCalledWith('previewHistory', { sessionId: props.sessionId, action: 'revert', commits: [oid(2), oid(1)] })
  })
  it('rejects empty message and invalid counts, and clears a preview after editing message', async () => {
    await render(); await click('historyPlan.preview'); await acknowledge()
    await input(document.querySelector('textarea')!, '')
    expect(document.querySelector('input[type="checkbox"]')).toBeNull(); expect(button('historyPlan.preview').disabled).toBe(true)
    await input(document.querySelector('textarea')!, 'new message'); await click('historyPlan.preview')
    expect(call).toHaveBeenLastCalledWith('previewHistory', { sessionId: props.sessionId, action: 'squash', commits: [oid(1), oid(2)], message: 'new message' })
    await render({ initialAction: 'reword', sessionId: props.sessionId + '-fresh' }); expect(button('historyPlan.preview').disabled).toBe(true)
  })
  it('applies a host preview not requiring acknowledgement only after Apply', async () => {
    await render(); call.mockImplementationOnce(async () => ({ ...preview(), requiresPublishedAcknowledgment: false }))
    await click('historyPlan.preview'); expect(document.querySelector('input[type="checkbox"]')).toBeNull(); expect(writes()).toHaveLength(0)
    await click('historyPlan.apply'); expect(writes()).toHaveLength(1)
    expect(call).toHaveBeenCalledWith('executeHistory', { sessionId: props.sessionId, operationId: 'operation-1', approved: true, acknowledgePublishedHistory: false })
  })
  it('cancels a preview through recover only', async () => {
    await render(); await click('historyPlan.preview'); await click('historyPlan.cancel')
    expect(writes()).toEqual([['recoverHistory', { sessionId: props.sessionId, operationId: 'operation-1', action: 'cancel' }]])
    expect(document.body.textContent).toContain(t('historyPlan.phase.cancelled'))
    await click('historyPlan.newPlan'); expect(document.querySelector('input[type="checkbox"]')).toBeNull()
  })
  it('shows stale preview errors and never silently retries or executes', async () => {
    await render(); call.mockImplementationOnce(async () => { throw new GitApiError({ code: 'dirty-tree', detail: 'host detail' }, null) })
    await click('historyPlan.preview'); expect(document.body.textContent).toContain(t('historyPlan.stale')); expect(writes()).toHaveLength(0)
    expect(button('historyPlan.preview').disabled).toBe(false)
  })
  it('handles lost execute replies by status read, with apply disabled until verified', async () => {
    await render(); await click('historyPlan.preview'); await acknowledge()
    call.mockImplementationOnce(async () => { throw new Error('lost response') })
    await click('historyPlan.apply'); expect(button('historyPlan.apply').disabled).toBe(true); expect(document.body.textContent).toContain(t('historyPlan.uncertain'))
    expect(sessionStorage.getItem(key())).toBe('operation-1'); expect(props.onChanged).toHaveBeenCalled()
    hostStatus = status('completed', latest); await click('historyPlan.refreshStatus')
    expect(writes().filter(([method]) => method === 'executeHistory')).toHaveLength(1)
    expect(document.body.textContent).toContain(t('historyPlan.phase.completed'))
  })
  it('resumes saved preview and stopped status on mount without execute, and requires fresh ack', async () => {
    await render(); await click('historyPlan.preview'); await acknowledge(); await remount()
    expect(call).toHaveBeenCalledWith('historyOperationStatus', { sessionId: props.sessionId, operationId: 'operation-1' }, expect.any(AbortSignal))
    expect(button('historyPlan.apply').disabled).toBe(true); expect(writes()).toHaveLength(0)
    hostStatus = { ...status('stopped', latest), native: { kind: 'rebase', owned: true, conflicts: ['conflict.txt'], remaining: [oid(2)] } }
    await remount(); expect(document.body.textContent).toContain('conflict.txt'); expect(writes()).toHaveLength(0)
    expect(button('historyPlan.continue').disabled).toBe(true)
    await click('historyPlan.openConflicts'); expect(props.onChanged).toHaveBeenCalledOnce(); expect(props.onClose).toHaveBeenCalledOnce()
  })
  it('keeps the recovery view open when conflict handoff cannot refresh the parent', async () => {
    sessionStorage.setItem(key(), 'operation-1'); hostStatus = { ...status('stopped', latest), native: { kind: 'rebase', owned: true, conflicts: ['conflict.txt'], remaining: [oid(2)] } }
    await render({ onChanged: vi.fn(async () => { throw new Error('refresh failed') }) }); await click('historyPlan.openConflicts')
    expect(props.onClose).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(t('historyPlan.refreshFailed'))
  })
  it('does not read a different checkout saved identity', async () => {
    sessionStorage.setItem('dsh-next-git:history:' + JSON.stringify([props.sessionId, '/other']), 'other-operation')
    await render(); expect(call.mock.calls.some(([method]) => method === 'historyOperationStatus')).toBe(false)
    expect(writes()).toHaveLength(0)
  })
  it('blocks mismatched checkout status and preview', async () => {
    sessionStorage.setItem(key(), 'operation-1'); hostStatus = { ...hostStatus, preview: { ...latest, binding: { ...latest.binding, checkout: '/other' } } }
    await render(); expect(document.body.textContent).toContain(t('historyPlan.stale')); expect(button('historyPlan.preview').disabled).toBe(true); expect(writes()).toHaveLength(0)
  })
  it('falls back to in-page recovery when storage reads/writes fail', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    await render(); await click('historyPlan.preview'); expect(document.body.textContent).toContain(t('historyPlan.storageWarning'))
    await remount(); expect(call).toHaveBeenCalledWith('historyOperationStatus', { sessionId: props.sessionId, operationId: 'operation-1' }, expect.any(AbortSignal)); expect(writes()).toHaveLength(0)
  })
  it.each(['skip', 'abort', 'restore'] as const)('confirms destructive %s and uses recover only', async action => {
    sessionStorage.setItem(key(), 'operation-1')
    hostStatus = { ...status(action === 'restore' ? 'completed' : 'stopped', latest), native: { kind: action === 'restore' ? null : 'rebase', owned: true, conflicts: [], remaining: [oid(2)] } }
    await render(); await click(('historyPlan.' + action) as Parameters<typeof t>[0])
    expect(document.body.textContent).toContain(t(('historyPlan.confirm.' + action) as Parameters<typeof t>[0])); expect(writes()).toHaveLength(0)
    await click('historyPlan.keep'); expect(writes()).toHaveLength(0)
    await click(('historyPlan.' + action) as Parameters<typeof t>[0]); await click('historyPlan.confirmRecovery')
    expect(call).toHaveBeenCalledWith('recoverHistory', { sessionId: props.sessionId, operationId: 'operation-1', action, ...(action === 'abort' ? { discardResolutionEdits: true } : action === 'restore' ? { approved: true } : {}) })
    expect(writes()).toHaveLength(1)
  })
  it('continues an owned resolved operation without calling execute', async () => {
    sessionStorage.setItem(key(), 'operation-1'); hostStatus = { ...status('stopped', latest), native: { kind: 'cherry-pick', owned: true, conflicts: [], remaining: [oid(2)] } }
    await render(); await click('historyPlan.continue')
    expect(writes()).toEqual([['recoverHistory', { sessionId: props.sessionId, operationId: 'operation-1', action: 'continue' }]])
  })
  it('reports interrupted unowned native state honestly without unsafe recovery controls', async () => {
    sessionStorage.setItem(key(), 'operation-1'); hostStatus = status('interrupted', latest)
    await render(); expect(document.body.textContent).toContain(t('historyPlan.manualRecovery'))
    expect(buttons().some(node => node.textContent === t('historyPlan.continue'))).toBe(false)
    expect(button('historyPlan.apply').disabled).toBe(true); expect(writes()).toHaveLength(0)
  })
  it('ignores a late preview after cancellation/unmount and prevents double execution', async () => {
    await render(); const pending = deferred<HistoryPreview>(); call.mockImplementationOnce(() => pending.promise)
    await click('historyPlan.preview'); await click('historyPlan.close'); expect(props.onClose).toHaveBeenCalledOnce()
    await act(async () => pending.resolve(preview())); expect(document.querySelector('input[type="checkbox"]')).toBeNull()
    await click('historyPlan.preview'); await acknowledge(); const execute = deferred<HistoryStatus>(); call.mockImplementationOnce(() => execute.promise)
    await act(async () => { button('historyPlan.apply').click(); button('historyPlan.apply').click() })
    expect(writes().filter(([method]) => method === 'executeHistory')).toHaveLength(1)
    await act(async () => root.unmount()); mounted = false
    await act(async () => execute.resolve(status('completed')))
    expect(props.onChanged).toHaveBeenCalledOnce()
  })
  it('displays published warning and requires acknowledgement from the host preview', async () => {
    await render(); call.mockImplementationOnce(async () => ({ ...preview(), publication: { state: 'reachable', refs: ['origin/main'], warning: 'Published host warning' } }))
    await click('historyPlan.preview'); expect(document.body.textContent).toContain(t('historyPlan.published')); expect(document.body.textContent).toContain('origin/main'); expect(button('historyPlan.apply').disabled).toBe(true)
  })
  it('keeps a failed resume locked until an explicit successful status read', async () => {
    sessionStorage.setItem(key(), 'operation-1')
    const implementation = call.getMockImplementation()!
    let fail = true
    call.mockImplementation(async (method: string, args: Record<string, unknown>) => { if (method === 'historyOperationStatus' && fail) { fail = false; throw new Error('status unavailable') }; return implementation(method, args) })
    await render(); expect(button('historyPlan.preview').disabled).toBe(true); expect(document.body.textContent).toContain(t('historyPlan.failed'))
    await click('historyPlan.refreshStatus'); expect(button('historyPlan.apply').disabled).toBe(true); expect(writes()).toHaveLength(0)
  })
  it('does not replace a draft with a mismatched checkout preview', async () => {
    await render(); call.mockImplementationOnce(async () => ({ ...preview(), binding: { ...preview().binding, checkout: '/other' } }))
    await click('historyPlan.preview'); expect(document.body.textContent).toContain(t('historyPlan.stale')); expect(sessionStorage.getItem(key())).toBeNull(); expect(writes()).toHaveLength(0)
  })
  it('reports refresh failure after successful execution without repeating the write', async () => {
    await render({ onChanged: vi.fn(async () => { throw new Error('refresh failed') }) }); await click('historyPlan.preview'); await acknowledge(); await click('historyPlan.apply')
    expect(document.body.textContent).toContain(t('historyPlan.refreshFailed')); expect(button('historyPlan.apply').disabled).toBe(true); expect(writes()).toHaveLength(1)
  })
  it('handles recovery failure conservatively and keeps the durable operation identity', async () => {
    sessionStorage.setItem(key(), 'operation-1'); hostStatus = { ...status('stopped', latest), native: { kind: 'revert', owned: true, conflicts: [], remaining: [oid(2)] } }
    await render(); call.mockImplementationOnce(async () => { throw new Error('recovery failed') }); await click('historyPlan.continue')
    expect(document.body.textContent).toContain(t('historyPlan.uncertain')); expect(button('historyPlan.continue').disabled).toBe(true); expect(sessionStorage.getItem(key())).toBe('operation-1'); expect(props.onChanged).toHaveBeenCalledOnce()
  })
  it('reads a fresh source session and ignores stale prior-source status', async () => {
    sessionStorage.setItem(key(), 'operation-1'); const pending = deferred<HistoryStatus>(); const implementation = call.getMockImplementation()!
    call.mockImplementation(async (method: string, args: Record<string, unknown>) => method === 'historyOperationStatus' ? pending.promise : implementation(method, args))
    await render(); await render({ sessionId: props.sessionId + '-new' }); await act(async () => pending.resolve(status('completed')))
    expect(document.body.textContent).not.toContain(t('historyPlan.phase.completed')); expect(writes()).toHaveLength(0)
  })
  it('routes explain, draft and review to the mandatory chooser with immutable commit scope', async () => {
    await render({ initialAction: 'revert' })
    for (const [label, verb] of [['historyPlan.explain', 'explain'], ['historyPlan.propose', 'draft'], ['historyPlan.review', 'review']] as const) {
      await click(label); expect(props.onAskAgent).toHaveBeenLastCalledWith({ verb, scope: { commits: [oid(1), oid(2)], historyAction: 'revert' } })
    }
    expect(writes()).toHaveLength(0); expect(call.mock.calls.some(([method]) => method === 'previewHistory')).toBe(false)
  })
})

describe('history workspace read views', () => {
  it('loads details and rename-aware diffs; changing file reads only that file', async () => {
    await render({ initialAction: undefined, selection: [commit(1)] })
    expect(call).toHaveBeenCalledWith('getCommitDetails', { sessionId: props.sessionId, hash: oid(1) }, expect.any(AbortSignal))
    expect(call).toHaveBeenCalledWith('getCommitDiff', { sessionId: props.sessionId, hash: oid(1), path: 'new.txt', oldPath: 'old.txt' }, expect.any(AbortSignal))
    expect(document.body.textContent).toContain('Full commit message'); expect(document.body.textContent).toContain('patch for new.txt')
    await act(async () => buttons().find(node => node.textContent === 'M second.txt')!.click())
    expect(call).toHaveBeenLastCalledWith('getCommitDiff', { sessionId: props.sessionId, hash: oid(1), path: 'second.txt' }, expect.any(AbortSignal))
    expect(document.body.textContent).toContain('patch for second.txt'); expect(writes()).toHaveLength(0)
  })
  it('compares explicit endpoints, rejects equal endpoints, and switches to inspection', async () => {
    await render({ initialAction: undefined })
    expect(call).toHaveBeenCalledWith('compareCommits', { sessionId: props.sessionId, from: oid(1), to: oid(2) }, expect.any(AbortSignal))
    expect(document.body.textContent).toContain('comparison patch')
    await input(document.querySelectorAll('select')[1]!, oid(1)); expect(document.body.textContent).toContain(t('historyPlan.distinctEndpoints'))
    await click('historyPlan.tab.inspect'); expect(document.body.textContent).toContain('Full commit message')
  })
  it('ignores stale details when navigating and shows retriable read errors', async () => {
    await render({ initialAction: undefined }); await click('historyPlan.tab.inspect')
    const pending = deferred<unknown>(); call.mockImplementationOnce(() => pending.promise)
    await input(document.querySelector('select')!, oid(2))
    await input(document.querySelector('select')!, oid(1))
    await act(async () => pending.resolve({ commit: commit(2), message: 'STALE MESSAGE', parent: null, files: [] }))
    expect(document.body.textContent).not.toContain('STALE MESSAGE')
    call.mockImplementationOnce(async () => { throw new Error('failed read') }); await input(document.querySelector('select')!, oid(2))
    expect(document.body.textContent).toContain(t('historyPlan.readFailed')); await click('history.refresh'); expect(document.body.textContent).toContain('Full commit message')
  })
  it.each(['empty', 'binary', 'large'] as const)('renders the %s diff state without mutation', async kind => {
    const implementation = call.getMockImplementation()!
    call.mockImplementation(async (method: string, args: Record<string, unknown>) => {
      if (method !== 'getCommitDiff') return implementation(method, args)
      return { path: args.path, side: 'unstaged', empty: kind === 'empty', file: kind === 'empty' ? null : { path: args.path, displayPath: args.path, hunks: [], added: 2, removed: 3, binary: kind === 'binary', tooLarge: kind === 'large', patch: 'fallback patch' } }
    })
    await render({ initialAction: undefined, selection: [commit(1)] })
    expect(document.body.textContent).toContain(t(kind === 'empty' ? 'diff.empty' : kind === 'binary' ? 'diff.binary' : 'diff.tooLarge', { added: 2, removed: 3 }))
    expect(writes()).toHaveLength(0)
  })
  it('retries a failed diff read and reports a truncated comparison', async () => {
    const implementation = call.getMockImplementation()!
    let failed = false
    call.mockImplementation(async (method: string, args: Record<string, unknown>) => {
      if (method === 'getCommitDiff' && !failed) { failed = true; throw new Error('diff failed') }
      if (method === 'compareCommits') return { from: args.from, to: args.to, summary: 'summary', patch: 'truncated patch', truncated: true }
      return implementation(method, args)
    })
    await render({ initialAction: undefined }); await click('historyPlan.tab.inspect')
    expect(document.body.textContent).toContain(t('historyPlan.readFailed'))
    await click('history.refresh'); expect(document.body.textContent).toContain('patch for new.txt')
    await click('historyPlan.tab.compare'); expect(document.body.textContent).toContain(t('historyPlan.truncated'))
  })
  it('renders native focus containment and Chinese labels', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
    await render({ t: (key, params) => interpolate(zh[key], params) })
    const dialog = document.querySelector('[role="dialog"]')!; expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.body.textContent).toContain(zh['historyPlan.title'])
    const last = buttons().at(-1)!; last.focus(); await act(async () => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
    expect(document.activeElement).not.toBe(last)
    await act(async () => root.unmount()); mounted = false; expect(document.activeElement).toBe(trigger)
  })
})
