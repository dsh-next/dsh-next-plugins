/** Mount the freshly derived official Browser with real React and in-memory stores. */
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { createRequire } from 'node:module'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { installBridge } from '../src/client/bridge.ts'
import { decorateWorkspaces, type WorktreeRowDecoration } from '../src/client/projection.ts'

const require = createRequire(import.meta.url)
const derive = require('../scripts/derive-workspace-browser.mjs') as {
  readOfficialWorkspaceClient(): { source: string }
  decorateOfficialWorkspaceClient(source: string): string
  extractFactoryBody(source: string): string
}

interface ViewState {
  groupBy: 'workspace' | 'flat'
  orderBy: 'manual' | 'updated'
  groupExpansion: Record<string, boolean>
  sessionOrderByAccount: Record<string, string[]>
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
}
interface ViewSpec {
  init(): ViewState
  actions: Record<string, (draft: ViewState, ...args: unknown[]) => void>
}
interface OfficialModule {
  WorkspaceBrowser: React.ComponentType<Record<string, unknown>>
  createWorkspaceViewStore(): ViewSpec
  en: Record<string, string>
}

// Only platform chrome is mocked. Browser, tree, row effects, search, grouping,
// overflow and store actions all come from the actual hash-gated official bundle.
const primitives: Record<string, unknown> = {
  HoverCard: ({ anchor }: { anchor: React.ReactNode }) => <>{anchor}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Menu: ({ anchor }: { anchor: React.ReactNode }) => <>{anchor}</>,
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  StateDot: () => null,
  relativeTime: () => ({ unit: 'now', n: 0 }),
}
const icon = () => <svg aria-hidden="true" />
function loadBrowser(): OfficialModule {
  const source = derive.decorateOfficialWorkspaceClient(derive.readOfficialWorkspaceClient().source)
  const body = derive.extractFactoryBody(source)
  const anchor = 'return module.exports;'
  if (body.indexOf(anchor) !== body.lastIndexOf(anchor) || !body.includes(anchor)) {
    throw new Error('Official factory return anchor drifted')
  }
  // Test-only access to closure-private components, without altering their bodies
  // or adding a testing export to the shipped client.
  const factory = new Function('require', body.replace(anchor,
    'return { WorkspaceBrowser, createWorkspaceViewStore, en };'))
  return factory((specifier: string): unknown => {
    if (specifier === 'react') return React
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === '@deepseek-ai/cordis') return { Service: class {} }
    if (specifier === '@deepseek-ai/dsh-client-store') return { defineStore: (spec: ViewSpec) => spec }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
      return new Proxy(primitives, {
        get(target, key: string) {
          if (key.startsWith('Icon')) return icon
          if (key in target) return target[key]
          throw new Error(`Unexpected platform primitive: ${key}`)
        },
      })
    }
    throw new Error(`Unexpected official dependency: ${specifier}`)
  }) as OfficialModule
}
const official = loadBrowser()

function memoryState<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  return {
    get: () => snapshot,
    set(next: T) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    use<R>(selector: (state: T) => R): R {
      return selector(React.useSyncExternalStore(subscribe, () => snapshot))
    },
  }
}

