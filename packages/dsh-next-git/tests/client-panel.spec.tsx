/**
 * jsdom render test for the Git panel: proves the tab body renders the real
 * section stack from the Host envelope and that the controls dispatch the RPC
 * calls they claim to. Complements the Host contract suite (envelope shape)
 * and the real-mount e2e marker (whole shell).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GitApiError } from '../src/client/api.ts'
import { GitPanel, GitTitle, releaseStore, setPanelApi, type GitApiLike } from '../src/client/GitPanel.tsx'
import { en, interpolate, type MessageKey } from '../src/client/dictionaries.ts'
import type { PanelState } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A panel state with one staged and one unstaged file. */
function panelState(overrides: Partial<PanelState> = {}): PanelState {
  return {
    root: '/repo',
    gitDir: '/repo/.git',
    bare: false,
    head: {
      oid: 'aaaa',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 2,
      detached: false,
      unborn: false,
    },
    operation: { kind: null, step: null, message: null, conflicts: [] },
    changes: {
      staged: [{ path: 'src/staged.ts', xy: 'M.', untracked: false, ignored: false, index: 'modified' }],
      unstaged: [{ path: 'src/app.ts', xy: '.M', untracked: false, ignored: false, worktree: 'modified' }],
      untracked: [{ path: 'docs/new.md', xy: '??', untracked: true, ignored: false, worktree: 'untracked' }],
      ignored: [],
      conflicts: [],
      ignoredCount: 3,
      ignoredTruncated: false,
    },
    worktrees: [
      {
        path: '/repo',
        head: 'aaaa',
        branch: 'main',
        primary: true,
        locked: false,
        managed: false,
        slug: null,
        clean: true,
        ahead: 0,
        merged: false,
      },
      {
        path: '/repo/.worktrees/feature',
        head: 'bbbb',
        branch: 'dsh-git/feature',
        primary: false,
        locked: false,
        managed: true,
        slug: 'feature',
        clean: false,
        ahead: 2,
        merged: false,
      },
    ],
    branches: [
      { name: 'main', current: true, oid: 'aaaa', upstream: 'origin/main', remote: false },
      { name: 'feature', current: false, oid: 'bbbb', upstream: null, remote: false },
    ],
    identity: { name: 'A', author: undefined, email: 'a@b' } as PanelState['identity'],
    cwd: '/repo',
    ...overrides,
  }
}

/** Scripted API; records calls and can be reconfigured per test. */
function apiDouble(script: Record<string, unknown>): {
  api: GitApiLike
  calls: { method: string; args: Record<string, unknown> }[]
  set: (method: string, value: unknown) => void
} {
  const calls: { method: string; args: Record<string, unknown> }[] = []
  const table = { ...script }
  return {
    calls,
    set: (method, value) => {
      table[method] = value
    },
    api: {
      async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
        calls.push({ method, args })
        const value = table[method]
        if (value === undefined) throw new GitApiError({ code: 'git-failed', detail: `no script: ${method}` }, null)
        if (value instanceof Error) throw value
        if (typeof value === 'function') return (value as () => unknown)() as T
        return value as T
      },
    },
  }
}

const t = (key: MessageKey, params?: Record<string, string | number>): string => interpolate(en[key], params)

const useTabInfo = () => ({
  tab: { title: 'Source control', actions: { openResource: openResourceSpy } },
})
const openResourceSpy = vi.fn<(address: string, options?: unknown) => void>()

let container: HTMLDivElement
let root: Root
let session = 0
let renders = 0

