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
import {
  GitPanel,
  GitPanelUnavailable,
  GitTitle,
  PanelBoundary,
  PanelCrashed,
  releaseStore,
  setPanelApi,
  type GitApiLike,
  type GitTabInfo,
} from '../src/client/GitPanel.tsx'
import { en, interpolate, type MessageKey } from '../src/client/dictionaries.ts'
import type { PanelState } from '../src/core/types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
        lockedReason: null,
        prunable: false,
        detached: false,
        managed: false,
        slug: null,
        clean: true,
        ahead: 0,
        behind: 0,
        merged: false,
      },
      {
        path: '/repo/.worktrees/feature',
        head: 'bbbb',
        branch: 'dsh-git/feature',
        primary: false,
        locked: false,
        lockedReason: null,
        prunable: false,
        detached: false,
        managed: true,
        slug: 'feature',
        clean: false,
        ahead: 2,
        behind: 1,
        merged: false,
      },
    ],
    worktreeBase: { name: 'origin/main', source: 'default-branch', candidates: ['main', 'feature'] },
    branches: [
      { name: 'main', current: true, oid: 'aaaa', upstream: 'origin/main', remote: false },
      { name: 'feature', current: false, oid: 'bbbb', upstream: null, remote: false },
    ],
    tags: [],
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

/**
 * The preview a repository with no create-time work reports. The panel asks for
 * one before every create, so tests that are not about setup get this.
 */
const emptySetupPreview = {
  root: '/repo',
  slug: 'worktree',
  path: '/repo/.worktrees/worktree',
  branch: 'dsh-git/worktree',
  base: 'main',
  baseOid: '0'.repeat(40),
  version: 'setup-v0',
  steps: [],
  includePaths: [],
  notice: null,
}

