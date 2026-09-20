import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HistorySectionView, type HistorySectionViewProps } from '../src/client/history/HistorySection.tsx'
import { englishTranslate as t, interpolate, zh } from '../src/client/dictionaries.ts'
import { PanelStore } from '../src/client/controller.ts'
import { emptyHistoryQuery } from '../src/core/history-view.ts'
import { computeGraphLanes } from '../src/core/log.ts'
import type { CommitSummary, PanelState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const oid = (n: number): string => n.toString(16).padStart(40, '0')
const commit = (n: number): CommitSummary => ({ hash: oid(n), short: 'c' + n, parents: [oid(n - 1)], author: 'Author', timestamp: n, subject: 'Commit ' + n, refs: [] })
let root: Root
let container: HTMLDivElement
let props: HistorySectionViewProps
const rows = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.textContent?.startsWith('Commit '))
const checks = (): HTMLInputElement[] => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
function button(key: Parameters<typeof t>[0]): HTMLButtonElement { return [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === props.t(key))! }
async function render(overrides: Partial<HistorySectionViewProps> = {}): Promise<void> { props = { ...props, ...overrides }; await act(async () => root.render(<HistorySectionView {...props} />)) }
async function click(node: HTMLElement, options: MouseEventInit = {}): Promise<void> { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true, ...options })) }) }
async function key(node: HTMLElement, key: string, options: KeyboardEventInit = {}): Promise<void> { await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, ...options })) }) }
async function field(node: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> { await act(async () => { Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const commits = [commit(3), commit(2), commit(1)]
  const state: PanelState = { root: '/repo', gitDir: '/repo/.git', cwd: '/repo', bare: false, head: { branch: 'main', oid: oid(3), upstream: null, ahead: 0, behind: 0, detached: false, unborn: false }, operation: { kind: null, step: null, message: null, conflicts: [] }, branches: [{ name: 'main', remote: false, current: true, oid: oid(3), upstream: null }, { name: 'origin/topic', remote: true, current: false, oid: oid(2), upstream: null }], tags: ['v1'], identity: { name: 'Author', email: null }, worktrees: [], worktreeBase: { name: 'main', source: 'default-branch', candidates: ['main'] }, changes: { staged: [], unstaged: [], untracked: [], ignored: [], conflicts: [], ignoredCount: 0, ignoredTruncated: false } }
  props = { snapshot: { ...new PanelStore({ call: vi.fn() }, 'source').getSnapshot(), state, phase: 'ready', collapsed: { changes: true, history: false, worktrees: true }, history: { commits, lanes: computeGraphLanes(commits), hasMore: true } },
    t, query: emptyHistoryQuery, onQuery: vi.fn(), onToggle: vi.fn(), onRefresh: vi.fn(), onLoadMore: vi.fn(), onCheckout: vi.fn(), onOpen: vi.fn() }
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('history section', () => {
  it('keeps inspection independent from checkbox selection and passes chronological IDs', async () => {
    await render(); await click(checks()[0]!); await click(checks()[1]!)
    expect(checks().map(node => node.checked)).toEqual([true, true, false])
    await click(rows()[2]!)
    expect(props.onOpen).toHaveBeenLastCalledWith([commit(1)])
    expect(checks().map(node => node.checked)).toEqual([true, true, false])
    await click(button('history.inspect'))
    expect(props.onOpen).toHaveBeenLastCalledWith([commit(2), commit(3)])
    await click(button('history.compare'))
    expect(props.onOpen).toHaveBeenLastCalledWith([commit(2), commit(3)])
    await click(button('historyPlan.action.revert'))
    expect(props.onOpen).toHaveBeenLastCalledWith([commit(2), commit(3)], 'revert')
    expect(props.onCheckout).not.toHaveBeenCalled()
  })
  it('supports shift ranges and Ctrl/Cmd keyboard toggles without opening inspection', async () => {
    await render(); await click(checks()[0]!); await key(checks()[2]!, ' ', { shiftKey: true })
    expect(checks().every(node => node.checked)).toBe(true)
    await click(rows()[1]!, { ctrlKey: true })
    expect(checks().map(node => node.checked)).toEqual([true, false, true])
    await key(rows()[1]!, 'Enter', { metaKey: true })
    expect(checks().every(node => node.checked)).toBe(true)
    expect(props.onOpen).not.toHaveBeenCalled()
    await click(button('history.clearSelection')); expect(checks().some(node => node.checked)).toBe(false)
  })
  it.each(['squash', 'fixup', 'reorder', 'cherry-pick', 'revert'] as const)('opens %s as a plan in oldest-first order, never executes it', async action => {
    await render(); await click(checks()[0]!); await click(checks()[1]!)
    await click(button(('historyPlan.action.' + action) as Parameters<typeof t>[0]))
    expect(props.onOpen).toHaveBeenCalledWith([commit(2), commit(3)], action)
  })
  it('opens single reword and checkout through separate callbacks', async () => {
    await render(); await click(checks()[0]!); await click(button('historyPlan.action.reword'))
    expect(props.onOpen).toHaveBeenCalledWith([commit(3)], 'reword')
    await click(container.querySelector('[aria-label="Check out c3"]')!)
    expect(props.onCheckout).toHaveBeenCalledWith(commit(3))
  })
  it('explains invalid selection, merge/root, range, and operation restrictions', async () => {
    await render(); expect(button('historyPlan.action.squash').disabled).toBe(true)
    expect(button('historyPlan.action.squash').parentElement?.title).toBe(t('history.reason.selection'))
    await click(checks()[0]!); expect(button('historyPlan.action.squash').parentElement?.title).toBe(t('history.reason.multiple'))
    await click(checks()[2]!); expect(button('historyPlan.action.squash').parentElement?.title).toBe(t('history.reason.contiguous'))
    expect(button('historyPlan.action.reword').parentElement?.title).toBe(t('history.reason.one'))
    const commits = [{ ...commit(3), parents: [oid(2), oid(1)] }, commit(2), commit(1)]
    await render({ snapshot: { ...props.snapshot, history: { commits, lanes: computeGraphLanes(commits), hasMore: false } } })
    expect(button('historyPlan.action.revert').parentElement?.title).toBe(t('history.reason.topology'))
    await render({ snapshot: { ...props.snapshot, busy: 'busy.commit' } })
    expect(button('historyPlan.action.revert').parentElement?.title).toBe(t('history.reason.busy'))
  })
  it('delegates every filter and obtains local, remote and tag refs from state', async () => {
    await render()
    const select = container.querySelector('select')!
    expect([...select.options].map(option => option.value)).toEqual(['', 'refs/heads/main', 'refs/remotes/origin/topic', 'refs/tags/v1'])
    await field(select, 'refs/tags/v1'); expect(props.onQuery).toHaveBeenLastCalledWith({ ...emptyHistoryQuery, ref: 'refs/tags/v1' })
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')]
    for (const [index, name, value] of [[0, 'search', 'literal.*'], [1, 'author', 'Someone'], [2, 'since', '2025-01-01'], [3, 'until', '2025-12-31']] as const) {
      await field(inputs[index]!, value); expect(props.onQuery).toHaveBeenLastCalledWith({ ...emptyHistoryQuery, [name]: value })
    }
    await click(checks()[0]!); await render({ query: { ...emptyHistoryQuery, search: 'new' } }); expect(checks().every(node => !node.checked)).toBe(true)
  })
  it('allows selected current branch and disables rewriting a different ref', async () => {
    await render({ query: { ...emptyHistoryQuery, ref: 'refs/heads/main' } }); await click(checks()[0]!); expect(button('historyPlan.action.reword').disabled).toBe(false)
    await render({ query: { ...emptyHistoryQuery, ref: 'refs/tags/v1' } }); await click(checks()[0]!); expect(button('historyPlan.action.reword').parentElement?.title).toBe(t('history.reason.current'))
  })
  it('retains immutable IDs across pagination and delegates load-more even beyond 500', async () => {
    await render(); await click(checks()[0]!)
    const commits = Array.from({ length: 501 }, (_, index) => commit(501 - index))
    await render({ snapshot: { ...props.snapshot, history: { commits, lanes: computeGraphLanes(commits), hasMore: true } } })
    expect(checks().filter(node => node.checked)).toHaveLength(1)
    expect(checks()[498]!.checked).toBe(true)
    await click(button('history.loadMore')); expect(props.onLoadMore).toHaveBeenCalledOnce()
    await render({ snapshot: { ...props.snapshot, historyLoading: true } }); expect(button('history.loadMore').disabled).toBe(true)
  })
  it('draws connected bounded lanes and provides collapse, refresh, empty and localized states', async () => {
    const commits = [{ ...commit(3), parents: [oid(2), oid(1)] }, commit(2), commit(1)]
    await render({ snapshot: { ...props.snapshot, history: { commits, lanes: computeGraphLanes(commits), hasMore: false } } })
    const svg = container.querySelectorAll('svg')
    expect(svg[0]!.querySelectorAll('path')).toHaveLength(2)
    expect(svg[1]!.querySelector('path')!.getAttribute('d')).toContain('0 V 24')
    expect(Number(svg[0]!.getAttribute('width'))).toBeLessThanOrEqual(104)
    await click(button('history.refresh')); expect(props.onRefresh).toHaveBeenCalledOnce()
    await click(button('history.title')); expect(props.onToggle).toHaveBeenCalledOnce()
    await render({ snapshot: { ...props.snapshot, history: { commits: [], lanes: [], hasMore: false } }, t: (key, params) => interpolate(zh[key], params) })
    expect(container.textContent).toContain(zh['history.noMatches'])
    await render({ snapshot: { ...props.snapshot, collapsed: { ...props.snapshot.collapsed, history: true } } })
    expect(container.querySelector('select')).toBeNull()
  })
})
