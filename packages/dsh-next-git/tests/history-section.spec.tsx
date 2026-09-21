import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HistorySectionView, type HistorySectionViewProps } from '../src/client/history/HistorySection.tsx'
import { englishTranslate as t, interpolate, zh } from '../src/client/dictionaries.ts'
import { PanelStore } from '../src/client/controller.ts'
import panelClasses from '../src/client/panel.module.css'
import classes from '../src/client/history/history-section.module.css'
import { computeGraphLanes } from '../src/core/log.ts'
import type { CommitSummary, PanelState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const oid = (n: number): string => n.toString(16).padStart(40, '0')
const commit = (n: number): CommitSummary => ({ hash: oid(n), short: 'c' + n, parents: [oid(n - 1)], author: 'Author', timestamp: n, subject: 'Commit ' + n, refs: [] })
let root: Root
let container: HTMLDivElement
let props: HistorySectionViewProps
const rows = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[data-dsh-git="commit-row"]')]
const selects = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('[data-dsh-git="commit-select"]')]
const checkouts = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('[data-dsh-git="commit-checkout"]')]
const pressed = (): boolean[] => selects().map(node => node.getAttribute('aria-pressed') === 'true')
function button(text: string): HTMLButtonElement { return [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text)! }
async function render(overrides: Partial<HistorySectionViewProps> = {}): Promise<void> { props = { ...props, ...overrides }; await act(async () => root.render(<HistorySectionView {...props} />)) }
async function click(node: HTMLElement): Promise<void> { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const commits = [commit(3), commit(2), commit(1)]
  const state: PanelState = { root: '/repo', gitDir: '/repo/.git', cwd: '/repo', bare: false, head: { branch: 'main', oid: oid(3), upstream: null, ahead: 0, behind: 0, detached: false, unborn: false }, operation: { kind: null, step: null, message: null, conflicts: [] }, branches: [{ name: 'main', remote: false, current: true, oid: oid(3), upstream: null, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'tip' }], tags: [{ name: 'v1', oid: oid(3), author: 'Author', committedAt: 1, subject: 'tip' }], identity: { name: 'Author', email: null }, worktrees: [], worktreeBase: { name: 'main', source: 'default-branch', candidates: ['main'] }, changes: { staged: [], unstaged: [], untracked: [], ignored: [], conflicts: [], ignoredCount: 0, ignoredTruncated: false } }
  props = { snapshot: { ...new PanelStore({ call: vi.fn() }, 'source').getSnapshot(), state, phase: 'ready', collapsed: { changes: true, history: false, worktrees: true }, history: { commits, lanes: computeGraphLanes(commits), hasMore: true } },
    t, onToggle: vi.fn(), onRefresh: vi.fn(), onLoadMore: vi.fn(), onCheckout: vi.fn(), onInspect: vi.fn(), onCompare: vi.fn(), onAction: vi.fn() }
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('history section', () => {
  it('renders an accessible icon-only reload beside the collapsible header', async () => {
    await render()
    const refresh = button(t('history.refresh'))
    const toggle = button(t('history.title'))
    expect(toggle.parentElement?.className).toBe(panelClasses.sectionHeader)
    expect(toggle.className).toBe(panelClasses.sectionToggle)
    expect(refresh.className).toBe(panelClasses.iconButton)
    expect(refresh.textContent).toBe('')
    expect(refresh.title).toBe(t('history.refresh'))
    expect(refresh.querySelector('svg')).not.toBeNull()
    expect(toggle.querySelector('svg')).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await click(refresh)
    expect(props.onRefresh).toHaveBeenCalledOnce()
    expect(props.onToggle).not.toHaveBeenCalled()
    await render({ snapshot: { ...props.snapshot, historyLoading: true } })
    expect(refresh.disabled).toBe(true)
    await click(refresh)
    expect(props.onRefresh).toHaveBeenCalledOnce()
    await render({ snapshot: { ...props.snapshot, historyLoading: false, busy: 'busy.commit' } })
    expect(refresh.disabled).toBe(true)
    await render({ snapshot: { ...props.snapshot, busy: null, collapsed: { ...props.snapshot.collapsed, history: true } } })
    expect(refresh.disabled).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('#dsh-git-section-history')).toBeNull()
    await render({ t: (key, params) => interpolate(zh[key], params) })
    expect(refresh.getAttribute('aria-label')).toBe(zh['history.refresh'])
    expect(refresh.title).toBe(zh['history.refresh'])
  })
  it('keeps a commit list multi-selectable by ordinary clicks', async () => {
    await render()
    expect(rows()).toHaveLength(3)
    expect(container.textContent).not.toMatch(/\d+ selected/)
    expect(container.querySelector('input')).toBeNull()
    await click(selects()[0]!); await click(selects()[2]!)
    expect(pressed()).toEqual([true, false, true])
    expect(rows()[0]!.getAttribute('data-selected')).toBe('true')
    await click(selects()[0]!)
    expect(pressed()).toEqual([false, false, true])
    expect(container.textContent).not.toMatch(/\d+ selected/)
    await click(button(t('history.clearSelection')))
    expect(pressed()).toEqual([false, false, false])
  })
  it('sends the selection to Inspect, Compare and each command, oldest first', async () => {
    await render()
    await click(selects()[0]!); await click(selects()[2]!)
    const oldestFirst = [commit(1), commit(3)]
    await click(button(t('history.inspect')))
    expect(props.onInspect).toHaveBeenLastCalledWith(oldestFirst)
    await click(button(t('history.compare')))
    expect(props.onCompare).toHaveBeenLastCalledWith(oldestFirst)
    expect(props.onAction).not.toHaveBeenCalled()
  })
  it('offers every command and blocks the ones the selection cannot satisfy', async () => {
    await render()
    for (const action of ['squash', 'fixup', 'reorder', 'reword', 'cherry-pick', 'revert'] as const) {
      const command = button(t(('history.action.' + action) as Parameters<typeof t>[0]))
      expect(command.disabled).toBe(true)
      expect(command.parentElement?.title).toBe(t('history.reason.selection'))
    }
    expect(button(t('history.compare')).parentElement?.title).toBe(t('history.reason.two'))
    await click(selects()[0]!)
    expect(button(t('history.action.reword')).disabled).toBe(false)
    expect(button(t('history.action.squash')).parentElement?.title).toBe(t('history.reason.multiple'))
    await click(button(t('history.action.reword')))
    expect(props.onAction).toHaveBeenLastCalledWith('reword', [commit(3)])
    await click(selects()[2]!)
    expect(button(t('history.action.squash')).parentElement?.title).toBe(t('history.reason.contiguous'))
    await click(button(t('history.action.revert')))
    expect(props.onAction).toHaveBeenLastCalledWith('revert', [commit(1), commit(3)])
    await render({ snapshot: { ...props.snapshot, busy: 'busy.commit' } })
    expect(button(t('history.action.revert')).parentElement?.title).toBe(t('history.reason.busy'))
  })
  it('keeps the row layout and reveals its one action from the shared hover rule', async () => {
    await render()
    const checkout = checkouts()[0]!
    expect(checkout.parentElement?.className).toBe(classes.actions)
    expect(selects()[0]!.className).toBe(classes.commit)
    expect(rows()[0]!.className).toBe(classes.row)
    expect(rows()[0]!.querySelector(`.${classes.graph}`)).not.toBeNull()
    // Inspect covers reading a commit, so the row carries only the checkout verb.
    expect(container.querySelector('[data-dsh-git="commit-details"]')).toBeNull()
    expect(checkouts()).toHaveLength(rows().length)
    expect(props.onInspect).not.toHaveBeenCalled()
  })
  it('checks out from an icon button and honors busy and operation locks', async () => {
    await render()
    const checkout = checkouts()[0]!
    expect(checkout.textContent).toBe('')
    expect(checkout.title).toBe(t('history.checkout'))
    expect(checkout.getAttribute('aria-label')).toBe(t('history.checkoutHash', { hash: 'c3' }))
    expect(checkout.querySelector('svg')).not.toBeNull()
    await click(checkout)
    expect(props.onCheckout).toHaveBeenCalledWith(commit(3))
    expect(props.onInspect).not.toHaveBeenCalled()
    await render({ snapshot: { ...props.snapshot, busy: 'busy.commit' } })
    expect(checkout.disabled).toBe(true)
    await click(checkout)
    expect(props.onCheckout).toHaveBeenCalledOnce()
    await click(selects()[0]!)
    await click(checkout)
    expect(props.onCheckout).toHaveBeenCalledOnce()
    await render({ snapshot: { ...props.snapshot, busy: null, state: { ...props.snapshot.state!, operation: { kind: 'merge', step: null, message: null, conflicts: [] } } } })
    expect(checkout.disabled).toBe(true)
    // Reading history stays available while a write is locked out.
    expect(button(t('history.inspect')).disabled).toBe(false)
    await render({ t: (key, params) => interpolate(zh[key], params) })
    expect(checkout.title).toBe(zh['history.checkout'])
    expect(checkout.getAttribute('aria-label')).toBe(interpolate(zh['history.checkoutHash'], { hash: 'c3' }))
  })
  it('retains immutable rows across pagination and delegates load-more beyond 500', async () => {
    await render()
    const commits = Array.from({ length: 501 }, (_, index) => commit(501 - index))
    await render({ snapshot: { ...props.snapshot, history: { commits, lanes: computeGraphLanes(commits), hasMore: true } } })
    expect(rows()).toHaveLength(501)
    expect(rows()[0]!.getAttribute('data-hash')).toBe(commit(501).hash)
    expect(rows()[498]!.getAttribute('data-hash')).toBe(commit(3).hash)
    await click(button(t('history.loadMore'))); expect(props.onLoadMore).toHaveBeenCalledOnce()
    await render({ snapshot: { ...props.snapshot, historyLoading: true } }); expect(button(t('history.loadMore')).disabled).toBe(true)
  })
  it('draws connected bounded lanes and provides collapse, refresh, empty and localized states', async () => {
    const commits = [{ ...commit(3), parents: [oid(2), oid(1)] }, commit(2), commit(1)]
    await render({ snapshot: { ...props.snapshot, history: { commits, lanes: computeGraphLanes(commits), hasMore: false } } })
    const graphs = rows().map(row => row.querySelector('svg')!)
    expect(graphs[0]!.querySelectorAll('path')).toHaveLength(2)
    expect(graphs[1]!.querySelector('path')!.getAttribute('d')).toContain('0 V 24')
    expect(Number(graphs[0]!.getAttribute('width'))).toBeLessThanOrEqual(104)
    await click(button(t('history.refresh'))); expect(props.onRefresh).toHaveBeenCalledOnce()
    await click(button(t('history.title'))); expect(props.onToggle).toHaveBeenCalledOnce()
    await render({ snapshot: { ...props.snapshot, history: { commits: [], lanes: [], hasMore: false } }, t: (key, params) => interpolate(zh[key], params) })
    expect(container.textContent).toContain(zh['history.empty'])
    await render({ snapshot: { ...props.snapshot, collapsed: { ...props.snapshot.collapsed, history: true } } })
    expect(container.querySelector('[data-dsh-git="section-body"]')).toBeNull()
  })
})
