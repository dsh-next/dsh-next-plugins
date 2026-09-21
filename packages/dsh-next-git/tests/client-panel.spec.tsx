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
      { name: 'main', current: true, oid: 'aaaa', upstream: 'origin/main', remote: false, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'tip' },
      { name: 'feature', current: false, oid: 'bbbb', upstream: null, remote: false, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'tip' },
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
    registerCreatedWorktree?: (path: string) => Promise<void>
    unregisterDeletedWorktree?: (path: string) => Promise<void>
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
        ...(extra.registerCreatedWorktree === undefined ? {} : { registerCreatedWorktree: extra.registerCreatedWorktree }),
        ...(extra.unregisterDeletedWorktree === undefined ? {} : { unregisterDeletedWorktree: extra.unregisterDeletedWorktree }),
      }),
    )
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  // Sections ship collapsed; tests that need a section's content open it
  // through the real toggle, so the header stays exercised.
  if (!options.keepCollapsed) await openSection('changes')
  return { double, sessionId }
}

async function openSection(section: 'changes' | 'worktrees' | 'history'): Promise<void> {
  await act(async () => {
    const toggle = container.querySelector<HTMLButtonElement>(`[data-dsh-git="section-toggle"][data-section="${section}"]`)
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
    await Promise.resolve()
  })
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
/** Without a tab host, clicking a file retains the in-panel diff fallback. */
const pathRow = (path: string): HTMLElement => all('row').find((row) => row.getAttribute('data-path') === path)!
const clickFile = async (row: HTMLElement): Promise<void> => {
  await act(async () => {
    row.click()
  })
}
/** Dialogs portal onto the document body, so their markers live outside the panel. */
const dialog = (name: string): HTMLElement | null => document.querySelector(`[data-dsh-git="${name}"]`)
const all = (name: string): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(`[data-dsh-git="${name}"]`)]
const byText = (text: string, tag = 'button'): HTMLElement | undefined =>
  [...container.querySelectorAll(tag)].find((element) => element.textContent?.includes(text)) as HTMLElement | undefined

