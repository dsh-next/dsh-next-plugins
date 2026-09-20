/**
 * jsdom render test for the repository action workspace: the inventory read,
 * the preview/approve/execute split, the per-mode request fields, the branch
 * confirmation gate and the refusal envelopes. The Host contract suite covers
 * the envelope shape; this covers the browser half that dispatches it.
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RepositoryWorkspaceView, type RepositoryWorkspaceViewProps } from '../src/client/repository/RepositoryWorkspace.tsx'
import { GitApiError, type GitApi } from '../src/client/api.ts'
import { en, type MessageKey } from '../src/client/dictionaries/en.ts'
import type {
  RepositoryActionPreview,
  RepositoryActionRequest,
  RepositoryActionResult,
  RepositoryInventory,
} from '../src/core/repository-actions.ts'
import type { PanelState, WorktreeInfo } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The package dictionary with the platform's interpolation semantics. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}
const t = (key: MessageKey, params?: Record<string, string | number>): string => interpolate(en[key], params)

/** One at-rest repository with a local main and feature branch. */
function panelState(overrides: Partial<PanelState> = {}): PanelState {
  return {
    root: '/repo',
    gitDir: '/repo/.git',
    bare: false,
    head: { oid: 'aaaa', branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, detached: false, unborn: false },
    operation: { kind: null, step: null, message: null, conflicts: [] },
    changes: { staged: [], unstaged: [], untracked: [], ignored: [], conflicts: [], ignoredCount: 0, ignoredTruncated: false },
    worktrees: [worktree({ path: '/repo', branch: 'main', primary: true, managed: false, slug: null })],
    worktreeBase: { name: 'origin/main', source: 'default-branch', candidates: ['main', 'feature'] },
    branches: [
      { name: 'main', current: true, oid: 'aaaa', upstream: 'origin/main', remote: false },
      { name: 'feature', current: false, oid: 'bbbb', upstream: null, remote: false },
    ],
    tags: [],
    identity: { name: 'A', email: 'a@b' },
    cwd: '/repo',
    ...overrides,
  }
}

function worktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: '/repo/.worktrees/feature',
    head: 'bbbb',
    branch: 'feature',
    primary: false,
    locked: false,
    lockedReason: null,
    prunable: false,
    detached: false,
    managed: true,
    slug: 'feature',
    clean: true,
    ahead: 0,
    behind: 0,
    merged: false,
    ...overrides,
  }
}

/** Two remotes and two stashes, so a selection is observable. */
function inventory(overrides: Partial<RepositoryInventory> = {}): RepositoryInventory {
  return {
    remotes: [
      { name: 'origin', fetchUrls: ['https://example.test/repo.git'], pushUrls: ['ssh://example.test/repo.git'] },
      { name: 'mirror', fetchUrls: ['https://mirror.test/repo.git'], pushUrls: ['ssh://mirror.test/repo.git'] },
    ],
    stashes: [
      { oid: 'stash-1', label: 'WIP on main' },
      { oid: 'stash-2', label: 'WIP on feature' },
    ],
    ...overrides,
  }
}

function preview(request: RepositoryActionRequest, overrides: Partial<RepositoryActionPreview> = {}): RepositoryActionPreview {
  return {
    version: 'v1',
    request,
    checkout: '/repo',
    head: 'aaaa',
    summary: 'Host preview summary',
    warnings: ['Host warning'],
    ...overrides,
  }
}

function result(overrides: Partial<RepositoryActionResult> = {}): RepositoryActionResult {
  return {
    status: 'completed',
    refresh: true,
    conflictRefresh: false,
    reason: null,
    message: 'Host result message',
    stashOid: null,
    ...overrides,
  }
}

