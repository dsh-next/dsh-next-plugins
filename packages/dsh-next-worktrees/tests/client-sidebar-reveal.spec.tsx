import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseSearchResult, mountSidebar } from './sidebar-fixture.tsx'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let sidebar: Awaited<ReturnType<typeof mountSidebar>> | undefined
const scrolled: HTMLElement[] = []
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

beforeEach(() => {
  scrolled.length = 0
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, options: ScrollIntoViewOptions) {
      expect(options).toEqual({ block: 'nearest' })
      scrolled.push(this)
    }),
  })
})
afterEach(async () => {
  await sidebar?.dispose()
  sidebar = undefined
  vi.restoreAllMocks()
  if (originalScroll === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  else Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
})

function expectRevealed(title: string) {
  const { container } = sidebar!
  expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('')
  expect(container.querySelector('[aria-label="Search sessions"]')!.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('[aria-label="Search results"]')).toBeNull()
  const selected = container.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')!
  expect(selected.textContent).toContain(title)
  expect(scrolled).toContain(selected)
  return selected
}

describe('derived official sidebar search reveal', () => {
  it('closes search, expands an ordinary group and its overflow, then scrolls the selected row', async () => {
    sidebar = await mountSidebar({ nested: false })
    await chooseSearchResult(sidebar.container)
    expect(sidebar.open).toHaveBeenCalledWith('s6')
    expect(sidebar.view.get().groupExpansion.harbor).toBe(true)
    expect(sidebar.container.textContent).toContain('Show less')
    expectRevealed('Topic 6')
  })

  it('reveals a flat-list result without changing group expansion', async () => {
    sidebar = await mountSidebar({ flat: true })
    await chooseSearchResult(sidebar.container)
    expect(sidebar.view.get().groupExpansion).toEqual({ harbor: false, worktree: false })
    expect(sidebar.container.querySelector('[data-dshx-worktree]')).toBeNull()
    expectRevealed('Topic 6')
  })

  it.each(['Topic 0', 'Topic 6'])('opens an explicitly collapsed harbor AND cluster for %s', async (title) => {
    sidebar = await mountSidebar()
    expect(sidebar.container.querySelector('[data-dshx-worktree]')).toBeNull()
    await chooseSearchResult(sidebar.container, title)
    expect(sidebar.view.get().groupExpansion).toMatchObject({ harbor: true, worktree: true })
    const selected = expectRevealed(title)
    expect(selected.classList.contains('dshx-clusterSession')).toBe(true)
    expect(sidebar.container.textContent?.includes('Show less')).toBe(title === 'Topic 6')
    // The row acknowledges the target; unrelated store updates must not keep scrolling.
    const count = scrolled.length
    await act(async () => sidebar!.view.set({ ...sidebar!.view.get() }))
    expect(scrolled).toHaveLength(count)
  })

  it('opens a collapsed harbor even when the selected cluster was already expanded', async () => {
    sidebar = await mountSidebar({ current: 's6', expansion: { harbor: false, worktree: true } })
    await chooseSearchResult(sidebar.container)
    expect(sidebar.view.get().groupExpansion).toMatchObject({ harbor: true, worktree: true })
    expectRevealed('Topic 6')
  })

  it('waits for both workspace phase and stream readiness before revealing a nested result', async () => {
    sidebar = await mountSidebar({ phase: 'pending', stream: 'loading' })
    await chooseSearchResult(sidebar.container)
    expect(sidebar.open).toHaveBeenCalledWith('s6')
    expect(sidebar.view.get().groupExpansion).toMatchObject({ harbor: false, worktree: false })
    expect(scrolled).toHaveLength(0)
    await act(async () => sidebar!.workspace.set({ ...sidebar!.workspace.get(), phase: 'ready' }))
    expect(sidebar.view.get().groupExpansion).toMatchObject({ harbor: false, worktree: false })
    expect(scrolled).toHaveLength(0)
    await act(async () => sidebar!.workspace.set({ ...sidebar!.workspace.get(), state: 'idle' }))
    expect(sidebar.view.get().groupExpansion).toMatchObject({ harbor: true, worktree: true })
    expectRevealed('Topic 6')
  })
})

describe('derived official sidebar loading and ordinary selection', () => {
  it.each([
    { harbor: false, worktree: false },
    { harbor: true, worktree: false },
    { harbor: false, worktree: true },
  ])('preserves stored collapse choices without explicit search navigation: %j', async (expansion) => {
    sidebar = await mountSidebar({ current: 's6', expansion })
    expect(sidebar.view.get().groupExpansion).toEqual(expansion)
    expect(sidebar.actions.setGroupExpanded).not.toHaveBeenCalled()
    expect(scrolled).toHaveLength(0)
  })

  it('defers ordinary current-session and harbor auto-expansion until workspace readiness', async () => {
    sidebar = await mountSidebar({ current: 's0', expansion: {}, stream: 'loading' })
    expect(sidebar.view.get().groupExpansion).toEqual({})
    expect(sidebar.actions.setGroupExpanded).not.toHaveBeenCalled()
    await act(async () => sidebar!.workspace.set({ ...sidebar!.workspace.get(), state: 'idle' }))
    expect(sidebar.view.get().groupExpansion).toMatchObject({ harbor: true, worktree: true })
    expect(sidebar.container.textContent).toContain('Topic 0')
    expect(scrolled).toHaveLength(0)
  })

  it('does not promote a provisional blank session into a guessed account while workspaces load', async () => {
    sidebar = await mountSidebar({ current: 's6', blank: true, phase: 'pending', withholdWorkspaces: true, expansion: {} })
    expect(sidebar.actions.setSessionOrder).not.toHaveBeenCalled()
    await act(async () => sidebar!.workspace.set({
      ...sidebar!.workspace.get(), items: sidebar!.loadedItems, phase: 'ready',
    }))
    expect(sidebar.actions.setSessionOrder).toHaveBeenCalledWith('worktree', expect.arrayContaining(['s6']))
    expect(sidebar.actions.setSessionOrder).toHaveBeenCalledWith('__flat_session_order__', expect.arrayContaining(['s6']))
    expect(sidebar.actions.setSessionOrder).not.toHaveBeenCalledWith('', expect.anything())
    expect(sidebar.view.get().sessionOrderByAccount.worktree[0]).toBe('s6')
  })
})
