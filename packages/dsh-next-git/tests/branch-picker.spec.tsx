/**
 * jsdom render tests for the ref picker: the quick actions, the grouped rows
 * with tip detail, the filter and its keyboard arm, and the two-step
 * create-branch flow. The host calls are doubles, so the tests pin exactly
 * which request each pick produces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BranchPicker, type BranchPickerProps } from '../src/client/branches/BranchPicker.tsx'
import { RefQuickPick } from '../src/client/branches/RefQuickPick.tsx'
import { refAge } from '../src/client/branches/ref-time.ts'
import { interpolate, en, type MessageKey } from '../src/client/dictionaries.ts'
import type { PanelState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: MessageKey, params?: Record<string, string | number>): string => interpolate(en[key], params)

/** A repository with two local branches, one remote twin and one tag. */
function panelState(overrides: Partial<PanelState> = {}): PanelState {
  return {
    root: '/repo',
    gitDir: '/repo/.git',
    cwd: '/repo',
    bare: false,
    head: { oid: 'aaaaaaa1', branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2, detached: false, unborn: false },
    operation: { kind: null, step: null, message: null, conflicts: [] },
    changes: { staged: [], unstaged: [], untracked: [], ignored: [], conflicts: [], ignoredCount: 0, ignoredTruncated: false },
    worktrees: [],
    worktreeBase: { name: 'origin/main', source: 'default-branch', candidates: ['main'] },
    branches: [
      { name: 'main', current: true, oid: 'aaaaaaa1', upstream: 'origin/main', remote: false, author: 'Ada Lovelace', committedAt: Math.floor(Date.now() / 1000) - 60, ahead: 1, behind: 2, subject: 'fix: guard the read' },
      { name: 'feature/alpha', current: false, oid: 'ccccccc3', upstream: null, remote: false, author: 'Grace Hopper', committedAt: Math.floor(Date.now() / 1000) - 4 * 86400, ahead: 0, behind: 0, subject: 'feat: alpha' },
      { name: 'origin/main', current: false, oid: 'aaaaaaa1', upstream: null, remote: true, author: 'Ada Lovelace', committedAt: Math.floor(Date.now() / 1000) - 3600, ahead: 0, behind: 0, subject: 'fix upstream' },
      { name: 'origin/topic-remote', current: false, oid: 'eeeeeee5', upstream: null, remote: true, author: 'Grace Hopper', committedAt: Math.floor(Date.now() / 1000) - 2 * 86400, ahead: 0, behind: 0, subject: 'remote work' },
    ],
    tags: [{ name: 'v1.0.0', oid: 'ddddddd4', author: 'Grace Hopper', committedAt: Math.floor(Date.now() / 1000) - 30 * 86400, subject: 'release 1' }],
    identity: { name: 'Ada', email: null },
    ...overrides,
  }
}

let root: Root
let props: BranchPickerProps

const row = (id: string): HTMLElement | null => document.querySelector(`[data-dsh-git="ref-row"][data-ref="${id}"]`)
const marker = (name: string): HTMLElement | null => document.querySelector(`[data-dsh-git="${name}"]`)
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-dsh-git="ref-row"]')]
const action = (id: string): HTMLElement | null => document.querySelector(`[data-dsh-git="ref-action"][data-action="${id}"]`)
/** The card's one field: the filter on a list step, the name on the create step. */
const filter = (): HTMLInputElement =>
  (document.querySelector('[data-dsh-git="ref-filter"]') ?? document.querySelector('[data-dsh-git="branch-name"]')) as HTMLInputElement

async function click(node: HTMLElement | null | undefined): Promise<void> {
  expect(node).toBeTruthy()
  await act(async () => { node!.click() })
}

