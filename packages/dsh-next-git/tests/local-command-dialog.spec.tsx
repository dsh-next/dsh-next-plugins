import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalCommandDialog } from '../src/client/repository/LocalCommandDialog.tsx'
import type { RepositoryCommandDialogProps } from '../src/client/repository/RepositoryCommandDialog.tsx'
import { en } from '../src/client/dictionaries/en.ts'
import { GitApiError } from '../src/client/api.ts'
import type { PanelState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const entry = (path: string): PanelState['changes']['staged'][number] => ({ path, xy: 'M.', index: 'modified', untracked: false, ignored: false })
function state(): PanelState {
  const conflict = { ...entry('conflict'), unmerged: {} } as PanelState['changes']['staged'][number]
  return { root: '/repo', cwd: '/repo', gitDir: '/repo/.git', bare: false,
    head: { oid: 'a'.repeat(40), branch: 'main', unborn: false, detached: false, upstream: null, ahead: 0, behind: 0 },
    operation: { kind: null, message: null, conflicts: [], step: null },
    changes: { staged: [entry('staged'), entry('staged'), conflict], unstaged: [entry('modified'), conflict], untracked: [entry('new'), entry('modified'), conflict], ignored: [entry('ignored')], conflicts: [conflict], ignoredCount: 1, ignoredTruncated: false },
    worktrees: [], branches: [{ name: 'main', current: true, remote: false, oid: 'a', upstream: null, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'tip' }, { name: 'topic', current: false, remote: false, oid: 'b', upstream: null, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'tip' }, { name: 'origin/nested/topic', current: false, remote: true, oid: 'c', upstream: null, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'tip' }], tags: [{ name: 'v1', oid: 'c', author: 'A', committedAt: 1, subject: 'tip' }], identity: { name: 'A', email: 'a@b' }, worktreeBase: { name: 'main', source: 'default-branch', candidates: ['main'] } }
}
let root: Root, props: RepositoryCommandDialogProps
const call = vi.fn()
beforeEach(() => { root = createRoot(document.body.appendChild(document.createElement('div'))); call.mockReset().mockResolvedValue({}) })
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren() })
async function render(command: RepositoryCommandDialogProps['command'], current = state()): Promise<void> {
  props = { command, state: current, sessionId: 's', api: { call }, t: key => en[key], onClose: vi.fn(), onChanged: vi.fn() }
  await act(async () => root.render(<LocalCommandDialog {...props} />))
}
const submit = (): HTMLButtonElement => document.querySelector('fieldset button')!
const click = async (node: HTMLElement): Promise<void> => { await act(async () => node.click()) }
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

describe('local repository commands', () => {
  it('never falls back to discard for a command routed to the wrong dialog', async () => {
    await render('output')
    expect(submit().disabled).toBe(true)
    await click(submit())
    expect(call).not.toHaveBeenCalled()
  })
  it.each([['stage-all', 'stage', ['modified', 'new']], ['unstage-all', 'unstage', ['staged']], ['discard-all', 'discard', ['modified', 'new']]] as const)('%s deduplicates paths and skips conflicts and ignored files', async (command, method, paths) => {
    await render(command)
    expect(call).not.toHaveBeenCalled()
    expect(document.querySelectorAll('button')).toHaveLength(2)
    expect(document.querySelectorAll('h1,h2,h3')).toHaveLength(1)
    expect(document.body.textContent).not.toContain(en['repository.title'])
    expect(document.body.textContent).not.toContain('Cancel'); expect(document.body.textContent).not.toContain('Refresh')
    if (command === 'discard-all') expect(document.body.textContent).toContain(en['commands.discardWarning'])
    await click(submit()); expect(call).toHaveBeenCalledExactlyOnceWith(method, { sessionId: 's', paths })
  })
  it.each(['stage-all', 'unstage-all', 'discard-all'] as const)('disables empty %s', async command => {
    const current = { ...state(), changes: { ...state().changes, staged: [], unstaged: [], untracked: [] } }
    await render(command, current); expect(submit().disabled).toBe(true); await click(submit()); expect(call).not.toHaveBeenCalled()
  })
  it('requires explicit discard confirmation and permits closing without discarding', async () => {
    await render('discard-all'); expect(call).not.toHaveBeenCalled()
    expect(submit().textContent).toBe(en['changes.discardAll'])
    await click(document.querySelector('button[aria-label="' + en['repository.close'] + '"]')!)
    expect(call).not.toHaveBeenCalled(); expect(props.onClose).toHaveBeenCalledOnce()
  })
  it.each([null, 'merge', 'cherry-pick', 'rebase'] as const)('only aborts rebase, not %s', async kind => {
    const current = { ...state(), operation: { ...state().operation, kind } }
    await render('abort-rebase', current); expect(submit().disabled).toBe(kind !== 'rebase')
    await click(submit())
    if (kind === 'rebase') expect(call).toHaveBeenCalledExactlyOnceWith('operationAbort', { sessionId: 's', expectedKind: 'rebase' })
    else expect(call).not.toHaveBeenCalled()
  })
  it('shows localized failures and allows retry', async () => {
    call.mockRejectedValueOnce(new GitApiError({ code: 'index-locked', detail: 'changed' }, null))
    await render('stage-all'); await click(submit()); expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['failure.indexLocked'])
    expect(props.onChanged).not.toHaveBeenCalled(); expect(submit().disabled).toBe(false)
    await click(submit()); expect(call).toHaveBeenCalledTimes(2); expect(props.onClose).toHaveBeenCalledOnce()
  })
  it('guards same-tick duplicate submissions and closing during execution', async () => {
    const pending = deferred(); call.mockReturnValue(pending.promise); await render('stage-all')
    const button = submit(); await act(async () => { button.click(); button.click() })
    expect(call).toHaveBeenCalledOnce(); expect(document.querySelector('fieldset')!.disabled).toBe(true)
    expect(document.body.textContent).toContain(en['repository.working'])
    await click(document.querySelector('button[aria-label="' + en['repository.close'] + '"]')!); expect(props.onClose).not.toHaveBeenCalled()
    await act(async () => pending.resolve({})); expect(props.onChanged).toHaveBeenCalledOnce(); expect(props.onClose).toHaveBeenCalledOnce()
  })
  it('ignores late mutation completion after unmount', async () => {
    const pending = deferred(); call.mockReturnValue(pending.promise); await render('stage-all'); await click(submit())
    await act(async () => root.render(null)); await act(async () => pending.resolve({}))
    expect(props.onChanged).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled()
  })
  it('does not repeat a completed mutation when refresh fails', async () => {
    await render('stage-all'); props.onChanged = vi.fn().mockRejectedValue(new Error('refresh failed'))
    await act(async () => root.render(<LocalCommandDialog {...props} />)); await click(submit())
    expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(document.querySelector('fieldset')!.disabled).toBe(true)
    await click(submit()); expect(call).toHaveBeenCalledOnce(); expect(props.onClose).not.toHaveBeenCalled()
  })
})