/** A scripted API double that records calls and throws on unscripted methods. */
function apiDouble(script: Record<string, unknown>): {
  api: GitApi
  calls: { method: string; args: Record<string, unknown> }[]
} {
  const calls: { method: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    api: {
      async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
        calls.push({ method, args })
        if (!(method in script)) throw new GitApiError({ code: 'git-failed', detail: 'unscripted method: ' + method }, null)
        const entry = script[method]
        const value = typeof entry === 'function' ? (entry as (input: Record<string, unknown>) => unknown)(args) : entry
        if (value instanceof Error) throw value
        return value as T
      },
    },
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

let root: Root
let container: HTMLDivElement
let mounted: boolean
let props: RepositoryWorkspaceViewProps

async function render(overrides: Partial<RepositoryWorkspaceViewProps> = {}): Promise<void> {
  const defaults: RepositoryWorkspaceViewProps = {
    sessionId: 's1',
    state: panelState(),
    api: apiDouble({ repositoryInventory: inventory() }).api,
    t,
    onClose: vi.fn(),
    onChanged: vi.fn(),
  }
  props = { ...defaults, ...overrides }
  await act(async () => { root.render(<RepositoryWorkspaceView {...props} />) })
}

const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('button')]
const buttonText = (label: string): HTMLButtonElement => {
  const found = buttons().find((node) => node.textContent?.trim() === label)
  expect(found, label).toBeDefined()
  return found!
}
const click = async (node: HTMLElement): Promise<void> => { await act(async () => { node.click() }) }
const clickText = async (label: string): Promise<void> => { await click(buttonText(label)) }
const clickTab = async (key: MessageKey): Promise<void> => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) => node.textContent?.trim() === t(key))
  expect(found, key).toBeDefined()
  await click(found!)
}
const alertText = (): string | null => document.querySelector('[role="alert"]')?.textContent ?? null
const closeButton = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('button[aria-label="' + t('confirm.cancel') + '"]')!

function inputByLabel(key: MessageKey): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find((node) =>
    node.textContent?.trim().startsWith(t(key)) && node.querySelector('input:not([type="checkbox"])'))
  expect(label, key).toBeDefined()
  return label!.querySelector('input:not([type="checkbox"])') as HTMLInputElement
}
function selectByLabel(key: MessageKey): HTMLSelectElement {
  const label = [...document.querySelectorAll('label')].find((node) =>
    node.textContent?.trim().startsWith(t(key)) && node.querySelector('select'))
  expect(label, key).toBeDefined()
  return label!.querySelector('select') as HTMLSelectElement
}
function checkboxByLabel(key: MessageKey): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find((node) =>
    node.textContent?.includes(t(key)) && node.querySelector('input[type="checkbox"]'))
  expect(label, key).toBeDefined()
  return label!.querySelector('input[type="checkbox"]') as HTMLInputElement
}

async function setValue(node: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  document.body.replaceChildren()
})

describe('repository workspace inventory', () => {
  it('reads the inventory on mount and renders remote and stash choices', async () => {
    const double = apiDouble({ repositoryInventory: inventory() })
    await render({ api: double.api })
    expect(document.querySelector('[data-dsh-git="repository-workspace"]')).not.toBeNull()
    expect(double.calls[0]).toEqual({ method: 'repositoryInventory', args: { sessionId: 's1' } })
    const remote = selectByLabel('repository.remote')
    expect([...remote.options].map((option) => option.value)).toEqual(['origin', 'mirror'])
    expect(remote.value).toBe('origin')
    expect(document.body.textContent).toContain('https://example.test/repo.git')
    await clickTab('repository.stash-apply')
    const stash = selectByLabel('repository.stash')
    expect([...stash.options].map((option) => option.value)).toEqual(['stash-1', 'stash-2'])
    expect([...stash.options].map((option) => option.textContent)).toEqual(['WIP on main', 'WIP on feature'])
    expect(stash.value).toBe('stash-1')
    expect(double.calls.some((call) => call.method === 'executeRepositoryAction')).toBe(false)
  })

  it('surfaces an inventory read failure instead of crashing', async () => {
    const double = apiDouble({ repositoryInventory: new GitApiError({ code: 'not-a-repository', detail: '/repo' }, null) })
    await render({ api: double.api })
    expect(alertText()).toBe(t('repository.readFailed'))
    expect(document.querySelector('[data-dsh-git="repository-workspace"]')).not.toBeNull()
    expect(buttonText(t('repository.preview')).disabled).toBe(true)
  })
})

