/**
 * The derived-browser bridge: the one sanctioned channel between the
 * seam-injected row markup and this plugin's React code.
 *
 * The seams run inside the official browser module and cannot import our
 * components; they read this window-attached bridge instead. The browser
 * wrapper keeps the creation facts fresh from each topology pull, and the
 * entry installs the modal opening plus the localized label. Namespaced,
 * tiny, typed — not a grab bag.
 */
import type { WorkspaceFactsLike } from './types.ts'

/** Decoration facts the menu actions carry (from the row's metadata). */
export interface MenuDecoration {
  readonly slug: string
  readonly title: string
  readonly branch: string
  readonly path: string
  /** The host workspace registered for this worktree (delete cleanup). */
  readonly workspaceId?: string
  /** Sessions living in the worktree workspace (delete cleanup). */
  readonly sessionIds?: readonly string[]
  readonly dirty: boolean
  readonly ahead: number
  readonly merged: boolean
}

/** The bridge the seam markup consumes. */
export interface WorktreesBridge {
  /** Whether the repo-row worktree button renders for this cwd. */
  canCreate(cwd: string | undefined): boolean
  /** Localized aria label for the create button. */
  createLabel(repoLabel: string): string
  /** The create button was clicked: start the auto-named create flow. */
  requestCreate(cwd: string, repoLabel: string): void
  /** Localized label for a menu item key. */
  menuLabel(key: string): string
  /** Localized hover-card fact lines for one worktree row. */
  worktreeFacts(decoration: MenuDecoration): readonly string[]
  /** A worktree menu action fired on a session row. */
  requestMenu(action: string, decoration: MenuDecoration, sessionId: string): void
}

declare global {
  interface Window {
    __dshNextWorktreesBridge?: WorktreesBridge
  }
}

/** Creation facts by workspace cwd, refreshed wholesale per topology pull. */
const factsStore = new Map<string, boolean>()

/**
 * Install the bridge with entry-owned handlers.
 *
 * @param handlers - label + modal-opening wiring (injectable for tests).
 * @returns an uninstall function (plugin teardown).
 */
export function installBridge(handlers: {
  createLabel(repoLabel: string): string
  requestCreate(cwd: string, repoLabel: string): void
  menuLabel(key: string): string
  worktreeFacts(decoration: MenuDecoration): readonly string[]
  requestMenu(action: string, decoration: MenuDecoration, sessionId: string): void
}): () => void {
  window.__dshNextWorktreesBridge = {
    canCreate: (cwd) => factsStore.get(cwd ?? '') === true,
    createLabel: handlers.createLabel,
    requestCreate: handlers.requestCreate,
    menuLabel: handlers.menuLabel,
    worktreeFacts: handlers.worktreeFacts,
    requestMenu: handlers.requestMenu,
  }
  return () => {
    delete window.__dshNextWorktreesBridge
  }
}

/**
 * Refresh the creation facts (called by the browser wrapper after each
 * topology pull). Reads stay synchronous so row renders stay pure.
 *
 * @param workspaces - the topology's per-workspace facts.
 */
export function updateBridgeFacts(workspaces: readonly WorkspaceFactsLike[]): void {
  factsStore.clear()
  for (const facts of workspaces) factsStore.set(facts.cwd, facts.canCreate)
}
