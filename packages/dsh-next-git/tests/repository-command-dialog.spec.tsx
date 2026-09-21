import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandRequest, RepositoryCommandDialog, type RepositoryCommandDialogProps } from '../src/client/repository/RepositoryCommandDialog.tsx'
import { RepositoryActionDialog } from '../src/client/repository/RepositoryActionDialog.tsx'
import { RepositoryWorkspaceView } from '../src/client/repository/RepositoryWorkspace.tsx'
import { LocalCommandDialog } from '../src/client/repository/LocalCommandDialog.tsx'
import { CommitCommandDialog } from '../src/client/repository/CommitCommandDialog.tsx'
import type { RepositoryMenuCommand } from '../src/client/repository/commands.ts'
import { en } from '../src/client/dictionaries/en.ts'
import type { PanelState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const values = { remote: 'upstream', branch: 'topic', ref: 'release', name: 'new', url: 'https://example.test/r', directory: '/clone', tag: 'v2', message: 'note', stashOid: 'stash-oid' }
const cases: [RepositoryMenuCommand, Record<string, unknown>][] = [
  ...(['pull', 'pull-from', 'pull-rebase'] as const).map(command => [command, { action: 'pull', remote: values.remote, branch: values.branch, rebase: command === 'pull-rebase' }] as [RepositoryMenuCommand, Record<string, unknown>]),
  ...(['sync', 'publish'] as const).map(action => [action, { action, remote: values.remote, branch: values.branch }] as [RepositoryMenuCommand, Record<string, unknown>]),
  ...(['push-force', 'push-to-force'] as const).map(action => [action, { action: 'push-force', remote: values.remote, branch: values.branch }] as [RepositoryMenuCommand, Record<string, unknown>]),
  ['fetch-all', { action: 'fetch-all', prune: false }],
  ['merge', { action: 'merge', ref: values.ref }], ['rebase', { action: 'rebase', ref: values.ref }],
  ['remote-add', { action: 'remote-add', name: values.name, url: values.url }],
  ['remote-remove', { action: 'remote-remove', remote: values.remote }], ['tags-push', { action: 'tags-push', remote: values.remote }],
  ['remote-branch-delete', { action: 'remote-branch-delete', remote: values.remote, branch: values.branch }],
  ['tag-create', { action: 'tag-create', name: values.name, ref: values.ref, message: values.message }],
  ['tag-delete', { action: 'tag-delete', tag: values.tag }], ['remote-tag-delete', { action: 'remote-tag-delete', remote: values.remote, tag: values.tag }],
  ['stash-staged', { action: 'stash-staged', message: values.message }],
  ['stash-pop', { action: 'stash-pop', stashOid: values.stashOid }], ['stash-pop-latest', { action: 'stash-pop', stashOid: 'latest-oid' }],
  ['stash-drop', { action: 'stash-drop', stashOid: values.stashOid }], ['stash-clear', { action: 'stash-clear' }],
  ['undo-commit', { action: 'undo-commit' }], ['clone', { action: 'clone', url: values.url, directory: values.directory }],
]
function state(): PanelState {
  return { root: '/repo', cwd: '/repo', gitDir: '/repo/.git', bare: false,
    head: { oid: 'a'.repeat(40), branch: 'main', unborn: false, detached: false, upstream: 'origin/team/topic', ahead: 0, behind: 0 },
    operation: { kind: null, message: null, conflicts: [], step: null },
    changes: { staged: [], unstaged: [], untracked: [], ignored: [], conflicts: [], ignoredCount: 0, ignoredTruncated: false },
    worktrees: [], branches: [], tags: [{ name: 'v1', oid: 'a', author: 'A', committedAt: 1, subject: 'tip' }, { name: 'v2', oid: 'b', author: 'A', committedAt: 1, subject: 'tip' }], identity: { name: 'A', email: 'a@b' }, worktreeBase: { name: 'main', source: 'default-branch', candidates: ['main'] } }
}
const inventory = { remotes: [{ name: 'origin', fetchUrl: '', pushUrl: '' }, { name: 'origin/team', fetchUrl: '', pushUrl: '' }, { name: 'upstream', fetchUrl: '', pushUrl: '' }], stashes: [{ oid: 'latest-oid', label: 'latest' }, { oid: 'stash-oid', label: 'older' }] }
let root: Root, props: RepositoryCommandDialogProps
const call = vi.fn()
beforeEach(() => { root = createRoot(document.body.appendChild(document.createElement('div'))); call.mockReset(); call.mockImplementation(async (method, args) => method === 'repositoryInventory' ? inventory : method === 'previewRepositoryCommand' ? { checkout: '/repo', request: args.request, version: 'approved-version', summary: 'Review this command', warnings: ['Host warning'] } : { status: 'success', refresh: true, message: 'Completed' }) })
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren() })
async function render(command: RepositoryMenuCommand = 'merge'): Promise<void> {
  props = { command, state: state(), sessionId: 'session', api: { call }, t: key => en[key], onClose: vi.fn(), onChanged: vi.fn() }
  await act(async () => root.render(<RepositoryCommandDialog {...props} />))
}
const button = (text: string): HTMLButtonElement => [...document.querySelectorAll('button')].find(node => node.textContent === text)!
const click = async (node: HTMLElement): Promise<void> => { await act(async () => node.click()) }
async function field(label: string, value: string): Promise<void> {
  const node = [...document.querySelectorAll('label')].find(node => node.firstChild?.textContent === label)!.querySelector('input,select')! as HTMLInputElement | HTMLSelectElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
function deferred() { let resolve!: (value: unknown) => void; let reject!: (reason: unknown) => void; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

describe('focused action dialog routing', () => {
  it.each([
    ['fetch', 'fetch'], ['fetch-prune', 'fetch'], ['push', 'push'], ['push-to', 'push'],
    ['stash-save', 'stash-save'], ['stash-untracked', 'stash-save'], ['stash-apply', 'stash-apply'], ['stash-apply-latest', 'stash-apply'],
    ['branch-create', 'branch-create'], ['branch-create-from', 'branch-create'], ['branch-rename', 'branch-rename'], ['branch-delete', 'branch-delete'],
  ] as const)('routes %s to the existing %s operation and alias options', async (command, action) => {
    await render()
    const element = RepositoryActionDialog({ ...props, command })
    expect(element.type).toBe(RepositoryWorkspaceView)
    expect(element.props).toMatchObject({ action, initialPrune: command === 'fetch-prune', initialIncludeUntracked: command === 'stash-untracked', latestStash: command === 'stash-apply-latest' })
  })
  it.each(['stage-all', 'unstage-all', 'discard-all', 'abort-rebase'] as const)('routes %s to one local dialog', async command => {
    await render(); expect(RepositoryActionDialog({ ...props, command }).type).toBe(LocalCommandDialog)
  })
  it('leaves checkout to the ref picker instead of a dialog of its own', async () => {
    await render()
    // The panel never mounts a repository dialog for `checkout`: the ref
    // picker owns naming a ref, in detached mode.
    expect(RepositoryActionDialog({ ...props, command: 'checkout' }).type).toBe(RepositoryCommandDialog)
  })
  it.each(['commit', 'commit-staged', 'commit-all', 'commit-amend', 'commit-staged-amend', 'commit-all-amend', 'commit-signoff', 'commit-staged-signoff', 'commit-all-signoff'] as const)('routes %s with exact commit options', async command => {
    await render(); const element = RepositoryActionDialog({ ...props, command })
    expect(element.type).toBe(CommitCommandDialog)
    expect(element.props).toMatchObject({ mode: command.startsWith('commit-all') ? 'all' : 'staged', amend: command.endsWith('-amend'), signoff: command.endsWith('-signoff') })
  })
  it.each(cases)('routes extended %s to its command dialog', async command => {
    await render(); expect(RepositoryActionDialog({ ...props, command }).type).toBe(RepositoryCommandDialog)
  })
})

describe('extended command mapping and forms', () => {
  it.each(cases)('maps %s without UI aliases', (command, expected) => {
    expect(commandRequest(command, values)).toEqual(command === 'stash-pop-latest' ? { action: 'stash-pop', stashOid: values.stashOid } : expected)
  })
  it.each(['fetch', 'push', 'push-to', 'fetch-prune', 'stash-save', 'stash-untracked', 'stash-apply', 'stash-apply-latest', 'branch-create', 'branch-create-from', 'branch-delete', 'branch-rename', 'checkout', 'stage-all', 'unstage-all', 'discard-all', 'abort-rebase', 'commit', 'commit-staged', 'commit-all', 'commit-amend', 'commit-staged-amend', 'commit-all-amend', 'commit-signoff', 'commit-staged-signoff', 'commit-all-signoff', 'worktree-create', 'worktree-manage', 'output', 'stash-view'] as const)('does not map unsupported %s', command => {
    expect(commandRequest(command, values)).toBeNull()
  })
  it.each(cases)('chooses the fields for %s and previews the exact request', async (command, expected) => {
    await render(command)
    const labels: Record<string, string> = { remote: en['repository.remote'], branch: en['repository.branch'], ref: en['commands.ref'], name: en['commands.name'], url: en['commands.url'], directory: en['commands.directory'], tag: en['commands.tag'], message: en[command === 'tag-create' ? 'commands.annotation' : 'repository.message'], stashOid: en['repository.stash'] }
    const keys = Object.keys(expected).filter(key => key in labels && command !== 'stash-pop-latest')
    expect(document.querySelectorAll('input,select')).toHaveLength(keys.length)
    for (const key of keys) await field(labels[key]!, String(expected[key]))
    expect(document.querySelectorAll('h1,h2,h3')).toHaveLength(1)
    expect(document.body.textContent).not.toContain(en['repository.title'])
    expect(button(en['repository.preview']).disabled).toBe(false)
    expect([...document.querySelectorAll('button')].map(node => node.textContent)).not.toContain('Cancel')
    expect([...document.querySelectorAll('button')].map(node => node.textContent)).not.toContain('Refresh')
    await click(button(en['repository.preview']))
    expect(call).toHaveBeenLastCalledWith('previewRepositoryCommand', { sessionId: 'session', request: expected })
    expect(document.body.textContent).toContain('Host warning')
    expect(call.mock.calls.some(([method]) => method === 'executeRepositoryCommand')).toBe(false)
    await click(button(en['commands.confirm']))
    expect(call).toHaveBeenLastCalledWith('executeRepositoryCommand', { sessionId: 'session', request: expected, version: 'approved-version', approved: true })
    expect(props.onChanged).toHaveBeenCalledOnce()
  })
  it('chooses the longest upstream remote and its branch', async () => {
    await render('pull'); await click(button(en['repository.preview']))
    expect(call).toHaveBeenLastCalledWith('previewRepositoryCommand', { sessionId: 'session', request: { action: 'pull', remote: 'origin/team', branch: 'topic', rebase: false } })
  })
  it.each(['checkout', 'request'])('rejects a mismatched preview %s', async mismatch => {
    call.mockImplementation(async () => ({ checkout: mismatch === 'checkout' ? '/other' : '/repo', request: { action: 'merge', ref: mismatch === 'request' ? 'wrong' : 'main' }, warnings: [] }))
    await render(); await click(button(en['repository.preview']))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['repository.previewMismatch'])
    expect(button(en['commands.confirm'])).toBeUndefined()
  })
  it('invalidates approval when an input changes', async () => {
    await render(); await click(button(en['repository.preview'])); await field(en['commands.ref'], 'other')
    expect(button(en['commands.confirm'])).toBeUndefined()
    await field(en['commands.ref'], '   '); expect(button(en['repository.preview']).disabled).toBe(true)
  })
  it.each(['fetch-all', 'stash-clear', 'stash-pop', 'tag-delete', 'pull'] as const)('disables %s without selectable inventory', async command => {
    call.mockResolvedValue({ remotes: [], stashes: [] }); await render(command)
    if (command === 'tag-delete') { await act(async () => root.render(<RepositoryCommandDialog {...props} state={{ ...props.state, tags: [] }} sessionId="empty" />)) }
    expect(button(en['repository.preview']).disabled).toBe(true)
  })
})

describe('extended dialog lifecycle and readers', () => {
  it('shows loading, aborts inventory reads on unmount, and ignores late reads', async () => {
    const pending = deferred(); call.mockReturnValue(pending.promise); await render('pull')
    expect(document.body.textContent).toContain(en['repository.loading'])
    const signal = call.mock.calls[0]![2] as AbortSignal
    await act(async () => root.render(null)); expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(inventory)); expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('reports inventory and preview failures with retry', async () => {
    call.mockRejectedValue(new Error('failed')); await render('pull')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['commands.readFailed'])
    await render('merge'); await click(button(en['repository.preview']))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['repository.previewFailed'])
    expect(button(en['repository.preview']).disabled).toBe(false)
  })
  it('guards duplicate previews and prevents closing while busy', async () => {
    await render(); const pending = deferred(); call.mockReturnValue(pending.promise)
    const preview = button(en['repository.preview'])
    await act(async () => { preview.click(); preview.click() })
    expect(call).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(en['repository.working'])
    await click(document.querySelector('button[aria-label="' + en['repository.close'] + '"]')!)
    expect(props.onClose).not.toHaveBeenCalled()
    await act(async () => root.render(null)); await act(async () => pending.resolve({ checkout: '/repo', request: { action: 'merge', ref: 'main' } }))
    expect(props.onChanged).not.toHaveBeenCalled()
  })
  it.each([false, true])('guards duplicate execution and ignores late completion after unmount=%s', async unmount => {
    await render(); await click(button(en['repository.preview'])); const pending = deferred(); call.mockReturnValue(pending.promise)
    const confirm = button(en['commands.confirm']); await act(async () => { confirm.click(); confirm.click() })
    expect(call.mock.calls.filter(([method]) => method === 'executeRepositoryCommand')).toHaveLength(1)
    if (unmount) await act(async () => root.render(null))
    await act(async () => pending.resolve({ status: 'success', refresh: true }))
    expect(props.onChanged).toHaveBeenCalledTimes(unmount ? 0 : 1)
  })
  it('reports unconfirmed execution and does not refresh denied results', async () => {
    await render(); await click(button(en['repository.preview'])); call.mockRejectedValueOnce(new Error('lost'))
    await click(button(en['commands.confirm'])); expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['repository.unconfirmed'])
    expect(props.onChanged).not.toHaveBeenCalled()
    await click(button(en['repository.preview'])); call.mockResolvedValueOnce({ status: 'denied', refresh: false, message: 'Not approved' })
    await click(button(en['commands.confirm'])); expect(document.body.textContent).toContain('Not approved'); expect(props.onChanged).not.toHaveBeenCalled()
  })
  it('reads selected stash output without preview or mutation and escapes markup', async () => {
    await render('stash-view'); await field(en['repository.stash'], 'stash-oid')
    call.mockResolvedValueOnce({ stashOid: 'stash-oid', patch: '<img src=x> diff' }); await click(button(en['commands.read']))
    expect(call).toHaveBeenLastCalledWith('inspectRepositoryStash', { sessionId: 'session', stashOid: 'stash-oid' })
    expect(document.querySelector('pre')?.textContent).toBe('<img src=x> diff'); expect(document.querySelector('img')).toBeNull()
    expect(button(en['repository.preview'])).toBeUndefined(); expect(props.onChanged).not.toHaveBeenCalled()
    await field(en['repository.stash'], 'latest-oid'); expect(document.querySelector('pre')).toBeNull()
    call.mockResolvedValueOnce({ stashOid: 'wrong', patch: 'wrong patch' }); await click(button(en['commands.read'])); expect(document.querySelector('pre')).toBeNull()
    call.mockRejectedValueOnce(new Error('read')); await click(button(en['commands.read'])); expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['commands.failed'])
  })
  it('guards duplicate stash reads and ignores late completion after unmount', async () => {
    await render('stash-view'); const pending = deferred(); call.mockReturnValue(pending.promise)
    const read = button(en['commands.read']); await act(async () => { read.click(); read.click() })
    expect(call.mock.calls.filter(([method]) => method === 'inspectRepositoryStash')).toHaveLength(1)
    await act(async () => root.render(null)); await act(async () => pending.resolve({ stashOid: 'latest-oid', patch: 'late' }))
    expect(document.querySelector('pre')).toBeNull(); expect(props.onChanged).not.toHaveBeenCalled()
  })
  it('reports output failure and aborts late output reads', async () => {
    call.mockRejectedValueOnce(new Error('output unavailable')); await render('output')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['commands.readFailed'])
    await act(async () => root.render(null)); const pending = deferred(); call.mockReturnValue(pending.promise); await render('output')
    const signal = call.mock.calls.at(-1)![2] as AbortSignal
    await act(async () => root.render(null)); expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve({ text: 'late' })); expect(document.querySelector('pre')).toBeNull()
  })
  it.each(['', 'git output'])('reads repository output %j without mutation controls', async text => {
    call.mockResolvedValue({ text }); await render('output')
    expect(call).toHaveBeenCalledExactlyOnceWith('repositoryOutput', { sessionId: 'session' }, expect.any(AbortSignal))
    expect(document.querySelector('pre')?.textContent).toBe(text || en['commands.noOutput'])
    expect(document.querySelectorAll('button')).toHaveLength(1)
    await click(document.querySelector('button')!); expect(props.onClose).toHaveBeenCalledOnce()
  })
})