describe('repository action preview and execution', () => {
  const fetchRequest: RepositoryActionRequest = { action: 'fetch', remote: 'origin', prune: false }

  it('previews without executing, then executes the approved request with the preview version', async () => {
    const double = apiDouble({
      repositoryInventory: inventory(),
      previewRepositoryAction: preview(fetchRequest),
      executeRepositoryAction: result(),
    })
    await render({ api: double.api })
    await clickText(t('repository.preview'))
    expect(double.calls[1]).toEqual({
      method: 'previewRepositoryAction',
      args: { sessionId: 's1', request: fetchRequest },
    })
    expect(document.body.textContent).toContain('Host preview summary')
    expect(document.body.textContent).toContain('aaaa')
    expect(document.body.textContent).toContain('Host warning')
    expect(double.calls.some((call) => call.method === 'executeRepositoryAction')).toBe(false)
    await clickText(t('repository.apply'))
    expect(double.calls.find((call) => call.method === 'executeRepositoryAction')).toEqual({
      method: 'executeRepositoryAction',
      args: { sessionId: 's1', request: fetchRequest, version: 'v1', approved: true },
    })
    expect(document.body.textContent).toContain(t('repository.status.completed'))
    expect(document.body.textContent).toContain('Host result message')
    expect(props.onChanged).toHaveBeenCalledTimes(1)
  })

  it('carries the fetch remote and prune fields', async () => {
    const request: RepositoryActionRequest = { action: 'fetch', remote: 'mirror', prune: true }
    const double = apiDouble({ repositoryInventory: inventory(), previewRepositoryAction: preview(request) })
    await render({ api: double.api })
    await setValue(selectByLabel('repository.remote'), 'mirror')
    await click(checkboxByLabel('repository.prune'))
    await clickText(t('repository.preview'))
    expect(double.calls[1]).toEqual({ method: 'previewRepositoryAction', args: { sessionId: 's1', request } })
  })

  it('carries the push remote and branch fields', async () => {
    const request: RepositoryActionRequest = { action: 'push', remote: 'mirror', branch: 'topic' }
    const double = apiDouble({ repositoryInventory: inventory(), previewRepositoryAction: preview(request) })
    await render({ api: double.api })
    await clickTab('repository.push')
    await setValue(selectByLabel('repository.remote'), 'mirror')
    await setValue(inputByLabel('repository.branch'), 'topic')
    await clickText(t('repository.preview'))
    expect(double.calls[1]).toEqual({ method: 'previewRepositoryAction', args: { sessionId: 's1', request } })
  })

  it('carries the stash-save includeUntracked and message fields', async () => {
    const request: RepositoryActionRequest = { action: 'stash-save', includeUntracked: true, message: 'wip' }
    const double = apiDouble({ repositoryInventory: inventory(), previewRepositoryAction: preview(request) })
    await render({ api: double.api })
    await clickTab('repository.stash-save')
    await click(checkboxByLabel('repository.includeUntracked'))
    await setValue(inputByLabel('repository.message'), 'wip')
    await clickText(t('repository.preview'))
    expect(double.calls[1]).toEqual({ method: 'previewRepositoryAction', args: { sessionId: 's1', request } })
  })

  it('carries the stash-apply stashOid field', async () => {
    const request: RepositoryActionRequest = { action: 'stash-apply', stashOid: 'stash-2' }
    const double = apiDouble({ repositoryInventory: inventory(), previewRepositoryAction: preview(request) })
    await render({ api: double.api })
    await clickTab('repository.stash-apply')
    await setValue(selectByLabel('repository.stash'), 'stash-2')
    await clickText(t('repository.preview'))
    expect(double.calls[1]).toEqual({ method: 'previewRepositoryAction', args: { sessionId: 's1', request } })
  })

  it('surfaces a rejected preview and a rejected execute as named errors', async () => {
    let previewReply: unknown = new GitApiError({ code: 'git-failed', detail: 'host failure' }, null)
    let executeReply: unknown = result()
    const double = apiDouble({
      repositoryInventory: inventory(),
      previewRepositoryAction: () => previewReply,
      executeRepositoryAction: () => executeReply,
    })
    await render({ api: double.api })
    await clickText(t('repository.preview'))
    expect(alertText()).toBe(t('repository.previewFailed'))
    expect(document.body.textContent).not.toContain('Host preview summary')
    expect(double.calls.some((call) => call.method === 'executeRepositoryAction')).toBe(false)
    previewReply = preview(fetchRequest)
    executeReply = new GitApiError({ code: 'not-merged', detail: 'stale' }, null)
    await clickText(t('repository.preview'))
    expect(alertText()).toBeNull()
    await clickText(t('repository.apply'))
    expect(alertText()).toBe(t('repository.unconfirmed'))
    expect(document.querySelector('[data-dsh-git="repository-workspace"]')).not.toBeNull()
  })

  it('refuses to execute a preview that no longer matches the current request', async () => {
    const stale = preview({ action: 'fetch', remote: 'origin', prune: true })
    const double = apiDouble({ repositoryInventory: inventory(), previewRepositoryAction: stale, executeRepositoryAction: result() })
    await render({ api: double.api })
    await clickText(t('repository.preview'))
    expect(document.body.textContent).toContain('Host preview summary')
    await clickText(t('repository.apply'))
    expect(double.calls.some((call) => call.method === 'executeRepositoryAction')).toBe(false)
    expect(document.body.textContent).toContain('Host preview summary')
  })

  it('drops an approved preview when an input changes', async () => {
    const double = apiDouble({ repositoryInventory: inventory(), previewRepositoryAction: preview(fetchRequest) })
    await render({ api: double.api })
    await clickText(t('repository.preview'))
    expect(document.body.textContent).toContain('Host preview summary')
    await click(checkboxByLabel('repository.prune'))
    expect(document.body.textContent).not.toContain('Host preview summary')
    expect(buttonText(t('repository.preview')).disabled).toBe(false)
  })

  it('disables preview while no remote is configured', async () => {
    const double = apiDouble({ repositoryInventory: inventory({ remotes: [] }) })
    await render({ api: double.api })
    expect(document.body.textContent).toContain(t('repository.noRemote'))
    expect(buttonText(t('repository.preview')).disabled).toBe(true)
    await click(buttonText(t('repository.preview')))
    expect(double.calls.some((call) => call.method === 'previewRepositoryAction')).toBe(false)
  })

  it('refreshes the inventory and notifies the parent from the footer', async () => {
    const double = apiDouble({ repositoryInventory: inventory() })
    await render({ api: double.api })
    await clickText(t('header.refresh'))
    expect(double.calls.filter((call) => call.method === 'repositoryInventory')).toHaveLength(2)
    expect(props.onChanged).toHaveBeenCalledTimes(1)
  })

  it('reports a failed refresh without unmounting the workspace', async () => {
    let reads = 0
    const repositoryInventory = (): RepositoryInventory => {
      reads += 1
      if (reads > 1) throw new GitApiError({ code: 'git-failed', detail: 'refresh' }, null)
      return inventory()
    }
    const double = apiDouble({ repositoryInventory })
    await render({ api: double.api })
    await clickText(t('header.refresh'))
    expect(alertText()).toBe(t('repository.readFailed'))
    expect(document.querySelector('[data-dsh-git="repository-workspace"]')).not.toBeNull()
  })
})