export async function mountSidebar(options: {
  nested?: boolean
  flat?: boolean
  current?: string
  blank?: boolean
  phase?: WorkspaceSnapshot['phase']
  stream?: WorkspaceSnapshot['state']
  withholdWorkspaces?: boolean
  expansion?: Record<string, boolean>
} = {}) {
  const nested = options.nested ?? true
  const sessionIds = Array.from({ length: 7 }, (_, i) => `s${i}`)
  const rows = sessionIds.map((id, i) => ({
    id, displayTitle: `Topic ${i}`, updatedAt: 1000 - i,
    running: false, blank: options.blank === true && id === options.current,
  }))
  const sessions = memoryState({
    phase: 'ready', ids: sessionIds, byId: Object.fromEntries(rows.map((row) => [row.id, row])),
    current: options.current,
  })
  const childId = nested ? 'worktree' : 'harbor'
  const workspaces = [{
    workspaceId: 'harbor', path: '/repo', title: 'Repository', createdAt: '2026-01-01',
    sessionIds: nested ? [] : sessionIds,
  }, ...(nested ? [{
    workspaceId: childId, path: '/repo/.dsh/worktrees/topic', title: 'Worktree', createdAt: '2026-01-01', sessionIds,
  }] : [])]
  const decoration: WorktreeRowDecoration = {
    kind: 'dsh-next-worktrees', slug: 'topic', title: 'Worktree', branch: 'dsh-worktrees/topic',
    path: '/repo/.dsh/worktrees/topic', baseRef: 'main', primaryBranch: 'main',
    workspaceId: childId, harborWorkspaceId: 'harbor', sessionIds,
    dirty: false, ahead: 0, merged: false, conflict: false,
  }
  const loadedItems = decorateWorkspaces(workspaces, new Map(nested ? [[childId, decoration]] : []))
  const workspace = memoryState({
    items: options.withholdWorkspaces ? [] : loadedItems,
    phase: options.phase ?? 'ready', state: options.stream ?? 'idle', archivedSessionIds: [] as string[],
  })
  const spec = official.createWorkspaceViewStore()
  const view = memoryState<ViewState>({
    ...spec.init(), groupBy: options.flat ? 'flat' : 'workspace', orderBy: 'manual',
    groupExpansion: options.expansion ?? { harbor: false, ...(nested ? { worktree: false } : {}) },
  })
  const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, mutate]) => [name,
    vi.fn((...args: unknown[]) => {
      const draft = structuredClone(view.get())
      mutate(draft, ...args)
      view.set(draft)
    }),
  ]))
  const open = vi.fn((id: string) => sessions.set({ ...sessions.get(), current: id }))
  const pending = new Map()
  const props = {
    wide: true, expandSidebar: vi.fn(),
    useSessions: sessions.use, useWorkspaces: workspace.use, useStore: view.use,
    useSessionPendingInteraction: (select: (state: Map<unknown, unknown>) => unknown) => select(pending),
    useDirectoryFlow: (select: (state: boolean) => unknown) => select(false),
    useHostInfo: (select: (state: { home: string }) => unknown) => select({ home: '/home/test' }),
    actions, open, startSession: vi.fn(), forkSession: vi.fn(),
    renameSession: vi.fn(), renameWorkspace: vi.fn(), deleteWorkspace: vi.fn(),
    archiveSession: vi.fn().mockResolvedValue(undefined), insertWorkspaceBefore: vi.fn(), insertSessionBefore: vi.fn(),
    createWorkspace: vi.fn(), renderSlot: () => null,
    searchSessions: vi.fn().mockResolvedValue({ items: [], hasMore: false }), searchResultLimit: 100,
    t: (key: string, values: Record<string, unknown> = {}) =>
      (official.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? '')),
  }
  const uninstall = installBridge({
    createLabel: () => '', requestCreate: () => {}, menuLabel: (key) => key,
    worktreeFacts: () => [], requestMenu: () => {},
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(<official.WorkspaceBrowser {...props} />) })
  return {
    container, workspace, loadedItems, sessions, view, actions, open,
    async dispose() {
      await act(async () => root.unmount())
      uninstall()
      container.remove()
    },
  }
}

export async function chooseSearchResult(container: HTMLElement, title = 'Topic 6') {
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Search sessions"]')!
  await act(async () => button.click())
  const input = container.querySelector<HTMLInputElement>('[placeholder="Search sessions..."]')!
  await act(async () => {
    // Native setter bypasses React's value tracker so an actual input event
    // reaches the unchanged upstream onChange handler.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, title)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const result = container.querySelector<HTMLButtonElement>('[aria-label="Search results"] [role="treeitem"]')
  if (result === null) throw new Error(`No search result for ${title}`)
  await act(async () => result.click())
}