describe('git panel body', () => {
  it('omits the redundant Review hunks action from change rows', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    expect(all('row').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-dsh-git="row-hunks"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Review hunks"]')).toBeNull()
  })
  it('opens Sync from the shortcut before the branch selector without executing it', async () => {
    const { double } = await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const sync = marker('sync') as HTMLButtonElement
    expect(sync.getAttribute('aria-label')).toBe('Sync')
    expect(sync.disabled).toBe(false)
    expect(sync.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(sync.querySelector('path')?.getAttribute('d')).not.toBe(marker('refresh')?.querySelector('path')?.getAttribute('d'))
    expect(sync.compareDocumentPosition(marker('branch-button')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await act(async () => sync.click())
    expect(document.querySelector('[data-dsh-git="repository-command"]')?.getAttribute('data-command')).toBe('sync')
    expect(double.calls.some(call => call.method === 'executeRepositoryCommand')).toBe(false)
  })
  it('ends the header row with the repository actions menu', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } }, { sendPrompt: () => {} })
    const order = ['new-worktree', 'agent-menu', 'refresh', 'repository-menu']
      .map((name) => marker(name))
    expect(order.every((node) => node !== null)).toBe(true)
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // Nothing trails the three dots: they are the row's last control.
    expect(order.at(-1)!.nextElementSibling).toBeNull()
  })
  it('disables Sync when the repository is unavailable', async () => {
    await renderPanel({ getState: new GitApiError({ code: 'not-a-repository', detail: '' }, null) })
    expect((marker('sync') as HTMLButtonElement).disabled).toBe(true)
  })
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
    expect(container.textContent).toContain('3 ignored')
    await openSection('worktrees')
    expect(container.textContent).toContain('feature')
    expect(container.querySelector('[data-dsh-git="section-body"][data-section="changes"]')).toBeNull()
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

  it.each(['changes', 'worktrees', 'history'])('toggles %s from header whitespace and title without double toggles', async section => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } }, {}, { keepCollapsed: true })
    const toggle = container.querySelector<HTMLButtonElement>(`[data-dsh-git="section-toggle"][data-section="${section}"]`)!
    const header = toggle.parentElement!
    await act(async () => header.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await act(async () => (toggle.nextElementSibling as HTMLElement).click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => toggle.querySelector('span')!.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const count = header.querySelector<HTMLElement>('[data-dsh-git="section-count"]')
    if (count) {
      await act(async () => count.click())
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
    }
  })

  it('keeps header actions independent from accordion toggling', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      stage: panelState(),
    }, {}, { keepCollapsed: true })
    await act(async () => (marker('stage-all') as HTMLButtonElement).click())
    expect(double.calls.some(call => call.method === 'stage')).toBe(true)
    await act(async () => (marker('history-refresh') as HTMLButtonElement).click())
    expect(double.calls.some(call => call.method === 'getHistory')).toBe(true)
    for (const toggle of container.querySelectorAll('[data-dsh-git="section-toggle"]')) {
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
    }
  })

  it('closes the previous accordion when another header is expanded', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    for (const section of ['worktrees', 'history', 'changes'] as const) {
      const toggle = container.querySelector<HTMLButtonElement>(`[data-dsh-git="section-toggle"][data-section="${section}"]`)!
      await act(async () => toggle.parentElement!.click())
      expect(all('section-body').map(body => body.dataset.section)).toEqual([section])
      expect(container.querySelectorAll('[data-dsh-git="section-toggle"][aria-expanded="true"]')).toHaveLength(1)
    }
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
    const discardButton = row.querySelector('button[aria-label="' + en['changes.discard'] + '"]') as HTMLButtonElement
    await act(async () => {
      discardButton.click()
    })
    // The danger dialog names the file count before anything is written.
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('1 file')
    expect(double.calls.some((call) => call.method === 'discard')).toBe(false)
    const confirmButton = document.querySelector('[data-dsh-git="confirm-proceed"]') as HTMLButtonElement
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
    }, { tabHook: null })
    await clickFile(pathRow('src/app.ts'))
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

  it('opens the change-view tab for a row, and falls back to the panel without one', async () => {
    const first = await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    openResourceSpy.mockClear()
    await act(async () => {
      pathRow('src/app.ts').click()
    })
    expect(openResourceSpy).toHaveBeenCalledWith(
      `dsh-resource://git-changes/session/${first.sessionId}/unstaged/src/app.ts`,
    )
    // The tab is the row's normal outcome, so the panel keeps its sections.
    expect(marker('diff')).toBeNull()

    // A host whose tab hook is absent (or not committed yet) keeps the diff in
    // the panel instead of doing nothing with the click.
    await renderPanel(
      { getHistory: { commits: [], lanes: [], hasMore: false }, getDiff: { path: 'src/app.ts', side: 'unstaged', empty: false, file: null } },
      { tabHook: null },
    )
    await act(async () => {
      pathRow('src/app.ts').click()
    })
    await act(async () => { await Promise.resolve() })
    expect(marker('diff')).not.toBeNull()
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
    }, {
      // A host that claims no change-file address keeps the click useful with
      // the in-panel diff, whose own open action still goes through the tab.
      tabHook: () => ({
        tab: {
          title: '',
          actions: {
            openResource: (address: string) => {
              if (address.startsWith('dsh-resource://git-changes/')) throw new Error('no such viewer')
              openResourceSpy(address)
            },
          },
        },
      }),
    })
    const row = pathRow('src/app.ts')
    await clickFile(row)
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
    }, { tabHook: null })
    await clickFile(pathRow('src/app.ts'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Diff is too large')
  })

  it('commits the dialog message and closes on success', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      commit: panelState({ changes: { ...panelState().changes, staged: [] } }),
    })
    expect(dialog('commit-dialog')).toBeNull()
    await act(async () => {
      ;(marker('commit-open') as HTMLButtonElement).click()
    })
    expect(dialog('commit-dialog')).not.toBeNull()
    await act(async () => {
      typeInto(dialog('commit-message') as HTMLTextAreaElement, 'feat: raise it')
    })
    await act(async () => {
      ;(dialog('commit-submit') as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'commit')?.args).toMatchObject({ message: 'feat: raise it' })
    expect(dialog('commit-dialog')).toBeNull()
  })

  it('uses one multiline message field and preserves the summary and body', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      commit: panelState({ changes: { ...panelState().changes, staged: [] } }),
    })
    await act(async () => {
      ;(marker('commit-open') as HTMLButtonElement).click()
    })
    expect(dialog('commit-dialog')!.querySelectorAll('textarea')).toHaveLength(1)
    expect(dialog('commit-dialog')!.querySelectorAll('input')).toHaveLength(0)
    expect(dialog('commit-dialog')!.textContent).not.toContain(en['commit.description'])
    await act(async () => {
      typeInto(dialog('commit-message') as HTMLTextAreaElement, 'feat: subject\n\nbody line')
    })
    await act(async () => {
      ;(dialog('commit-submit') as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'commit')?.args).toMatchObject({
      message: 'feat: subject\n\nbody line',
    })
  })

  it('keeps the dialog open and the message intact when the commit fails', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      commit: new GitApiError({ code: 'identity-missing', detail: 'no identity' }, null),
    })
    await act(async () => {
      ;(marker('commit-open') as HTMLButtonElement).click()
    })
    await act(async () => {
      typeInto(dialog('commit-message') as HTMLTextAreaElement, 'feat: kept')
    })
    await act(async () => {
      ;(dialog('commit-submit') as HTMLButtonElement).click()
    })
    expect(dialog('commit-dialog')).not.toBeNull()
    expect((dialog('commit-message') as HTMLTextAreaElement).value).toBe('feat: kept')
    expect(double.calls.some((call) => call.method === 'refreshHistory')).toBe(false)
  })

  it('keeps the chord, and refuses an empty summary', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      commit: panelState({ changes: { ...panelState().changes, staged: [] } }),
    })
    await act(async () => {
      ;(marker('commit-open') as HTMLButtonElement).click()
    })
    expect((dialog('commit-submit') as HTMLButtonElement).disabled).toBe(true)
    const summary = dialog('commit-message') as HTMLTextAreaElement
    await act(async () => { typeInto(summary, '\n\nBody without a subject') })
    expect((dialog('commit-submit') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(double.calls.some(call => call.method === 'commit')).toBe(false)
    await act(async () => {
      typeInto(summary, 'feat: chord')
    })
    await act(async () => {
      summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    })
    expect(double.calls.find((call) => call.method === 'commit')?.args).toMatchObject({ message: 'feat: chord' })
  })

  // The platform has no minus icon, so the unstage pair uses the plus's own
  // crossbar geometry; both unstage actions must render that one glyph.
  it('marks both unstage actions with the minus glyph', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      unstage: panelState({ changes: { ...panelState().changes, staged: [] } }),
    })
    await openSection('changes')
    const minus = 'M1.5 7.34961H14.5V8.65039H1.5V7.34961Z'
    const header = marker('unstage-all')!
    const row = container.querySelector<HTMLButtonElement>(`button[aria-label="${en['changes.unstage']}"]`)!
    for (const button of [header, row]) {
      const paths = button.querySelectorAll('path')
      expect(paths).toHaveLength(1)
      expect(paths[0]!.getAttribute('d')).toBe(minus)
      expect(button.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16')
    }
    await act(async () => {
      ;(row as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'unstage')?.args).toMatchObject({ paths: ['src/staged.ts'] })
  })

  it('keeps both writes in the Changes header beside the staging actions', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    await openSection('changes')
    const header = container.querySelector('[data-dsh-git="changes"] [data-dsh-git="section-toggle"]')!.parentElement!
    const commit = marker('commit-open') as HTMLButtonElement
    const stash = marker('stash-open') as HTMLButtonElement
    const stageAll = marker('stage-all') as HTMLButtonElement
    expect(header.contains(commit)).toBe(true)
    expect(header.contains(stash)).toBe(true)
    // Order: Commit, Stash, then the header's own stage-all action.
    expect(commit.compareDocumentPosition(stash) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(stash.compareDocumentPosition(stageAll) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('disables both writes without staged work, and offers them with it', async () => {
    await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      getState: { state: panelState({ changes: { ...panelState().changes, staged: [] } }), notice: null },
    })
    expect((marker('commit-open') as HTMLButtonElement).disabled).toBe(true)
    expect((marker('stash-open') as HTMLButtonElement).disabled).toBe(true)
    // The reason rides the disabled tooltip instead of a second row.
    expect((marker('commit-open') as HTMLButtonElement).title).toBe(en['commit.nothingStagedButChanges'])
    expect((marker('stash-open') as HTMLButtonElement).title).toBe(en['commit.nothingStagedButChanges'])

    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    expect((marker('commit-open') as HTMLButtonElement).disabled).toBe(false)
    expect((marker('stash-open') as HTMLButtonElement).disabled).toBe(false)
    expect((marker('commit-open') as HTMLButtonElement).title).toBe(en['commit.button'])
  })

  it('saves a named stash after the host preview, then refreshes', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      previewRepositoryAction: { request: { action: 'stash-save', includeUntracked: false, message: 'wip: panel' }, version: 'v1' },
      executeRepositoryAction: { status: 'completed', refresh: true, detail: null },
    })
    await act(async () => {
      ;(marker('stash-open') as HTMLButtonElement).click()
    })
    expect(dialog('stash-dialog')).not.toBeNull()
    await act(async () => {
      typeInto(dialog('stash-name') as HTMLInputElement, 'wip: panel')
    })
    await act(async () => {
      ;(dialog('stash-submit') as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'previewRepositoryAction')?.args).toMatchObject({
      request: { action: 'stash-save', includeUntracked: false, message: 'wip: panel' },
    })
    expect(double.calls.find((call) => call.method === 'executeRepositoryAction')?.args).toMatchObject({
      request: { action: 'stash-save', includeUntracked: false, message: 'wip: panel' },
      version: 'v1',
      approved: true,
    })
    expect(dialog('stash-dialog')).toBeNull()
    expect(double.calls.filter((call) => call.method === 'getState').length).toBeGreaterThan(1)
  })

  it('stashes without a name and keeps the dialog open when the host refuses', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      previewRepositoryAction: { request: { action: 'stash-save', includeUntracked: false }, version: 'v1' },
      executeRepositoryAction: new GitApiError({ code: 'index-locked', detail: 'lock' }, null),
    })
    await act(async () => {
      ;(marker('stash-open') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(dialog('stash-submit') as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'previewRepositoryAction')?.args).toMatchObject({
      request: { action: 'stash-save', includeUntracked: false },
    })
    expect(dialog('stash-dialog')).not.toBeNull()
    expect(container.textContent).toContain(en['failure.indexLocked'])
  })

  it('marks each row with a file-type glyph, the muted directory and a status letter', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    const row = all('row').find((candidate) => candidate.getAttribute('data-path') === 'src/app.ts')!
    // The type glyph comes from the platform primitive, keyed by the path.
    expect(row.querySelector('svg')).not.toBeNull()
    expect(row.textContent).toContain('src')
    expect(row.querySelector('[data-dsh-git="status"]')?.textContent).toBe('M')
  })

  it('replaces the entire multiline commit message without opening an agent dialog', async () => {
    const sent = vi.fn()
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      draftInput: 'Generated summary\n\nGenerated description',
    }, { sendPrompt: sent })
    await act(async () => { (marker('commit-open') as HTMLButtonElement).click() })
    await act(async () => { typeInto(dialog('commit-message') as HTMLTextAreaElement, 'Old summary\n\nOld description') })
    await act(async () => { (dialog('draft-message') as HTMLButtonElement).click() })
    expect(document.querySelector('[data-dsh-git="agent-dialog"]')).toBeNull()
    expect(double.calls.find(call => call.method === 'draftInput')?.args).toMatchObject({ kind: 'commit', mode: 'staged', message: 'Old summary\n\nOld description' })
    expect((dialog('commit-message') as HTMLTextAreaElement).value).toBe('Generated summary\n\nGenerated description')
    expect(sent).not.toHaveBeenCalled()
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

  // The bug this pins: a restored tab read state before the host had loaded the
  // session, and the panel claimed the checkout was not a git repository.
  it('keeps a loading panel while the session is not loaded yet, then loads it', async () => {
    vi.useFakeTimers()
    try {
      let ready = false
      const { double } = await renderPanel({
        getState: () => {
          if (!ready) throw new GitApiError({ code: 'session-not-ready', detail: 'session has no working directory' }, null)
          return { state: panelState(), notice: null }
        },
      })
      expect(marker('loading')).not.toBeNull()
      expect(marker('degraded')).toBeNull()
      expect(container.textContent).not.toContain(en['state.noRepository'])

      ready = true
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
      expect(marker('loading')).toBeNull()
      expect(marker('changes')).not.toBeNull()
      expect(double.calls.filter((call) => call.method === 'getState').length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('names an unloaded session in the header and in the banner once the budget is spent', async () => {
    vi.useFakeTimers()
    try {
      await renderPanel({ getState: new GitApiError({ code: 'session-not-ready', detail: 'session has no working directory' }, null) })
      // While it retries the panel says it is reading, never that the folder is
      // not a repository.
      expect(container.textContent).toContain(en['state.loading'])
      expect(container.textContent).not.toContain(en['state.noRepository'])
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
      expect(marker('failure')).not.toBeNull()
      expect(container.textContent).toContain(en['failure.sessionNotReady'])
      expect(container.textContent).toContain(en['failure.fix.sessionNotReady'])
      expect(container.textContent).not.toContain(en['state.noRepository'])
      expect(marker('degraded')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
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
    await act(async () => {
      ;(marker('commit-open') as HTMLButtonElement).click()
    })
    await act(async () => {
      typeInto(dialog('commit-message') as HTMLTextAreaElement, 'feat: hooky')
    })
    await act(async () => {
      ;(dialog('commit-submit') as HTMLButtonElement).click()
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
    await openSection('history')
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

describe('branch picker', () => {
  const refRow = (id: string): HTMLElement | null => document.querySelector(`[data-dsh-git="ref-row"][data-ref="${id}"]`)

  it('opens the ref picker from the branch chip instead of a dropdown menu', async () => {
    await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false } })
    expect(document.querySelector('[data-dsh-git="ref-picker"]')).toBeNull()
    await act(async () => {
      ;(marker('branch-button') as HTMLButtonElement).click()
    })
    expect(marker('branch-button')?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(marker('branch-button')?.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-dsh-git="ref-picker"]')).not.toBeNull()
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(refRow('branch:main')?.textContent).toContain('main')
  })

  it('switches to the picked branch and closes the picker', async () => {
    // A clean tree switches on the pick itself; the dirty case confirms first.
    const clean = panelState({ changes: { ...panelState().changes, staged: [], unstaged: [], untracked: [] } })
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      getState: { state: clean, notice: null },
      branchSwitch: panelState(),
    })
    await act(async () => {
      ;(marker('branch-button') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(refRow('branch:feature') as HTMLElement).click()
    })
    expect(double.calls.find((call) => call.method === 'branchSwitch')?.args).toMatchObject({ name: 'feature' })
    expect(document.querySelector('[data-dsh-git="ref-picker"]')).toBeNull()
  })

  it('confirms a switch away from a dirty tree before calling the host', async () => {
    const { double } = await renderPanel({ getHistory: { commits: [], lanes: [], hasMore: false }, branchSwitch: panelState() })
    await act(async () => {
      ;(marker('branch-button') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(refRow('branch:feature') as HTMLElement).click()
    })
    expect(document.querySelector('[data-dsh-git="confirm-proceed"]')).not.toBeNull()
    expect(double.calls.some((call) => call.method === 'branchSwitch')).toBe(false)
    await act(async () => {
      ;(document.querySelector('[data-dsh-git="confirm-proceed"]') as HTMLButtonElement).click()
    })
    expect(double.calls.some((call) => call.method === 'branchSwitch')).toBe(true)
  })

  it('creates the named branch from the picker and checks it out', async () => {
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      branchCreate: panelState(),
      branchSwitch: panelState(),
    })
    await act(async () => {
      ;(marker('branch-button') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(document.querySelector('[data-dsh-git="ref-action"][data-action="create"]') as HTMLElement).click()
    })
    const name = document.querySelector('[data-dsh-git="branch-name"]') as HTMLInputElement
    await act(async () => {
      typeInto(name, 'feature/beta')
    })
    await act(async () => {
      ;(document.querySelector('[data-dsh-git="branch-create-submit"]') as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'branchCreate')?.args).toMatchObject({ name: 'feature/beta' })
    expect(double.calls.find((call) => call.method === 'branchSwitch')?.args).toMatchObject({ name: 'feature/beta' })
    expect(document.querySelector('[data-dsh-git="ref-picker"]')).toBeNull()
  })

  it('detaches HEAD at the tag picked from the detached list', async () => {
    const tagged = panelState({
      branches: [...panelState().branches, { name: 'origin/topic', current: false, oid: 'bbbb', upstream: null, remote: true, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'remote work' }],
      tags: [{ name: 'v1', oid: 'tag1', author: 'A', committedAt: 1, subject: 'release' }],
    })
    const { double } = await renderPanel({
      getHistory: { commits: [], lanes: [], hasMore: false },
      getState: { state: tagged, notice: null },
      checkoutCommit: panelState(),
    })
    await act(async () => {
      ;(marker('branch-button') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(document.querySelector('[data-dsh-git="ref-action"][data-action="detach"]') as HTMLElement).click()
    })
    const filter = document.querySelector('[data-dsh-git="ref-filter"]') as HTMLInputElement
    expect(filter.placeholder).toBe(en['picker.detachPlaceholder'])
    await act(async () => {
      ;(refRow('remote:origin/topic') as HTMLElement).click()
    })
    expect(double.calls.some((call) => call.method === 'checkoutCommit')).toBe(false)
    await act(async () => {
      ;(document.querySelector('[data-dsh-git="confirm-proceed"]') as HTMLButtonElement).click()
    })
    expect(double.calls.find((call) => call.method === 'checkoutCommit')?.args).toMatchObject({ hash: 'bbbb' })
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
    await openSection('worktrees')
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
    await openSection('worktrees')
    expect(all('worktree')).toHaveLength(2)
    expect(byText(en['worktrees.merge'].replace('{branch}', 'main'))).toBeUndefined()
  })

  it('switches the comparison base through the base menu', async () => {
    const { double } = await renderPanel(readState)
    await openSection('worktrees')
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

  it('creates from a ref picked in the source picker', async () => {
    const { double } = await renderPanel({
      ...readState,
      worktreeAdd: {
        plan: { slug: 'feature', path: '/repo/.worktrees/feature', branch: 'feature', base: 'feature', setup: [] },
        state: panelState(),
        setup: { ran: 0, failed: false, output: '' },
        notice: null,
      },
    })
    await openSection('worktrees')
    await act(async () => {
      ;(marker('worktree-source') as HTMLButtonElement).click()
    })
    const item = document.querySelector('[data-dsh-git="ref-row"][data-ref="branch:feature"]')
    await act(async () => {
      ;(item as HTMLElement).click()
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
    await openSection('worktrees')
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
    await openSection('worktrees')
    await act(async () => {
      ;(marker('worktree-open-session') as HTMLButtonElement).click()
    })
    expect(opened).toEqual(['/repo/.worktrees/feature'])

    await renderPanel(readState, {
      openWorktreeSession: async () => {
        throw new Error('no workspace navigation')
      },
    })
    await openSection('worktrees')
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