describe('branch operations', () => {
  it('requires confirmation before creating a branch and sends the start point', async () => {
    const double = apiDouble({ repositoryInventory: inventory(), branchCreate: panelState() })
    await render({ api: double.api })
    await clickTab('repository.branches')
    await setValue(inputByLabel('branches.createPlaceholder'), 'release')
    await clickText(t('branches.create'))
    expect(double.calls.some((call) => call.method === 'branchCreate')).toBe(false)
    expect(document.body.textContent).toContain(t('repository.branchConfirm', { name: 'release', target: 'main' }))
    expect(document.body.textContent).toContain('aaaa')
    expect(props.onChanged).not.toHaveBeenCalled()
    await clickText(t('confirm.proceed'))
    expect(double.calls.find((call) => call.method === 'branchCreate')).toEqual({
      method: 'branchCreate',
      args: { sessionId: 's1', name: 'release', from: 'main' },
    })
    expect(props.onChanged).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain(t('repository.branchConfirm', { name: 'release', target: 'main' }))
  })

  it('requires confirmation before renaming a branch and sends from, to and expectedOid', async () => {
    const double = apiDouble({ repositoryInventory: inventory(), branchRename: panelState() })
    await render({ api: double.api })
    await clickTab('repository.branches')
    await setValue(inputByLabel('branches.renamePlaceholder'), 'renamed')
    await clickText(t('branches.rename'))
    expect(double.calls.some((call) => call.method === 'branchRename')).toBe(false)
    expect(document.body.textContent).toContain(t('repository.branchConfirm', { name: 'main', target: 'renamed' }))
    await clickText(t('confirm.proceed'))
    expect(double.calls.find((call) => call.method === 'branchRename')).toEqual({
      method: 'branchRename',
      args: { sessionId: 's1', from: 'main', to: 'renamed', expectedOid: 'aaaa' },
    })
    expect(props.onChanged).toHaveBeenCalledTimes(1)
  })

  it('requires confirmation before deleting and passes force only after the not-merged refusal', async () => {
    let deletes = 0
    const branchDelete = (): PanelState => {
      deletes += 1
      if (deletes === 1) throw new GitApiError({ code: 'not-merged', detail: 'feature' }, null)
      return panelState()
    }
    const double = apiDouble({ repositoryInventory: inventory(), branchDelete })
    await render({ api: double.api })
    await clickTab('repository.branches')
    await setValue(selectByLabel('repository.branch'), 'feature')
    await clickText(t('branches.delete'))
    expect(double.calls.some((call) => call.method === 'branchDelete')).toBe(false)
    expect(document.body.textContent).toContain(t('repository.branchConfirm', { name: 'feature', target: 'main' }))
    await clickText(t('confirm.proceed'))
    expect(double.calls.filter((call) => call.method === 'branchDelete')[0]).toEqual({
      method: 'branchDelete',
      args: { sessionId: 's1', name: 'feature', expectedOid: 'bbbb', force: false },
    })
    expect(alertText()).toBe(t('repository.branchFailed'))
    expect(document.body.textContent).toContain(t('repository.forceBranch'))
    expect(buttonText(t('confirm.proceed')).disabled).toBe(true)
    await click(checkboxByLabel('repository.forceBranch'))
    expect(buttonText(t('confirm.proceed')).disabled).toBe(false)
    await clickText(t('confirm.proceed'))
    expect(double.calls.filter((call) => call.method === 'branchDelete')[1]).toEqual({
      method: 'branchDelete',
      args: { sessionId: 's1', name: 'feature', expectedOid: 'bbbb', force: true },
    })
    expect(props.onChanged).toHaveBeenCalledTimes(1)
  })

  it('reports a refused branch operation and keeps the confirmation open', async () => {
    const double = apiDouble({
      repositoryInventory: inventory(),
      branchCreate: new GitApiError({ code: 'git-failed', detail: 'refused' }, null),
    })
    await render({ api: double.api })
    await clickTab('repository.branches')
    await setValue(inputByLabel('branches.createPlaceholder'), 'release')
    await clickText(t('branches.create'))
    await clickText(t('confirm.proceed'))
    expect(alertText()).toBe(t('repository.branchFailed'))
    expect(buttonText(t('confirm.proceed'))).toBeDefined()
    expect(document.body.textContent).toContain(t('repository.branchConfirm', { name: 'release', target: 'main' }))
    expect(props.onChanged).not.toHaveBeenCalled()
  })

  it('disables branch creation in an unborn repository', async () => {
    const unborn = { ...panelState().head, unborn: true }
    const double = apiDouble({ repositoryInventory: inventory() })
    await render({ api: double.api, state: panelState({ head: unborn }) })
    await clickTab('repository.branches')
    await setValue(inputByLabel('branches.createPlaceholder'), 'release')
    expect(buttonText(t('branches.create')).disabled).toBe(true)
  })

  it('disables every branch action while an operation is in progress', async () => {
    const operation = { kind: 'merge' as const, step: null, message: null, conflicts: [] }
    const double = apiDouble({ repositoryInventory: inventory() })
    await render({ api: double.api, state: panelState({ operation }) })
    await clickTab('repository.branches')
    await setValue(inputByLabel('branches.createPlaceholder'), 'release')
    await setValue(inputByLabel('branches.renamePlaceholder'), 'renamed')
    await setValue(selectByLabel('repository.branch'), 'feature')
    expect(buttonText(t('branches.create')).disabled).toBe(true)
    expect(buttonText(t('branches.rename')).disabled).toBe(true)
    expect(buttonText(t('branches.delete')).disabled).toBe(true)
  })

  it('marks a branch checked out in another worktree as undeletable', async () => {
    const double = apiDouble({ repositoryInventory: inventory() })
    await render({ api: double.api, state: panelState({ worktrees: [worktree({ path: '/repo', branch: 'main', primary: true }), worktree()] }) })
    await clickTab('repository.branches')
    await setValue(selectByLabel('repository.branch'), 'feature')
    expect(buttonText(t('branches.delete')).disabled).toBe(true)
    expect(document.body.textContent).toContain(t('repository.checkedOut'))
  })
})

