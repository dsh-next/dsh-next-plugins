import * as React from 'react'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { HistoryActionModal, type HistoryActionModalProps } from '../src/client/history/HistoryActionModal.tsx'
import { CompareModal, type CompareModalProps } from '../src/client/history/CompareModal.tsx'
import { englishTranslate as t, interpolate, zh } from '../src/client/dictionaries.ts'
import { GitApiError, type GitApi } from '../src/client/api.ts'
import type { HistoryAction, HistoryPreview, HistoryStatus } from '../src/core/history-plan.ts'
import type { CommitSummary } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const oid = (n: number): string => n.toString(16).padStart(40, '0')
const commit = (n: number): CommitSummary => ({ hash: oid(n), short: 'c' + n, parents: [oid(n - 1)], author: 'Author', timestamp: n, subject: 'Commit ' + n, refs: [] })
function preview(action: HistoryAction, acknowledge = false): HistoryPreview {
  return { operationId: 'operation-1', createdAt: 'now', binding: { source: { sessionId: 'session-1' }, checkout: '/repo', gitDir: '/repo/.git', commonDir: '/repo/.git', head: oid(3), headRef: 'refs/heads/main', tree: oid(4) },
    plan: { eligible: true, action, selected: [oid(1), oid(2)], ordered: [oid(1), oid(2)], affected: [oid(1), oid(2), oid(3)], descendants: [oid(3)], base: oid(0), steps: [], message: null, rewrites: true },
    publication: { state: 'unknown', refs: [], warning: 'Host publication warning' }, requiresPublishedAcknowledgment: acknowledge, backupRef: 'refs/dsh/backup/operation-1',
    otherCheckouts: [], diffSummary: '', diffMeaning: '', warnings: [], permission: { source: { sessionId: 'session-1' }, checkout: '/repo', authority: 'apply-approved-history-plan' } }
}
function status(phase: HistoryStatus['phase'], value: HistoryPreview): HistoryStatus {
  return { preview: value, phase, native: { kind: null, remaining: [], conflicts: [], owned: false }, currentHead: oid(5), currentRef: 'refs/heads/main', clean: true, completedHead: oid(5), error: null, nextStep: '', canRestore: false }
}
function buttons(): HTMLButtonElement[] { return [...document.querySelectorAll<HTMLButtonElement>('button')] }
function button(label: string): HTMLButtonElement { return buttons().find(node => (node.getAttribute('aria-label') ?? node.textContent) === label)! }
async function click(node: HTMLElement): Promise<void> { await act(async () => { node.click() }); await act(async () => { await Promise.resolve() }) }
let root: Root
let container: HTMLDivElement

beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })

it('uses the platform error token for both the error text and border', () => {
  const css = readFileSync('src/client/history/commit-details.module.css', 'utf8')
  const error = css.match(/\.error\s*\{([^}]+)\}/)![1]!
  expect(error).toContain('color: var(--dsw-alias-state-error-primary)')
  expect(error).toContain('border: 1px solid var(--dsw-alias-state-error-primary)')
  expect(css).not.toContain('--dsw-alias-label-error')
})