async function type(value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(filter(), value)
    filter().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function press(key: string): Promise<void> {
  await act(async () => { filter().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
}

/** The active row's ref id, or the action id when a quick action is active. */
function activeRow(): string | null {
  const node = document.querySelector<HTMLElement>('[aria-selected="true"]')
  return node?.dataset.ref ?? node?.dataset.action ?? null
}

async function render(overrides: Partial<PanelState> = {}, domProps: Partial<BranchPickerProps> = {}): Promise<void> {
  props = {
    state: panelState(overrides),
    t,
    onSwitch: vi.fn(),
    onDetached: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(null),
    onClose: vi.fn(),
    ...domProps,
  }
  await act(async () => root.render(<BranchPicker {...props} />))
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  root = createRoot(document.body.appendChild(document.createElement('div')))
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('checkout picker', () => {
  it('opens on the search field with the three quick actions and the grouped rows', async () => {
    await render()
    expect(filter().placeholder).toBe(en['picker.placeholder'])
    expect(marker('ref-picker')).not.toBeNull()
    expect([action('create'), action('create-from'), action('detach')].map((node) => node?.textContent)).toEqual([
      en['picker.create'],
      en['picker.createFrom'],
      en['picker.detached'],
    ])
    expect(rows().map((node) => node.dataset.ref)).toEqual([
      'branch:main',
      'branch:feature/alpha',
      'remote:origin/main',
      'remote:origin/topic-remote',
      'tag:v1.0.0',
    ])
    // The first row of each section carries its name, as the VS Code picker does.
    const kinds = [...document.querySelectorAll<HTMLElement>('span')]
      .map((node) => node.textContent)
      .filter((text) => text === en['picker.branches'] || text === en['picker.remotes'] || text === en['picker.tags'])
    expect(kinds).toEqual([en['picker.branches'], en['picker.remotes'], en['picker.tags']])
  })

  it('shows the tip author, hash, subject, drift and age on each row', async () => {
    await render()
    const main = row('branch:main')!
    expect(main.textContent).toContain('Ada Lovelace')
    expect(main.textContent).toContain('aaaaaaa')
    expect(main.textContent).toContain('fix: guard the read')
    expect(main.textContent).toContain(en['header.ahead'].replace('{count}', '1'))
    expect(main.textContent).toContain(en['header.behind'].replace('{count}', '2'))
    expect(main.textContent).toContain('1 minute ago')
    expect(row('tag:v1.0.0')?.textContent).toContain('1 month ago')
  })

  it('marks the current branch and starts on the first quick action', async () => {
    await render()
    const current = row('branch:main')?.querySelector<HTMLElement>(`[aria-label="${en['picker.current']}"]`)!
    expect(current).not.toBeNull()
    expect(current.title).toBe('')
    await act(async () => current.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(en['picker.current'])
    expect(row('branch:feature/alpha')?.querySelector(`[aria-label="${en['picker.current']}"]`)).toBeNull()
    expect(activeRow()).toBe('create')
  })

  it('switches to a local branch through its local name', async () => {
    await render()
    await click(row('branch:feature/alpha'))
    expect(props.onSwitch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'branch', name: 'feature/alpha', localName: 'feature/alpha' }))
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('checks out a remote-tracking pick with no local twin as a tracking branch', async () => {
    await render()
    await click(row('remote:origin/topic-remote'))
    expect(props.onSwitch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'remote', name: 'origin/topic-remote', localName: 'topic-remote' }))
  })

  it('treats a remote row whose local twin is checked out as already there', async () => {
    await render()
    // The row wears the current marker through its twin, so picking it closes.
    expect(row('remote:origin/main')?.querySelector(`[aria-label="${en['picker.current']}"]`)).not.toBeNull()
    await click(row('remote:origin/main'))
    expect(props.onSwitch).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('detaches when a tag is picked and closes without action for the current branch', async () => {
    await render()
    await click(row('tag:v1.0.0'))
    expect(props.onDetached).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tag', name: 'v1.0.0', oid: 'ddddddd4' }))
    await click(row('branch:main'))
    expect(props.onSwitch).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('walks the list with the arrow keys and picks the active row with Enter', async () => {
    await render()
    await press('ArrowDown')
    await press('ArrowDown')
    await press('ArrowDown')
    // Three quick actions, then the first branch row.
    expect(activeRow()).toBe('branch:main')
    await press('Enter')
    // The current branch closes the card instead of switching to itself.
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onSwitch).not.toHaveBeenCalled()
  })

  it('jumps to the ends with Home and End, and stops at them with the arrows', async () => {
    await render()
    await press('Home')
    expect(activeRow()).toBe('create')
    await press('ArrowUp')
    expect(activeRow()).toBe('create')
    await press('End')
    expect(activeRow()).toBe('tag:v1.0.0')
    await press('ArrowDown')
    expect(activeRow()).toBe('tag:v1.0.0')
    await press('Enter')
    expect(props.onDetached).toHaveBeenCalledWith(expect.objectContaining({ id: 'tag:v1.0.0' }))
  })

  it('activates the active quick action with Enter', async () => {
    await render()
    await press('Enter')
    expect(marker('branch-create')).not.toBeNull()
  })

  it('activates a quick action the pointer hovers', async () => {
    await render()
    await act(async () => { action('detach')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })) })
    expect(activeRow()).toBe('detach')
    await click(action('detach'))
    expect(filter().placeholder).toBe(en['picker.detachPlaceholder'])
  })
})

describe('picker filtering', () => {
  it('narrows the rows and drops the quick actions while a query is typed', async () => {
    await render()
    await type('alpha')
    expect(rows().map((node) => node.dataset.ref)).toEqual(['branch:feature/alpha'])
    expect(action('create')).toBeNull()
    expect(action('create-from')).toBeNull()
    expect(action('detach')).toBeNull()
  })

  it('offers to create the typed branch when no local branch uses it', async () => {
    await render()
    await type('feature/beta')
    expect(action('create-query')?.textContent).toBe('Create new branch "feature/beta"')
    await click(action('create-query'))
    expect((marker('branch-name') as HTMLInputElement).value).toBe('feature/beta')
  })

  it('shows the no-match label instead of a create row for an invalid name', async () => {
    await render()
    await type('bad name')
    expect(action('create-query')).toBeNull()
    expect(document.body.textContent).toContain(en['picker.noMatch'])
  })

  it('drops every ref row when the filter matches nothing but the name is creatable', async () => {
    await render()
    await type('zzz')
    expect(rows()).toHaveLength(0)
    expect(action('create-query')?.textContent).toBe('Create new branch "zzz"')
  })

  it('says when the repository has no refs at all', async () => {
    await render({ branches: [], tags: [] }, { startAt: 'detach' })
    expect(rows()).toHaveLength(0)
    expect(document.body.textContent).toContain(en['picker.empty'])
  })

  it('never offers to create an existing branch', async () => {
    await render()
    await type('main')
    expect(action('create-query')).toBeNull()
  })
})

describe('create branch flow', () => {
  it('creates from the current HEAD and reports the base', async () => {
    await render()
    await click(action('create'))
    expect(marker('branch-create')).not.toBeNull()
    expect(document.body.textContent).toContain('From main')
    await type('feature/beta')
    await click(marker('branch-create-submit'))
    expect(props.onCreate).toHaveBeenCalledWith('feature/beta', null)
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('disables the submit for an empty or refused name and explains why', async () => {
    await render()
    await click(action('create'))
    expect((marker('branch-create-submit') as HTMLButtonElement).disabled).toBe(true)
    await type('has space')
    expect(marker('branch-issue')?.textContent).toBe(en['issue.branch.invalid-character'])
    expect((marker('branch-create-submit') as HTMLButtonElement).disabled).toBe(true)
    await type('main')
    expect(marker('branch-issue')?.textContent).toBe(en['issue.branch.existing'])
    expect(props.onCreate).not.toHaveBeenCalled()
  })

  it('keeps the card open and shows the host refusal in place', async () => {
    await render({}, { onCreate: vi.fn().mockResolvedValue(en['failure.branchExists']) })
    await click(action('create'))
    await type('taken')
    await click(marker('branch-create-submit'))
    expect(props.onClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['failure.branchExists'])
  })

  it('keeps Enter on Back from activating the selected ref', async () => {
    await render()
    await click(action('create-from'))
    const back = marker('ref-back') as HTMLButtonElement
    await act(async () => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      expect(back.dispatchEvent(event)).toBe(true)
      // jsdom does not synthesize the native button click after keydown.
      back.click()
    })
    expect(filter().placeholder).toBe(en['picker.placeholder'])
    expect(props.onSwitch).not.toHaveBeenCalled()
    expect(props.onCreate).not.toHaveBeenCalled()
  })

  it('creates from a picked base ref through the base list', async () => {
    await render()
    await click(action('create-from'))
    expect(filter().placeholder).toBe(en['picker.basePlaceholder'])
    const back = marker('ref-back') as HTMLButtonElement
    await act(async () => back.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(en['picker.back'])
    await click(back)
    expect(filter().placeholder).toBe(en['picker.placeholder'])
    await click(action('create-from'))
    await click(row('tag:v1.0.0'))
    expect(marker('branch-create')).not.toBeNull()
    expect(document.body.textContent).toContain('From v1.0.0')
    await type('release/next')
    await click(marker('branch-create-submit'))
    expect(props.onCreate).toHaveBeenCalledWith('release/next', 'ddddddd4')
  })

  it('returns from the name step to the base it started from, then submits with Enter', async () => {
    await render()
    await click(action('create-from'))
    await click(row('branch:feature/alpha'))
    await click(marker('branch-create-back'))
    expect(filter().placeholder).toBe(en['picker.basePlaceholder'])
    await click(row('branch:feature/alpha'))
    await type('release/next')
    await act(async () => {
      ;(marker('branch-name') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(props.onCreate).toHaveBeenCalledWith('release/next', 'ccccccc3')
  })

  it('refuses to create in an unborn repository', async () => {
    await render({ head: { ...panelState().head, branch: null, unborn: true } })
    expect(action('create')?.getAttribute('aria-disabled')).toBe('true')
    await click(action('create'))
    expect(marker('branch-create')).toBeNull()
  })
})

describe('detached checkout flow', () => {
  it('lists every ref with the detach hint and detaches from a pick', async () => {
    await render()
    await click(action('detach'))
    expect(filter().placeholder).toBe(en['picker.detachPlaceholder'])
    expect(document.body.textContent).toContain(en['picker.detachHint'])
    // HEAD's own branch is a no-op; every other ref detaches, remotes included.
    await click(row('branch:main'))
    expect(props.onDetached).not.toHaveBeenCalled()
    await click(row('remote:origin/main'))
    expect(props.onDetached).toHaveBeenCalledWith(expect.objectContaining({ kind: 'remote', oid: 'aaaaaaa1' }))
  })

  it('opens straight on the detached list for the repository Checkout command', async () => {
    await render({}, { startAt: 'detach' })
    expect(filter().placeholder).toBe(en['picker.detachPlaceholder'])
    expect(marker('ref-back')).toBeNull()
    expect(action('create')).toBeNull()
  })
})

describe('ref age text', () => {
  const now = Date.UTC(2024, 0, 31, 12, 0, 0)
  it.each([
    ['now', 0, 'now'],
    ['1 minute', 60_000, '1 minute ago'],
    ['12 minutes', 12 * 60_000, '12 minutes ago'],
    ['1 hour', 3_600_000, '1 hour ago'],
    ['5 hours', 5 * 3_600_000, '5 hours ago'],
    ['1 day', 86_400_000, '1 day ago'],
    ['3 days', 3 * 86_400_000, '3 days ago'],
    ['1 month', 30 * 86_400_000, '1 month ago'],
    ['2 months', 60 * 86_400_000, '2 months ago'],
    ['11 months', 330 * 86_400_000, '11 months ago'],
    ['1 year', 400 * 86_400_000, '1 year ago'],
    ['2 years', 800 * 86_400_000, '2 years ago'],
  ])('renders %s', (_label, offsetMs, expected) => {
    expect(refAge((now - offsetMs) / 1000, t, now)).toBe(expected)
  })

  it('shows nothing without a usable commit time', () => {
    expect(refAge(0, t, now)).toBeNull()
    expect(refAge(-5, t, now)).toBeNull()
  })
})

describe('quick pick in isolation', () => {
  async function renderPick(overrides: Partial<React.ComponentProps<typeof RefQuickPick>> = {}): Promise<void> {
    const pick = vi.fn()
    await act(async () => root.render(
      <RefQuickPick marker="ref-picker" title={t('picker.title')} placeholder={t('picker.placeholder')}
        groups={[]} query="" onQuery={vi.fn()} emptyLabel={t('picker.empty')} t={t}
        onClose={vi.fn()} onPick={pick} {...overrides} />,
    ))
  }

  it('shows the empty label and a host error when there is nothing to pick', async () => {
    await renderPick({ error: 'boom' })
    expect(document.body.textContent).toContain(en['picker.empty'])
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('boom')
  })

  it('renders the field and no rows when there are no groups', async () => {
    await renderPick()
    expect(marker('ref-picker')).not.toBeNull()
    expect(rows()).toHaveLength(0)
    expect(action('create')).toBeNull()
  })

  it('ticks the owner-chosen row without claiming it is the checkout', async () => {
    await renderPick({
      groups: [{ kind: 'branch', refs: [
        { id: 'branch:main', kind: 'branch', name: 'main', localName: 'main', oid: 'a', author: 'Ada', committedAt: 0, ahead: 0, behind: 0, current: false, upstream: null, subject: 'tip' },
        { id: 'branch:feature', kind: 'branch', name: 'feature', localName: 'feature', oid: 'b', author: 'Ada', committedAt: 0, ahead: 0, behind: 0, current: false, upstream: null, subject: 'tip' },
      ] }],
      selectedId: 'branch:feature',
    })
    // Glyph plus check on the marked row, glyph alone on the other.
    expect(row('branch:feature')?.querySelectorAll('svg')).toHaveLength(2)
    expect(row('branch:main')?.querySelectorAll('svg')).toHaveLength(1)
    expect(document.querySelector(`[aria-label="${en['picker.current']}"]`)).toBeNull()
  })

  it('keeps a supplied action above the rows and reports its id', async () => {
    const onAction = vi.fn()
    await renderPick({
      groups: [{ kind: 'branch', refs: [{ id: 'branch:main', kind: 'branch', name: 'main', localName: 'main', oid: 'a', author: 'Ada', committedAt: 0, ahead: 0, behind: 0, current: true, upstream: null, subject: 'tip' }] }],
      actions: [{ id: 'new', label: 'New branch' }],
      onAction,
    })
    expect(rows().map((node) => node.dataset.ref)).toEqual(['branch:main'])
    expect(action('new')?.textContent).toBe('New branch')
    await click(action('new'))
    expect(onAction).toHaveBeenCalledWith('new')
  })
})