describe('repository workspace close', () => {
  it('cancel and the modal close button call onClose without executing', async () => {
    const double = apiDouble({ repositoryInventory: inventory() })
    await render({ api: double.api })
    await clickText(t('confirm.cancel'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    await click(closeButton())
    expect(props.onClose).toHaveBeenCalledTimes(2)
    expect(double.calls.some((call) => call.method === 'executeRepositoryAction')).toBe(false)
    expect(double.calls.some((call) => call.method === 'branchCreate')).toBe(false)
  })

  it('leaves the workspace open while a preview is pending, then closes', async () => {
    const gate = deferred<RepositoryActionPreview>()
    const double = apiDouble({
      repositoryInventory: inventory(),
      previewRepositoryAction: () => gate.promise,
      executeRepositoryAction: result(),
    })
    await render({ api: double.api })
    await clickText(t('repository.preview'))
    expect(document.body.textContent).toContain(t('repository.working'))
    await click(closeButton())
    expect(props.onClose).not.toHaveBeenCalled()
    await act(async () => { gate.resolve(preview({ action: 'fetch', remote: 'origin', prune: false })) })
    expect(document.body.textContent).toContain('Host preview summary')
    await click(closeButton())
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(double.calls.some((call) => call.method === 'executeRepositoryAction')).toBe(false)
  })
})