describe('history command modal', () => {
  let call: Mock<(method: string, args: Record<string, unknown>) => Promise<unknown>>
  let props: HistoryActionModalProps
  beforeEach(() => {
    call = vi.fn(async (method: string, args: Record<string, unknown>) => {
      if (method === 'getCommitDetails') {
        const n = args.hash === oid(1) ? 1 : 2
        return { commit: commit(n), parent: null, message: 'Commit ' + n + '\n\nBody ' + n, files: [] }
      }
      if (method === 'previewHistory') return preview(args.action as HistoryAction)
      if (method === 'executeHistory') return status('completed', preview(args.action as HistoryAction))
      throw new Error(method)
    })
    props = { sessionId: 'session-1', action: 'squash', commits: [commit(1), commit(2)], t, api: { call } as GitApi, onClose: vi.fn(), onChanged: vi.fn() }
  })

  it('asks the host for one preview on open and never writes on its own', async () => {
    await act(async () => { root.render(<HistoryActionModal {...props} />) })
    await act(async () => { await Promise.resolve() })
    expect(call.mock.calls.filter(([method]) => method === 'previewHistory')).toHaveLength(1)
    expect(call.mock.calls.filter(([method]) => method === 'executeHistory')).toHaveLength(0)
    expect(call).toHaveBeenCalledWith('previewHistory', { sessionId: 'session-1', action: 'squash', commits: [oid(1), oid(2)], message: 'Commit 1\n\nBody 1\n\nCommit 2\n\nBody 2' }, expect.anything())
    expect(document.querySelector<HTMLInputElement>('[data-dsh-git="history-summary"]')?.value).toBe('Commit 1')
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Body 1\n\nCommit 2\n\nBody 2')
    expect(document.querySelector('[data-dsh-git="action-order"]')).toBeNull()
    expect(document.body.textContent).not.toContain('refs/dsh/backup/operation-1')
  })
  it('applies the previewed operation and reports the outcome', async () => {
    const changed = vi.fn()
    await act(async () => { root.render(<HistoryActionModal {...props} onChanged={changed} />) })
    await act(async () => { await Promise.resolve() })
    await click(button(t('history.command.squash', { count: 2 })))
    expect(call).toHaveBeenCalledWith('executeHistory', { sessionId: 'session-1', operationId: 'operation-1', approved: true, acknowledgePublishedHistory: false })
    expect(changed).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain(t('history.phase.completed'))
  })
  it('requires the published-history acknowledgment before applying', async () => {
    call = vi.fn(async (method: string, args: Record<string, unknown>) => method === 'getCommitDetails' ? { message: 'Commit', files: [] } : method === 'previewHistory' ? preview(args.action as HistoryAction, true) : status('completed', preview('squash', true)))
    await act(async () => { root.render(<HistoryActionModal {...props} api={{ call } as GitApi} />) })
    await act(async () => { await Promise.resolve() })
    expect(button(t('history.command.squash', { count: 2 })).disabled).toBe(true)
    const ack = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(ack.checked).toBe(false)
    await click(ack)
    expect(button(t('history.command.squash', { count: 2 })).disabled).toBe(false)
    await click(button(t('history.command.squash', { count: 2 })))
    expect(call).toHaveBeenCalledWith('executeHistory', expect.objectContaining({ acknowledgePublishedHistory: true }))
  })
  it('sends only the order the user moved, and only for reorder', async () => {
    await act(async () => { root.render(<HistoryActionModal {...props} action="reorder" />) })
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[data-dsh-git="history-summary"]')).toBeNull()
    await click(button(t('history.moveDown', { hash: oid(1).slice(0, 7) })))
    expect(call).toHaveBeenLastCalledWith('previewHistory', { sessionId: 'session-1', action: 'reorder', commits: [oid(2), oid(1)], order: [oid(2), oid(1)] }, expect.anything())
    await act(async () => { root.render(<HistoryActionModal {...props} action="fixup" api={{ call } as GitApi} />) })
    await act(async () => { await Promise.resolve() })
    expect(buttons().some(node => node.getAttribute('aria-label')?.startsWith('Move '))).toBe(false)
  })
  it('prefills reword with the real message and stops after a settled edit', async () => {
    vi.useFakeTimers()
    try {
      await act(async () => { root.render(<HistoryActionModal {...props} action="reword" commits={[commit(1)]} />) })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      const textarea = document.querySelector<HTMLInputElement>('[data-dsh-git="history-summary"]')!
      expect(textarea.value).toBe('Commit 1')
      expect(call).toHaveBeenCalledWith('getCommitDetails', expect.objectContaining({ hash: oid(1) }), expect.anything())
      const before = call.mock.calls.filter(([method]) => method === 'previewHistory').length
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(textarea, 'Rewritten')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(call.mock.calls.filter(([method]) => method === 'previewHistory')).toHaveLength(before)
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(call).toHaveBeenLastCalledWith('previewHistory', { sessionId: 'session-1', action: 'reword', commits: [oid(1)], message: 'Rewritten\n\nBody 1' }, expect.anything())
    } finally { vi.useRealTimers() }
  })
  it('invalidates approval immediately when a message changes, before debounce', async () => {
    vi.useFakeTimers()
    try {
      await act(async () => root.render(<HistoryActionModal {...props} />))
      const summary = document.querySelector<HTMLInputElement>('[data-dsh-git="history-summary"]')!
      expect(button(t('history.command.squash', { count: 2 })).disabled).toBe(false)
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(summary, 'New summary')
        summary.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(button(t('history.command.squash', { count: 2 })).disabled).toBe(true)
      await click(button(t('history.command.squash', { count: 2 })))
      expect(call.mock.calls.some(([method]) => method === 'executeHistory')).toBe(false)
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(button(t('history.command.squash', { count: 2 })).disabled).toBe(false)
      expect(call).toHaveBeenLastCalledWith('previewHistory', expect.objectContaining({ message: 'New summary\n\nBody 1\n\nCommit 2\n\nBody 2' }), expect.anything())
    } finally { vi.useRealTimers() }
  })
  it('keeps a blank summary disabled and preserves multiline descriptions', async () => {
    await act(async () => root.render(<HistoryActionModal {...props} />))
    const summary = document.querySelector<HTMLInputElement>('[data-dsh-git="history-summary"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(summary, '')
      summary.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(button(t('history.command.squash', { count: 2 })).disabled).toBe(true)
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain('Body 2')
  })
  it('fails closed when the full commit message cannot be loaded', async () => {
    call.mockRejectedValue(new Error('unavailable'))
    await act(async () => root.render(<HistoryActionModal {...props} />))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(t('historyDetails.readFailed'))
    expect(button(t('history.command.squash', { count: 2 })).disabled).toBe(true)
    expect(call.mock.calls.some(([method]) => method === 'previewHistory')).toBe(false)
    expect(button(t('historyDetails.retry'))).toBeUndefined()
  })
  it('checks a lost execution reply without blindly repeating the command', async () => {
    const original = call.getMockImplementation()!
    call.mockImplementation(async (method, args) => {
      if (method === 'executeHistory') throw new Error('reply lost')
      if (method === 'historyOperationStatus') return status('completed', preview('squash'))
      return original(method, args)
    })
    await act(async () => root.render(<HistoryActionModal {...props} />))
    await click(button(t('history.command.squash', { count: 2 })))
    expect(button(t('history.command.squash', { count: 2 })).disabled).toBe(true)
    expect(button(t('historyDetails.retry'))).toBeUndefined()
    await click(button(t('history.refreshStatus')))
    expect(call.mock.calls.filter(([method]) => method === 'executeHistory')).toHaveLength(1)
    expect(document.body.textContent).toContain(t('history.phase.completed'))
  })
  it('shows error details directly without a disclosure or retry', async () => {
    call = vi.fn(async (method: string) => { if (method === 'getCommitDetails') return { message: 'Commit', files: [] }; throw new GitApiError({ code: 'invalid-name', detail: 'Root commits are not supported by this planner.' }, null) })
    await act(async () => { root.render(<HistoryActionModal {...props} api={{ call } as GitApi} />) })
    await act(async () => { await Promise.resolve() })
    const alert = document.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain(t('history.invalid'))
    // The engine's own sentence is kept, not replaced by a generic failure.
    expect(alert.textContent).toContain('Root commits are not supported by this planner.')
    expect(button(t('history.command.squash', { count: 2 })).disabled).toBe(true)
    expect(alert.querySelector('details, summary, button')).toBeNull()
    expect(alert.querySelectorAll('p')).toHaveLength(2)
  })
  it('says a history command needs a clean checkout, not just that it failed', async () => {
    call = vi.fn(async (method: string) => { if (method === 'getCommitDetails') return { message: 'Commit', files: [] }; throw new GitApiError({ code: 'dirty-tree', detail: 'Tracked files, the index and untracked files must all be clean; no automatic stash is performed.' }, null) })
    await act(async () => { root.render(<HistoryActionModal {...props} api={{ call } as GitApi} />) })
    await act(async () => { await Promise.resolve() })
    const alert = document.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain(t('history.error.dirty'))
    expect(alert.textContent).not.toContain(t('history.failed'))
    expect(alert.textContent).toContain('no automatic stash is performed')
  })
  it('names an operation that must finish first', async () => {
    call = vi.fn(async (method: string) => { if (method === 'getCommitDetails') return { message: 'Commit', files: [] }; throw new GitApiError({ code: 'operation-in-progress', detail: 'Finish or abort the active Git operation.' }, null) })
    await act(async () => { root.render(<HistoryActionModal {...props} api={{ call } as GitApi} />) })
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(t('history.error.operation'))
  })
  it('reports a stopped operation and offers the native recovery controls', async () => {
    call = vi.fn(async (method: string, args: Record<string, unknown>) => {
      if (method === 'previewHistory') return preview('cherry-pick')
      if (method === 'executeHistory') return { ...status('stopped', preview('cherry-pick')), native: { kind: 'cherry-pick', remaining: [oid(2)], conflicts: ['src/app.ts'], owned: true } }
      if (method === 'recoverHistory') return status('completed', preview('cherry-pick'))
      throw new Error(method)
    })
    await act(async () => { root.render(<HistoryActionModal {...props} action="cherry-pick" api={{ call } as GitApi} />) })
    await act(async () => { await Promise.resolve() })
    await click(button(t('history.command.cherry-pick', { count: 2 })))
    expect(document.body.textContent).toContain(t('history.fact.conflicts', { count: 1 }))
    expect(button(t('history.continue')).disabled).toBe(true)
    await click(button(t('history.abort')))
    expect(document.body.textContent).toContain(t('history.confirm.abort'))
    await click(button(t('history.confirmRecovery')))
    expect(call).toHaveBeenCalledWith('recoverHistory', { sessionId: 'session-1', operationId: 'operation-1', action: 'abort', discardResolutionEdits: true })
  })
  it('localizes every command label', async () => {
    await act(async () => { root.render(<HistoryActionModal {...props} t={(key, params) => interpolate(zh[key], params)} />) })
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain(zh['history.summary'])
    expect(button(interpolate(zh['history.command.squash'], { count: 2 }))).toBeDefined()
  })
})

describe('compare modal', () => {
  let props: CompareModalProps
  let call: Mock<(method: string, args: Record<string, unknown>) => Promise<unknown>>
  beforeEach(() => {
    call = vi.fn(async (method: string, args: Record<string, unknown>) => {
      if (method !== 'compareCommits') throw new Error(method)
      return { from: args.from, to: args.to, summary: ' 2 files changed', patch: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n', truncated: false }
    })
    props = { sessionId: 'session-1', commits: [commit(1), commit(2)], t, api: { call } as GitApi, onClose: vi.fn() }
  })

  it('compares the ends of the selection and renders the diff', async () => {
    await act(async () => { root.render(<CompareModal {...props} />) })
    await act(async () => { await Promise.resolve() })
    expect(call).toHaveBeenCalledWith('compareCommits', { sessionId: 'session-1', from: oid(1), to: oid(2) }, expect.anything())
    expect(document.body.textContent).not.toContain('2 files changed')
    expect(document.body.textContent).toContain('a.ts')
  })
  it('re-reads when an endpoint changes and refuses identical endpoints', async () => {
    await act(async () => { root.render(<CompareModal {...props} />) })
    await act(async () => { await Promise.resolve() })
    const [from] = [...document.querySelectorAll<HTMLSelectElement>('select')]
    await act(async () => { from!.value = oid(2); from!.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain(t('historyCompare.distinct'))
    expect(call.mock.calls.filter(([method]) => method === 'compareCommits')).toHaveLength(1)
  })
  it('names a failed comparison and warns about a truncated patch', async () => {
    call = vi.fn(async () => { throw new Error('boom') })
    await act(async () => { root.render(<CompareModal {...props} api={{ call } as GitApi} />) })
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(t('historyCompare.readFailed'))
    call = vi.fn(async () => ({ from: oid(1), to: oid(2), summary: '', patch: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n', truncated: true }))
    await act(async () => { root.render(<CompareModal {...props} api={{ call } as GitApi} />) })
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain(t('historyCompare.truncated'))
  })
})