/** Render the panel for one scripted API and settle the first read. */
async function renderPanel(
  script: Record<string, unknown>,
  extra: {
    sendPrompt?: (prompt: string) => void
    openWorktreeSession?: (path: string) => Promise<void>
    /** Replace the tab hook, or omit it entirely with `null`. */
    tabHook?: (() => GitTabInfo) | null
  } = {},
  /** Keep the sections in their collapsed-by-default state. */
  options: { keepCollapsed?: boolean } = {},
) {
  const double = apiDouble({
    getState: { state: panelState(), notice: null },
    worktreeSetup: emptySetupPreview,
    ...script,
  })
  setPanelApi(() => double.api)
  // One store per render: a second renderPanel in the same test must get the
  // new double, not the memoized store of the first.
  renders += 1
  const sessionId = `session-${session}-${renders}`
  await act(async () => {
    root.render(
      React.createElement(GitPanel, {
        sessionId,
        ...(extra.tabHook === null ? {} : { useTabInfo: extra.tabHook ?? useTabInfo }),
        t,
        ...(extra.sendPrompt === undefined ? {} : { agentSessions: {
          getSource: () => ({ sessionId: sessionId as SessionId, title: 'Test session', cwd: '/repo' }),
          subscribeRefresh: () => () => {},
          createDelivery: (input: { text: string }) => ({
            getSnapshot: () => ({ accepted: false, opened: false }),
            send: async () => { extra.sendPrompt!(input.text); return { accepted: true, opened: false } },
            open: () => ({ accepted: true, opened: true }),
          }),
        } }),
        ...(extra.openWorktreeSession === undefined ? {} : { openWorktreeSession: extra.openWorktreeSession }),
      }),
    )
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  // Sections ship collapsed; tests that need a section's content open it
  // through the real toggle, so the header stays exercised.
  if (!options.keepCollapsed) {
    await act(async () => {
      for (const section of ['changes', 'worktrees', 'history'] as const) {
        const toggle = container.querySelector<HTMLButtonElement>(
          `[data-dsh-git="section-toggle"][data-section="${section}"]`,
        )
        toggle?.click()
      }
      await Promise.resolve()
    })
  }
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

  it('starts with the three sections collapsed behind accordion headers', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } }, {}, { keepCollapsed: true })
    const toggles = [...container.querySelectorAll<HTMLElement>('[data-dsh-git="section-toggle"]')]
    expect(toggles.map((toggle) => toggle.getAttribute('data-section'))).toEqual([
      'changes',
      'worktrees',
      'history',
    ])
    for (const toggle of toggles) {
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
    }
    // Only the headers render; no section body, rows, or commit rows yet.
    expect(all('section-body')).toHaveLength(0)
    expect(all('row')).toHaveLength(0)
    expect(marker('commit-row')).toBeNull()
  })

  it('expands one section without opening the others, and collapses it back', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } }, {}, { keepCollapsed: true })
    const worktrees = container.querySelector<HTMLElement>('[data-dsh-git="section-toggle"][data-section="worktrees"]')!
    await act(async () => {
      worktrees.click()
    })
    expect(worktrees.getAttribute('aria-expanded')).toBe('true')
    // The worktree rows are there while the change rows stay hidden.
    expect(container.querySelectorAll('[data-dsh-git="worktree"]').length).toBeGreaterThan(0)
    expect(all('row').some((row) => row.getAttribute('data-path') === 'src/app.ts')).toBe(false)
    await act(async () => {
      worktrees.click()
    })
    expect(worktrees.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-dsh-git="worktree"]')).toHaveLength(0)
    expect(container.querySelector('[data-dsh-git="section-body"][data-section="worktrees"]')).toBeNull()
  })

  it('expands the changes section with its rows and empty state', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } }, {}, { keepCollapsed: true })
    const changes = container.querySelector<HTMLElement>('[data-dsh-git="section-toggle"][data-section="changes"]')!
    await act(async () => {
      changes.click()
    })
    expect(all('row').filter((row) => row.getAttribute('data-path') !== null).length).toBeGreaterThan(0)
    // History and worktrees are untouched.
    expect(container.querySelectorAll('[data-dsh-git="commit-row"]').length).toBe(0)
    expect(container.querySelector('[data-dsh-git="history"]')).not.toBeNull()
    expect(container.querySelector('[data-dsh-git="section-body"][data-section="history"]')).toBeNull()
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
      button.textContent === en['changes.discard'],
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
      button.textContent === en['changes.discard'],
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

  it('asks for a destination before AI drafting from the field action', async () => {
    const sent = vi.fn()
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      agentFiles: { state: panelState(), files: [] },
    }, { sendPrompt: sent })
    await act(async () => {
      ;(marker('draft-message') as HTMLButtonElement).click()
    })
    expect(document.querySelector('[data-dsh-git="agent-dialog"]')).not.toBeNull()
    expect(double.calls.some((call) => call.method === 'draftMessage')).toBe(false)
    expect(double.calls.find((call) => call.method === 'agentFiles')?.args).toMatchObject({ verb: 'draft', side: 'staged' })
    expect(sent).not.toHaveBeenCalled()
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
      commitAll: panelState({ changes: { ...panelState().changes, staged: [], unstaged: [], untracked: [] } }),
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
    // The host owns staging and commit as one guarded operation.
    expect(double.calls.find((call) => call.method === 'commitAll')?.args).toMatchObject({
      paths: ['src/app.ts', 'docs/new.md'], message: 'feat: all of it',
    })
    expect(double.calls.some((call) => call.method === 'stage' || call.method === 'commit')).toBe(false)
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

  it('asks for the declared setup and runs only what the dialog is told to', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      worktreeSetup: {
        ...emptySetupPreview,
        slug: 'setup-one',
        path: '/repo/.worktrees/setup-one',
        version: 'setup-v1',
        steps: [{ kind: 'command', command: 'pnpm install' }],
        includePaths: ['.env'],
      },
      worktreeAdd: {
        plan: { slug: 'setup-one', path: '/repo/.worktrees/setup-one', branch: 'dsh-git/setup-one', base: 'main', setup: [{ kind: 'command', command: 'pnpm install' }] },
        state: panelState(),
        setup: { ran: 1, failed: false, output: 'ok' },
        copied: ['.env'],
        notice: null,
      },
    })
    const input = marker('worktree-name') as HTMLInputElement
    await act(async () => {
      typeInto(input, 'Setup One')
    })
    await act(async () => {
      ;(byText(en['worktrees.create']) as HTMLButtonElement).click()
    })
    // The declaration is shown for an explicit decision; nothing is created yet.
    const dialog = document.querySelector('[data-dsh-git="worktree-setup"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('pnpm install')
    expect(dialog?.textContent).toContain('.env')
    expect(double.calls.some((call) => call.method === 'worktreeAdd')).toBe(false)

    const checkboxes = [...document.querySelectorAll<HTMLInputElement>('[data-dsh-git="worktree-setup"] input[type="checkbox"]')]
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes.every((box) => !box.checked)).toBe(true)
    await act(async () => {
      checkboxes[0]!.click()
    })
    const confirm = [...document.querySelectorAll('button')]
      .find((button) => button.textContent === en['worktrees.setupConfirm']) as HTMLButtonElement
    await act(async () => {
      confirm.click()
    })
    const args = double.calls.find((call) => call.method === 'worktreeAdd')?.args
    expect(args).toMatchObject({
      name: 'setup-one',
      setupApproved: true,
      expectedSetupVersion: 'setup-v1',
    })
    // The unchecked copy consent never reaches the host as an approval.
    expect(args?.copyApproved).toBeUndefined()
  })

  it('creates without any approval when the dialog is confirmed untouched', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      worktreeSetup: {
        ...emptySetupPreview,
        slug: 'copy-one',
        version: 'setup-v2',
        includePaths: ['.env'],
      },
      worktreeAdd: {
        plan: { slug: 'copy-one', path: '/repo/.worktrees/copy-one', branch: 'dsh-git/copy-one', base: 'main', setup: [] },
        state: panelState(),
        setup: { ran: 0, failed: false, output: '' },
        copied: [],
        notice: 'setup-skipped',
      },
    })
    const input = marker('worktree-name') as HTMLInputElement
    await act(async () => {
      typeInto(input, 'Copy One')
    })
    await act(async () => {
      ;(byText(en['worktrees.create']) as HTMLButtonElement).click()
    })
    const confirm = [...document.querySelectorAll('button')]
      .find((button) => button.textContent === en['worktrees.setupConfirm']) as HTMLButtonElement
    await act(async () => {
      confirm.click()
    })
    const args = double.calls.find((call) => call.method === 'worktreeAdd')?.args
    expect(args).toMatchObject({ name: 'copy-one', expectedSetupVersion: 'setup-v2' })
    expect(args?.setupApproved).toBeUndefined()
    expect(args?.copyApproved).toBeUndefined()
    // The host's skip notice is translated, never rendered as a raw code.
    expect(container.textContent).toContain(en['notice.setupSkipped'])
  })

  it('merges only after the host preflight allows it', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      preflight: { verdict: 'allow' },
      worktreeMerge: panelState(),
    })
    const merge = byText(en['worktrees.merge'].replace('{branch}', 'main')) as HTMLButtonElement
    await act(async () => {
      merge.click()
    })
    expect(double.calls.find((call) => call.method === 'preflight')?.args).toMatchObject({
      action: 'merge',
      target: '/repo/.worktrees/feature',
    })
    expect(double.calls.some((call) => call.method === 'worktreeMerge')).toBe(true)
  })

  it('shows a blocked merge as the named failure without calling git', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      preflight: { verdict: 'block', code: 'dirty-tree', paths: ['src/app.ts'], detail: 'merge' },
    })
    const merge = byText(en['worktrees.merge'].replace('{branch}', 'main')) as HTMLButtonElement
    await act(async () => {
      merge.click()
    })
    expect(double.calls.some((call) => call.method === 'worktreeMerge')).toBe(false)
    expect(container.textContent).toContain(en['failure.dirtyTree'])
    expect(container.textContent).toContain(en['failure.fix.dirtyTree'])
  })

  it('skips a stopped step only after a confirmation', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      getState: {
        state: panelState({
          operation: { kind: 'rebase', step: '2/5', message: null, conflicts: [] },
        }),
        notice: null,
      },
      operationSkip: panelState({ operation: { kind: null, step: null, message: null, conflicts: [] } }),
    })
    const skip = marker('operation-skip') as HTMLButtonElement
    expect(skip).not.toBeNull()
    await act(async () => {
      skip.click()
    })
    // The button opens the confirmation; the step is not skipped yet.
    expect(double.calls.some((call) => call.method === 'operationSkip')).toBe(false)
    const proceed = document.querySelector<HTMLButtonElement>('[data-dsh-git="confirm-proceed"]')
    expect(proceed).not.toBeNull()
    await act(async () => {
      proceed!.click()
    })
    expect(double.calls.find((call) => call.method === 'operationSkip')?.args).toMatchObject({ approved: true })
  })

  it('offers no skip while a merge is in progress', async () => {
    await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      getState: {
        state: panelState({
          operation: { kind: 'merge', step: null, message: null, conflicts: [] },
        }),
        notice: null,
      },
    })
    expect(marker('operation-skip')).toBeNull()
    expect(marker('operation')).not.toBeNull()
  })

  it('cancelling the setup dialog creates nothing', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      worktreeSetup: {
        ...emptySetupPreview,
        slug: 'cancel-one',
        version: 'setup-v3',
        steps: [{ kind: 'command', command: 'pnpm install' }],
      },
    })
    const input = marker('worktree-name') as HTMLInputElement
    await act(async () => {
      typeInto(input, 'Cancel One')
    })
    await act(async () => {
      ;(byText(en['worktrees.create']) as HTMLButtonElement).click()
    })
    const cancel = [...document.querySelectorAll('button')]
      .find((button) => button.textContent === en['confirm.cancel']) as HTMLButtonElement
    await act(async () => {
      cancel.click()
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
    expect((byText(en['operation.continue']) as HTMLButtonElement).disabled).toBe(true)
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
    expect(sent).toEqual([])
    const current = document.querySelector<HTMLInputElement>('input[name="git-agent-target"][value="current"]')!
    await act(async () => { current.click() })
    const start = [...document.querySelectorAll('button')].find((button) => button.textContent === en['agent.start'])!
    await act(async () => { start.click() })
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

  it('moves off the type label when the body registers the store later', async () => {
    // The strip paints before the body, so the chip starts without a store.
    const title = await renderTitle({ sessionId: 'late-store' })
    expect(title.title()).toBe(en['type.label'])
    setPanelApi(() =>
      apiDouble({
        getState: { state: panelState(), notice: null },
        getHistory: { commits: [], lanes: [], hasMore: false },
      }).api,
    )
    await act(async () => {
      root.render(React.createElement(GitPanel, { sessionId: 'late-store', useTabInfo, t }))
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    // The body's registry announcement reaches the chip without another render.
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

describe('worktrees section', () => {
  const readState = { getHistory: { commits: [], lanes: [], hasMore: false } }

  it('names each row by its branch and measures it against the base', async () => {
    await renderPanel(readState)
    const rows = all('worktree')
    expect(rows[0]?.textContent).toContain('main')
    expect(rows[1]?.textContent).toContain('dsh-git/feature')
    const meta = rows[1]?.querySelector('[data-dsh-git="worktree-meta"]')?.textContent ?? ''
    expect(meta).toContain('2 ahead')
    expect(meta).toContain('1 behind')
    expect(marker('worktree-base')?.textContent).toContain('origin/main')
  })

  it('merges only a row whose branch differs from the checkout', async () => {
    const base = panelState()
    await renderPanel({
      ...readState,
      getState: {
        state: panelState({
          worktrees: [
            base.worktrees[0]!,
            { ...base.worktrees[1]!, branch: 'main', slug: 'on-main' },
          ],
        }),
        notice: null,
      },
    })
    expect(byText(en['worktrees.merge'].replace('{branch}', 'main'))).toBeUndefined()
  })

  it('switches the comparison base through the base menu', async () => {
    const { double } = await renderPanel(readState)
    await act(async () => {
      ;(marker('worktree-base') as HTMLButtonElement).click()
    })
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent === 'feature')
    expect(item).toBeDefined()
    await act(async () => {
      ;(item as HTMLButtonElement).click()
    })
    const reads = double.calls.filter((call) => call.method === 'getState')
    expect(reads.at(-1)?.args).toMatchObject({ base: 'feature' })
  })

  it('creates from a ref picked in the source menu', async () => {
    const { double } = await renderPanel({
      ...readState,
      worktreeAdd: {
        plan: { slug: 'feature', path: '/repo/.worktrees/feature', branch: 'feature', base: 'feature', setup: [] },
        state: panelState(),
        setup: { ran: 0, failed: false, output: '' },
        notice: null,
      },
    })
    await act(async () => {
      ;(marker('worktree-source') as HTMLButtonElement).click()
    })
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent === 'feature')
    await act(async () => {
      ;(item as HTMLButtonElement).click()
    })
    expect((marker('worktree-name') as HTMLInputElement).value).toBe('feature')
    await act(async () => {
      ;(byText(en['worktrees.create']) as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'worktreeAdd')?.args).toMatchObject({
      mode: 'ref',
      ref: 'feature',
      refKind: 'branch',
    })
  })

  it('offers prune for a missing folder and unlock for a locked worktree', async () => {
    const base = panelState()
    const locked = panelState({
      worktrees: [
        base.worktrees[0]!,
        { ...base.worktrees[1]!, locked: true, lockedReason: 'manual', prunable: true },
      ],
    })
    const { double } = await renderPanel({
      ...readState,
      getState: { state: locked, notice: null },
      worktreePrune: locked,
      worktreeUnlock: locked,
    })
    const meta = all('worktree')[1]?.querySelector('[data-dsh-git="worktree-meta"]')?.textContent ?? ''
    expect(meta).toContain('manual')
    expect(meta).toContain(en['worktrees.prunable'])
    await act(async () => {
      ;(byText(en['worktrees.unlock']) as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'worktreeUnlock')?.args).toMatchObject({
      path: '/repo/.worktrees/feature',
    })
    await act(async () => {
      ;(byText(en['worktrees.prune']) as HTMLButtonElement).click()
    })
    expect(double.calls.some((call) => call.method === 'worktreePrune')).toBe(true)
  })

  it('opens a session in the row folder and names a failure', async () => {
    const opened: string[] = []
    await renderPanel(readState, {
      openWorktreeSession: async (path) => {
        opened.push(path)
      },
    })
    await act(async () => {
      ;(marker('worktree-open-session') as HTMLButtonElement).click()
    })
    expect(opened).toEqual(['/repo/.worktrees/feature'])

    await renderPanel(readState, {
      openWorktreeSession: async () => {
        throw new Error('no workspace navigation')
      },
    })
    await act(async () => {
      ;(marker('worktree-open-session') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain(en['worktrees.openFailed'])
  })
})

/**
 * Resilience: a blank Source control pane is the bug being pinned here.
 *
 * The slot runtime retires a registration whose render throws, and a seat that
 * renders nothing is an empty pane, so both failure paths have to stay inside
 * this plugin and say what happened.
 */
describe('panel resilience', () => {
  /** A failing read: the state never settles, so the panel stays loading. */
  const stalled = (): Promise<unknown> => new Promise(() => {})

  /** One non-empty diff over the row the fixtures stage. */
  const diffScript = {
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
  }

  beforeEach(() => {
    // React logs the contained error; the assertions are the point.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function openDiff(): Promise<void> {
    const row = all('row').find((candidate) => candidate.getAttribute('data-path') === 'src/app.ts')!
    await act(async () => {
      row.click()
    })
  }

  it('shows the read in flight instead of an empty body', async () => {
    await renderPanel({ getState: stalled })
    expect(marker('panel')).not.toBeNull()
    expect(marker('body')).not.toBeNull()
    expect(marker('loading')?.textContent).toContain(en['state.loading'])
  })

  it('renders the panel when the seat hands no tab hook', async () => {
    await renderPanel(diffScript, { tabHook: null })
    expect(marker('panel')).not.toBeNull()
    await openDiff()
    expect(marker('diff')).not.toBeNull()
    // Everything but the hand-off to the stock viewer survives.
    expect(marker('diff-open-file')).toBeNull()
    expect(marker('diff-back')).not.toBeNull()
  })

  it('loses only the open-file button when the tab hook throws', async () => {
    const throwing = (): GitTabInfo => {
      throw new Error('sidebarRight: tab "t1" is not committed in session "s1"')
    }
    await renderPanel(diffScript, { tabHook: throwing })
    await openDiff()
    // The throw is contained: the panel, the header and the diff all survive.
    expect(marker('panel')).not.toBeNull()
    expect(marker('diff')).not.toBeNull()
    expect(marker('diff-open-file')).toBeNull()
  })

  it('contains a crash, names it, and retries on demand', async () => {
    function Boom(): React.ReactElement {
      throw new Error('kaboom')
    }
    const retries: number[] = []
    function Harness({ attempt }: { attempt: number }): React.ReactElement {
      return (
        <PanelBoundary
          resetKey={attempt}
          renderFallback={(error) => (
            <PanelCrashed t={t} error={error} onRetry={() => retries.push(attempt)} />
          )}
        >
          {attempt === 0 ? <Boom /> : <p data-dsh-git="recovered">ok</p>}
        </PanelBoundary>
      )
    }
    await act(async () => {
      root.render(<Harness attempt={0} />)
    })
    expect(marker('crashed')?.textContent).toContain(en['state.renderFailed'])
    expect(container.textContent).toContain('kaboom')
    await act(async () => {
      ;(byText(en['state.retry']) as HTMLButtonElement).click()
    })
    expect(retries).toEqual([0])
    // A changed reset key clears the caught error and re-renders the subtree.
    await act(async () => {
      root.render(<Harness attempt={1} />)
    })
    expect(marker('recovered')).not.toBeNull()
    expect(marker('crashed')).toBeNull()
  })

  it('names the no-session state instead of rendering nothing', async () => {
    await act(async () => {
      root.render(<GitPanelUnavailable t={t} />)
    })
    expect(marker('panel')).not.toBeNull()
    expect(marker('no-session')?.textContent).toContain(en['state.noSession'])
  })
})