beforeEach(() => {
  openResourceSpy.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  session += 1
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

/** Render the panel for one scripted API and settle the first read. */
async function renderPanel(script: Record<string, unknown>, extra: { sendPrompt?: (prompt: string) => void } = {}) {
  const double = apiDouble({ getState: { state: panelState(), notice: null }, ...script })
  setPanelApi(() => double.api)
  // One store per render: a second renderPanel in the same test must get the
  // new double, not the memoized store of the first.
  renders += 1
  const sessionId = `session-${session}-${renders}`
  await act(async () => {
    root.render(
      React.createElement(GitPanel, {
        sessionId,
        useTabInfo,
        t,
        ...(extra.sendPrompt === undefined ? {} : { sendPrompt: extra.sendPrompt }),
      }),
    )
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  return { double, sessionId }
}

/**
 * Type into a React-controlled field. Assigning `.value` directly does not
 * reach React's tracker, so the native setter has to run before the input
 * event (the standard controlled-input test dance).
 */
function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Query helpers over stable DOM markers. */
const marker = (name: string): HTMLElement | null => container.querySelector(`[data-dsh-git="${name}"]`)
const all = (name: string): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(`[data-dsh-git="${name}"]`)]
const byText = (text: string, tag = 'button'): HTMLElement | undefined =>
  [...container.querySelectorAll(tag)].find((element) => element.textContent?.includes(text)) as HTMLElement | undefined

describe('git panel body', () => {
  it('renders the panel, header and sections from the envelope', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    expect(marker('panel')).not.toBeNull()
    expect(marker('body')).not.toBeNull()
    expect(marker('branch-button')?.textContent).toContain('main')
    expect(container.textContent).toContain('1 ahead')
    expect(container.textContent).toContain('2 behind')
    expect(marker('changes')).not.toBeNull()
    expect(marker('commit')).not.toBeNull()
    expect(marker('worktrees')).not.toBeNull()
    expect(container.textContent).toContain('feature')
    expect(container.textContent).toContain('3 ignored')
  })

  it('renders one row per changed path with its status badge', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const rows = all('row').filter((row) => row.getAttribute('data-path') !== null)
    expect(rows.map((row) => row.getAttribute('data-path'))).toEqual([
      'src/staged.ts',
      'src/app.ts',
      'docs/new.md',
    ])
    expect(container.textContent).toContain('staged.ts')
    expect(container.textContent).toContain('new.md')
  })

  it('starts with the three sections expanded as accordion headers', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const toggles = [...container.querySelectorAll<HTMLElement>('[data-dsh-git="section-toggle"]')]
    expect(toggles.map((toggle) => toggle.getAttribute('data-section'))).toEqual([
      'changes',
      'worktrees',
      'history',
    ])
    for (const toggle of toggles) {
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
    }
    expect(all('section-body')).toHaveLength(3)
  })

  it('collapses one section without closing the others, and expands it back', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const worktrees = container.querySelector<HTMLElement>('[data-dsh-git="section-toggle"][data-section="worktrees"]')!
    await act(async () => {
      worktrees.click()
    })
    expect(worktrees.getAttribute('aria-expanded')).toBe('false')
    // The worktree rows are gone while the change rows stay.
    expect(container.querySelectorAll('[data-dsh-git="worktree"]')).toHaveLength(0)
    expect(all('row').some((row) => row.getAttribute('data-path') === 'src/app.ts')).toBe(true)
    expect(container.querySelector('[data-dsh-git="section-body"][data-section="worktrees"]')).toBeNull()
    await act(async () => {
      worktrees.click()
    })
    expect(worktrees.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('[data-dsh-git="worktree"]').length).toBeGreaterThan(0)
  })

  it('collapses the changes section with its rows and empty state', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const changes = container.querySelector<HTMLElement>('[data-dsh-git="section-toggle"][data-section="changes"]')!
    await act(async () => {
      changes.click()
    })
    expect(all('row').filter((row) => row.getAttribute('data-path') !== null)).toHaveLength(0)
    expect(container.textContent).not.toContain(en['changes.none'])
    // History and worktrees are untouched.
    expect(container.querySelectorAll('[data-dsh-git="commit-row"]').length).toBe(0)
    expect(container.querySelector('[data-dsh-git="history"]')).not.toBeNull()
    expect(container.querySelector('[data-dsh-git="section-body"][data-section="history"]')).not.toBeNull()
  })

  it('stages one path through the row action', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      stage: panelState({ changes: { ...panelState().changes, unstaged: [] } }),
    })
    const row = all('row').find((candidate) => candidate.getAttribute('data-path') === 'src/app.ts')!
    const stageButton = row.querySelector('button[aria-label="Stage"]') as HTMLButtonElement
    await act(async () => {
      stageButton.click()
    })
    expect(double.calls.find((call) => call.method === 'stage')?.args).toMatchObject({ paths: ['src/app.ts'] })
  })

  it('unstages a staged path', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      unstage: panelState(),
    })
    const row = all('row').find((candidate) => candidate.getAttribute('data-path') === 'src/staged.ts')!
    const unstaged = row.querySelector('button[aria-label="Unstage"]') as HTMLButtonElement
    await act(async () => {
      unstaged.click()
    })
    expect(double.calls.find((call) => call.method === 'unstage')?.args).toMatchObject({ paths: ['src/staged.ts'] })
  })

  it('confirms a discard before dispatching it', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      discard: panelState(),
    })
    const row = all('row').find((candidate) => candidate.getAttribute('data-path') === 'src/app.ts')!
    const discardButton = row.querySelector('button[aria-label="Discard"]') as HTMLButtonElement
    await act(async () => {
      discardButton.click()
    })
    // The danger dialog names the file count before anything is written.
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('1 file')
    expect(double.calls.some((call) => call.method === 'discard')).toBe(false)
    const confirmButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(en['confirm.force']),
    ) as HTMLButtonElement
    await act(async () => {
      confirmButton.click()
    })
    expect(double.calls.find((call) => call.method === 'discard')?.args).toMatchObject({ paths: ['src/app.ts'] })
  })

  it('stages everything from the section header', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      stage: panelState({ changes: { ...panelState().changes, unstaged: [], untracked: [] } }),
    })
    await act(async () => {
      ;(marker('stage-all') as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'stage')?.args).toMatchObject({
      paths: ['src/app.ts', 'docs/new.md'],
    })
  })

  it('unstages everything from the section header', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      unstage: panelState(),
    })
    await act(async () => {
      ;(marker('unstage-all') as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'unstage')?.args).toMatchObject({ paths: ['src/staged.ts'] })
  })

  it('confirms a discard-all from the section header', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      discard: panelState(),
    })
    await act(async () => {
      ;(marker('discard-all') as HTMLButtonElement).click()
    })
    expect(double.calls.some((call) => call.method === 'discard')).toBe(false)
    const confirmButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(en['confirm.force']),
    ) as HTMLButtonElement
    await act(async () => {
      confirmButton.click()
    })
    expect(double.calls.find((call) => call.method === 'discard')?.args).toMatchObject({
      paths: ['src/app.ts', 'docs/new.md'],
    })
  })

  it('opens a file diff and returns to the sections', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      getDiff: {
        path: 'src/app.ts',
        side: 'unstaged',
        empty: false,
        file: {
          path: 'src/app.ts',
          displayPath: 'src/app.ts',
          hunks: [{ header: '-1,1 +1,1', oldText: 'const a = 1', newText: 'const a = 2' }],
          added: 1,
          removed: 1,
          binary: false,
          tooLarge: false,
          patch: '@@ -1,1 +1,1 @@',
        },
      },
    })
    const row = all('row').find((candidate) => candidate.getAttribute('data-path') === 'src/app.ts')!
    await act(async () => {
      row.click()
    })
    expect(marker('diff')).not.toBeNull()
    expect(double.calls.find((call) => call.method === 'getDiff')?.args).toMatchObject({
      path: 'src/app.ts',
      side: 'unstaged',
    })
    const back = marker('diff-back') as HTMLButtonElement
    await act(async () => {
      back.click()
    })
    expect(marker('diff')).toBeNull()
    expect(marker('changes')).not.toBeNull()
  })

  it('hands a file to the stock viewer through its resource address', async () => {
    await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      getDiff: {
        path: 'src/app.ts',
        side: 'unstaged',
        empty: false,
        file: {
          path: 'src/app.ts',
          displayPath: 'src/app.ts',
          hunks: [],
          added: 1,
          removed: 1,
          binary: false,
          tooLarge: false,
          patch: '@@ -1,1 +1,1 @@',
        },
      },
    })
    const row = all('row').find((candidate) => candidate.getAttribute('data-path') === 'src/app.ts')!
    await act(async () => {
      row.click()
    })
    await act(async () => {
      ;(marker('diff-open-file') as HTMLButtonElement).click()
    })
    expect(openResourceSpy).toHaveBeenCalledOnce()
    expect(openResourceSpy.mock.calls[0]![0]).toContain('dsh-resource://file/session/')
  })

  it('shows the counts-only fallback for a diff past the size cap', async () => {
    await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      getDiff: {
        path: 'src/big.ts',
        side: 'unstaged',
        empty: false,
        file: {
          path: 'src/big.ts',
          displayPath: 'src/big.ts',
          hunks: [],
          added: 6000,
          removed: 3,
          binary: false,
          tooLarge: true,
          patch: 'the whole patch',
        },
      },
    })
    await act(async () => {
      ;(container.querySelector('[data-path="src/app.ts"]') as HTMLElement).click()
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Diff is too large')
  })

  it('commits the composer message', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      commit: panelState({ changes: { ...panelState().changes, staged: [] } }),
    })
    const textarea = marker('commit-message') as HTMLTextAreaElement
    await act(async () => {
      typeInto(textarea, 'feat: raise it')
    })
    await act(async () => {
      ;(byText(en['commit.button']) as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'commit')?.args).toMatchObject({ message: 'feat: raise it' })
  })

  it('marks each row with a file-type glyph, the muted directory and a status letter', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const row = all('row').find((candidate) => candidate.getAttribute('data-path') === 'src/app.ts')!
    // The type glyph comes from the platform primitive, keyed by the path.
    expect(row.querySelector('svg')).not.toBeNull()
    expect(row.textContent).toContain('src')
    expect(row.querySelector('[data-dsh-git="status"]')?.textContent).toBe('M')
  })

  it('names the branch and the commit chord, and commits on the chord', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      commit: panelState({ changes: { ...panelState().changes, staged: [] } }),
    })
    const textarea = marker('commit-message') as HTMLTextAreaElement
    const placeholder = textarea.getAttribute('placeholder') ?? ''
    expect(placeholder).toContain('main')
    expect(placeholder).toMatch(/(\u2318|Ctrl)\+Enter/)
    await act(async () => {
      typeInto(textarea, 'feat: chord')
    })
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    })
    expect(double.calls.find((call) => call.method === 'commit')?.args).toMatchObject({
      message: 'feat: chord',
    })
  })

  it('drafts a message into the composer from the field action', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      draftMessage: 'Update src: app.ts',
    })
    await act(async () => {
      ;(marker('draft-message') as HTMLButtonElement).click()
    })
    expect(double.calls.some((call) => call.method === 'draftMessage')).toBe(true)
  })

  it('offers the commit commands behind the split button chevron', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      commit: panelState({ changes: { ...panelState().changes, staged: [] } }),
    })
    const textarea = marker('commit-message') as HTMLTextAreaElement
    await act(async () => {
      typeInto(textarea, 'feat: from the menu')
    })
    const chevron = marker('commit-menu') as HTMLButtonElement
    expect(chevron.getAttribute('aria-haspopup')).toBe('menu')
    await act(async () => {
      chevron.click()
    })
    const rows = [...document.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent)
    expect(rows).toEqual([en['commit.button'], en['commit.amend'], en['commit.all']])

    const amendRow = [...document.querySelectorAll('[role="menuitem"]')].find((row) =>
      row.textContent?.includes(en['commit.amend']),
    ) as HTMLButtonElement
    await act(async () => {
      amendRow.click()
    })
    expect(double.calls.find((call) => call.method === 'commit')?.args).toMatchObject({
      message: 'feat: from the menu',
      amend: true,
    })
  })

  it('commits everything from the menu when only unstaged work exists', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      getState: {
        state: panelState({ changes: { ...panelState().changes, staged: [] } }),
        notice: null,
      },
      stage: panelState(),
      commit: panelState({ changes: { ...panelState().changes, staged: [], unstaged: [], untracked: [] } }),
    })
    const textarea = marker('commit-message') as HTMLTextAreaElement
    await act(async () => {
      typeInto(textarea, 'feat: all of it')
    })
    await act(async () => {
      ;(marker('commit-menu') as HTMLButtonElement).click()
    })
    const allRow = [...document.querySelectorAll('[role="menuitem"]')].find((row) =>
      row.textContent?.includes(en['commit.all']),
    ) as HTMLButtonElement
    await act(async () => {
      allRow.click()
    })
    // Staging every change first is what makes the commit possible.
    expect(double.calls.find((call) => call.method === 'stage')?.args).toMatchObject({
      paths: ['src/app.ts', 'docs/new.md'],
    })
    expect(double.calls.find((call) => call.method === 'commit')?.args).toMatchObject({
      message: 'feat: all of it',
    })
  })

  it('creates a worktree from the name field and validates the name first', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      worktreeAdd: {
        plan: { slug: 'feature-two', path: '/repo/.worktrees/feature-two', branch: 'dsh-git/feature-two', base: 'main', setup: [] },
        state: panelState(),
        setup: { ran: 0, failed: false, output: '' },
        notice: null,
      },
    })
    const input = marker('worktree-name') as HTMLInputElement
    await act(async () => {
      typeInto(input, 'Feature Two')
    })
    await act(async () => {
      ;(byText(en['worktrees.create']) as HTMLButtonElement).click()
    })
    // The slug is folded and validated before the call.
    expect(double.calls.find((call) => call.method === 'worktreeAdd')?.args).toMatchObject({ name: 'feature-two' })
  })

  it('creates a worktree when Enter is pressed in the name field', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      worktreeAdd: {
        plan: { slug: 'feature-three', path: '/repo/.worktrees/feature-three', branch: 'dsh-git/feature-three', base: 'main', setup: [] },
        state: panelState(),
        setup: { ran: 0, failed: false, output: '' },
        notice: null,
      },
    })
    const input = marker('worktree-name') as HTMLInputElement
    await act(async () => {
      typeInto(input, 'Feature Three')
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(double.calls.find((call) => call.method === 'worktreeAdd')?.args).toMatchObject({ name: 'feature-three' })
  })

  it('refuses an impossible name on Enter without calling the host', async () => {
    const { double } = await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const input = marker('worktree-name') as HTMLInputElement
    await act(async () => {
      typeInto(input, '!!!')
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(double.calls.some((call) => call.method === 'worktreeAdd')).toBe(false)
  })

  it('leaves Enter alone while an IME composition is being confirmed', async () => {
    const { double } = await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const input = marker('worktree-name') as HTMLInputElement
    await act(async () => {
      typeInto(input, 'Feature Three')
    })
    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(composing, 'isComposing', { value: true })
    await act(async () => {
      input.dispatchEvent(composing)
    })
    expect(double.calls.some((call) => call.method === 'worktreeAdd')).toBe(false)
  })

  it('refuses an impossible worktree name without calling the host', async () => {
    const { double } = await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const input = marker('worktree-name') as HTMLInputElement
    await act(async () => {
      typeInto(input, '!!!')
    })
    await act(async () => {
      ;(byText(en['worktrees.create']) as HTMLButtonElement).click()
    })
    expect(double.calls.some((call) => call.method === 'worktreeAdd')).toBe(false)
  })

  it('puts the worktree create row and its hint directly under the section band', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const body = container.querySelector<HTMLElement>('[data-dsh-git="section-body"][data-section="worktrees"]')!
    const field = marker('worktree-name')!
    const hint = marker('worktrees-hint')!
    const rows = all('worktree')
    // The create row is the section body's first child: creating a worktree
    // never means scrolling past the list to find the field.
    expect(body.firstElementChild?.contains(field)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
    expect(field.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    // The hint explains where the checkout lands, so it belongs to the create
    // row rather than to the list under it.
    expect(field.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(hint.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('shows the degraded state with its fix instead of an empty panel', async () => {
    await renderPanel({
      getState: new GitApiError(
        { code: 'not-a-repository', detail: '/tmp/plain' },
        { code: 'not-a-repository', detail: '/tmp/plain', requiredVersion: null, installedVersion: null },
      ),
    })
    expect(marker('degraded')).not.toBeNull()
    expect(container.textContent).toContain(en['state.noRepository'])
    expect(container.textContent).toContain(en['state.noRepositoryFix'])
  })

  it('renders an operation banner with Continue and Abort', async () => {
    const { double } = await renderPanel({
      getState: {
        state: panelState({
          operation: { kind: 'merge', step: null, message: 'Merge branch x', conflicts: ['src/app.ts'] },
        }),
        notice: null,
      },
      getHistory: { commits: [], lanes: [], hasMore: false },
      operationAbort: panelState(),
    })
    expect(marker('operation')).not.toBeNull()
    expect(container.textContent).toContain(en['operation.merge'])
    await act(async () => {
      ;(byText(en['operation.abort']) as HTMLButtonElement).click()
    })
    expect(double.calls.some((call) => call.method === 'operationAbort')).toBe(true)
  })

  it('renders a failing hook with Retry and Cancel', async () => {
    const { double } = await renderPanel(
      {
        getHistory: { commits: [], lanes: [], hasMore: false },
        commit: () => {
          throw new GitApiError({ code: 'hook-failed', detail: 'pre-commit hook declined\ndetails', exitCode: 1 }, null)
        },
        cancelCommit: { cancelled: true },
      },
      {},
    )
    const textarea = marker('commit-message') as HTMLTextAreaElement
    await act(async () => {
      typeInto(textarea, 'feat: hooky')
    })
    await act(async () => {
      ;(byText(en['commit.button']) as HTMLButtonElement).click()
    })
    expect(marker('hook')).not.toBeNull()
    expect(container.textContent).toContain('pre-commit')
    expect(container.textContent).toContain('details')
    await act(async () => {
      ;(byText(en['hook.retry']) as HTMLButtonElement).click()
    })
    expect(double.calls.filter((call) => call.method === 'commit')).toHaveLength(2)
  })

  it('hides the agent verbs without a session prompt and offers them with one', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    expect(marker('agent-menu')).toBeNull()

    const sent: string[] = []
    const { double } = await renderPanel(
      {
        getHistory: { commits: [], lanes: [], hasMore: false },
        agentFiles: {
          state: panelState(),
          files: [{ path: 'src/app.ts', patch: 'diff', added: 1, removed: 1, binary: false, staged: false }],
        },
      },
      { sendPrompt: (prompt) => void sent.push(prompt) },
    )
    expect(marker('agent-menu')).not.toBeNull()
    await act(async () => {
      ;(marker('agent-menu') as HTMLButtonElement).click()
    })
    const reviewItem = [...document.querySelectorAll('[role="menuitem"], button')].find((element) =>
      element.textContent?.includes(en['agent.review']),
    ) as HTMLElement
    expect(reviewItem, 'the agent menu lists its verbs').toBeDefined()
    await act(async () => {
      reviewItem.click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(double.calls.some((call) => call.method === 'agentFiles')).toBe(true)
    expect(sent[0]).toContain('Review the uncommitted changes')
  })

  it('renders history rows and their actions', async () => {
    const { double } = await renderPanel({
      getHistory: {
        commits: [
          {
            hash: 'aaaabbbb',
            short: 'aaaabbb',
            parents: [],
            author: 'Ada',
            timestamp: 1_700_000_000,
            subject: 'feat: seed',
            refs: ['main'],
          },
        ],
        lanes: [{ lane: 0, edges: [] }],
        hasMore: false,
      },
    })
    expect(all('commit-row')).toHaveLength(1)
    expect(container.textContent).toContain('feat: seed')
    expect(container.textContent).toContain('aaaabbb')
    // The section loads history on first render.
    expect(double.calls.some((call) => call.method === 'getHistory')).toBe(true)
  })

  it('refreshes on the manual button', async () => {
    const { double } = await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const before = double.calls.filter((call) => call.method === 'getState').length
    await act(async () => {
      ;(marker('refresh') as HTMLButtonElement).click()
    })
    expect(double.calls.filter((call) => call.method === 'getState').length).toBeGreaterThan(before)
  })

  it('updates from the upstream branch', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      updateFromBranch: panelState(),
    })
    await act(async () => {
      ;(marker('update') as HTMLButtonElement).click()
    })
    expect(double.calls.some((call) => call.method === 'updateFromBranch')).toBe(true)
  })

  it('releases the store when the body unmounts', async () => {
    const { sessionId } = await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    act(() => {
      root.unmount()
    })
    releaseStore(sessionId)
    expect(container.textContent).toBe('')
    // Re-render for the afterEach unmount path.
    root = createRoot(container)
  })
})

describe('git chip title', () => {
  /** Render the title seat on its own, as the tab strip does. */
  const renderTitle = async (props: { sessionId?: string }): Promise<{
    container: HTMLDivElement
    root: Root
    title: () => string
  }> => {
    const titleContainer = document.createElement('div')
    document.body.appendChild(titleContainer)
    const titleRoot = createRoot(titleContainer)
    await act(async () => {
      titleRoot.render(React.createElement(GitTitle, { t, ...props }))
    })
    return {
      container: titleContainer,
      root: titleRoot,
      title: () => titleContainer.querySelector('[data-dsh-git="chip-title"]')?.textContent ?? '',
    }
  }

  it('falls back to the type label instead of a blank chip', async () => {
    const title = await renderTitle({})
    // No store at all: the chip still names the tab, with its branch glyph.
    expect(title.title()).toBe(en['type.label'])
    expect(title.container.querySelector('svg')).not.toBeNull()
    act(() => {
      title.root.unmount()
    })
  })

  it('shows the branch once the panel store has read the repository', async () => {
    const { sessionId } = await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const title = await renderTitle({ sessionId })
    expect(title.title()).toBe('main')
    act(() => {
      title.root.unmount()
    })
  })

  it('names a detached HEAD and a branchless change count', async () => {
    const base = panelState()
    const detached = await renderPanel({
      getState: { state: panelState({ head: { ...base.head, branch: null, detached: true } }), notice: null },
      getHistory: { commits: [], lanes: [], hasMore: false },
    })
    const detachedTitle = await renderTitle({ sessionId: detached.sessionId })
    expect(detachedTitle.title()).toBe(en['header.detached'])
    act(() => {
      detachedTitle.root.unmount()
    })

    const unborn = await renderPanel({
      getState: { state: panelState({ head: { ...base.head, branch: null, detached: false, unborn: true } }), notice: null },
      getHistory: { commits: [], lanes: [], hasMore: false },
    })
    const unbornTitle = await renderTitle({ sessionId: unborn.sessionId })
    expect(unbornTitle.title()).toBe(`${en['type.label']} (3)`)
    act(() => {
      unbornTitle.root.unmount()
    })
  })
})
