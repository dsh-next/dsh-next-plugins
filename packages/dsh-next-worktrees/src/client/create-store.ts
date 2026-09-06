/**
 * External store for the merge/delete modals and the auto-named create
 * flow. React 18's useSyncExternalStore consumes it; non-React callers
 * (the bridge) drive it directly.
 *
 * Create has no modal (decision: docs/ideas/dsh-next-worktrees-sidebar-ux.md
 * rev 3): clicking the repo-row button creates the worktree immediately
 * with the host-suggested name; `creating` only guards re-entry.
 */
import type { MergeBlocker } from '../core/merge.ts'
import type { UpdateBlocker } from '../core/update.ts'

export type ModalKind = 'closed' | 'create-error' | 'merge' | 'delete' | 'update'

/** Facts a worktree modal needs, carried from the row decoration. */
export interface WorktreeModalTarget {
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
  readonly conflict?: boolean
}

/**
 * Host-truth cleanup face: after the git worktree is gone, the workspace
 * registered for it must go too, or it lingers as a regular workspace
 * folder. Uses the stock service calls (archiveSession + workspace
 * delete) — the same ones the official browser's own delete drives.
 */
export interface HostCleanup {
  archiveSession(sessionId: string): Promise<void>
  removeWorkspace(workspaceId: string): Promise<void>
}

export interface MergePreflightFacts {
  readonly blockers: readonly MergeBlocker[]
  readonly green: boolean
  readonly target?: string
  readonly source?: string
  readonly fastForward: boolean
  readonly aheadCount: number
  readonly manualCommand?: string
}

export interface UpdatePreflightFacts {
  readonly blockers: readonly UpdateBlocker[]
  readonly green: boolean
  readonly source?: string
  readonly target?: string
  readonly fastForward: boolean
  readonly wouldConflict: boolean
  readonly inProgress: boolean
  readonly sessionId?: string
  readonly manualCommand?: string
}

/** Optional session handoff after a conflicting update starts. */
export interface UpdateHandoff {
  open(sessionId: string): void
  prompt?(sessionId: string, text: string): void
}

export interface ModalState {
  readonly kind: ModalKind
  /** True while the auto-named create flow is in flight. */
  readonly creating: boolean
  /** Why the auto-named create flow failed (modal-free flow, modal error). */
  readonly createError?: string
  readonly merge?: {
    readonly target: WorktreeModalTarget
    readonly preflight?: MergePreflightFacts
    readonly busy: boolean
    readonly done?: { target: string; fastForward: boolean }
    readonly error?: string
  }
  readonly delete?: {
    readonly target: WorktreeModalTarget
    readonly busy: boolean
    readonly armed: boolean
    readonly error?: string
  }
  readonly update?: {
    readonly target: WorktreeModalTarget
    readonly preflight?: UpdatePreflightFacts
    readonly busy: boolean
    readonly done?: { source: string; conflict: boolean; sessionId: string }
    readonly error?: string
  }
}

const INITIAL: ModalState = { kind: 'closed', creating: false }

type Listener = () => void

const listeners = new Set<Listener>()
let state: ModalState = INITIAL

function emit(): void {
  for (const listener of listeners) listener()
}

function set(next: ModalState): void {
  state = next
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.dshxCreating = next.creating ? 'true' : 'false'
  }
  emit()
}

/** Subscribe to modal state changes (useSyncExternalStore contract). */
export function subscribeModal(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Current modal state snapshot. */
export function modalState(): ModalState {
  return state
}

/** Close whatever modal is open (Escape, mask click, cancel). */
export function closeModal(): void {
  if (state.merge !== undefined && state.merge.busy) return
  if (state.delete !== undefined && state.delete.busy) return
  if (state.update !== undefined && state.update.busy) return
  set({ ...INITIAL, creating: state.creating })
}

/** Open the merge modal and pull its preflight. */
export function openMerge(target: WorktreeModalTarget, rpc: (m: string, a?: unknown) => Promise<unknown>): void {
  set({
    kind: 'merge',
    creating: state.creating,
    merge: { target, busy: true },
    delete: undefined,
    update: undefined,
  })
  rpc('merge/preflight', { cwd: target.path, slug: target.slug })
    .then((preflight) => {
      if (state.kind !== 'merge' || state.merge === undefined || state.merge.target !== target) return
      set({ ...state, merge: { ...state.merge, preflight: preflight as MergePreflightFacts, busy: false } })
    })
    .catch((error: unknown) => {
      if (state.kind !== 'merge' || state.merge === undefined) return
      set({
        ...state,
        merge: {
          ...state.merge,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    })
}

/** Execute the guarded merge from the merge modal. */
export function executeMerge(rpc: (m: string, a?: unknown) => Promise<unknown>): void {
  if (state.kind !== 'merge' || state.merge === undefined) return
  const target = state.merge.target
  set({ ...state, merge: { ...state.merge, busy: true, error: undefined } })
  void rpc('merge/execute', { cwd: target.path, slug: target.slug })
    .then((result) => {
      if (state.kind !== 'merge' || state.merge === undefined) return
      const done = result as { target: string; fastForward: boolean }
      set({ ...state, merge: { ...state.merge, busy: false, done } })
    })
    .catch((error: unknown) => {
      if (state.kind !== 'merge' || state.merge === undefined) return
      set({
        ...state,
        merge: {
          ...state.merge,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    })
}

/** Archive a worktree's sessions and drop its host workspace. */
async function cleanupHost(target: WorktreeModalTarget, host: HostCleanup): Promise<void> {
  for (const sessionId of target.sessionIds ?? []) {
    await host.archiveSession(sessionId).catch(() => {})
  }
  if (target.workspaceId !== undefined && target.workspaceId !== '') {
    await host.removeWorkspace(target.workspaceId)
  }
}

/** Remove the merged worktree from the merge-done view. */
export function cleanupMerged(rpc: (m: string, a?: unknown) => Promise<unknown>, host: HostCleanup): Promise<void> {
  if (state.kind !== 'merge' || state.merge === undefined) return Promise.resolve()
  const target = state.merge.target
  set({ ...state, merge: { ...state.merge, busy: true, error: undefined } })
  return rpc('remove', { cwd: target.path, slug: target.slug, force: false })
    .then(() => cleanupHost(target, host))
    .then(() => { set(INITIAL) })
    .catch((error: unknown) => {
      if (state.kind !== 'merge' || state.merge === undefined) return
      set({
        ...state,
        merge: {
          ...state.merge,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    })
}

/** Open the delete modal (dirty targets arm the force grammar). */
export function openDelete(target: WorktreeModalTarget): void {
  set({
    kind: 'delete',
    creating: state.creating,
    merge: undefined,
    delete: { target, busy: false, armed: !target.dirty },
    update: undefined,
  })
}

/** Open the update-from-main modal and pull its preflight. */
export function openUpdate(target: WorktreeModalTarget, rpc: (m: string, a?: unknown) => Promise<unknown>): void {
  set({
    kind: 'update',
    creating: state.creating,
    merge: undefined,
    delete: undefined,
    update: { target, busy: true },
  })
  rpc('update/preflight', { cwd: target.path, slug: target.slug })
    .then((preflight) => {
      if (state.kind !== 'update' || state.update === undefined || state.update.target !== target) return
      set({ ...state, update: { ...state.update, preflight: preflight as UpdatePreflightFacts, busy: false } })
    })
    .catch((error: unknown) => {
      if (state.kind !== 'update' || state.update === undefined) return
      set({
        ...state,
        update: {
          ...state.update,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    })
}

/** Execute update-from-main; on conflict, hand off to the bound session. */
export function executeUpdate(
  rpc: (m: string, a?: unknown) => Promise<unknown>,
  handoff?: UpdateHandoff,
  promptText?: string,
): void {
  if (state.kind !== 'update' || state.update === undefined) return
  const target = state.update.target
  set({ ...state, update: { ...state.update, busy: true, error: undefined } })
  void rpc('update/execute', { cwd: target.path, slug: target.slug })
    .then((result) => {
      if (state.kind !== 'update' || state.update === undefined) return
      const done = result as { source: string; conflict: boolean; sessionId: string }
      set({ ...state, update: { ...state.update, busy: false, done } })
      if (done.sessionId !== '') {
        handoff?.open(done.sessionId)
        if (done.conflict && promptText !== undefined && promptText !== '') {
          handoff?.prompt?.(done.sessionId, promptText)
        }
      }
    })
    .catch((error: unknown) => {
      if (state.kind !== 'update' || state.update === undefined) return
      set({
        ...state,
        update: {
          ...state.update,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    })
}

/** Abort an in-flight update merge in the worktree. */
export function abortUpdate(rpc: (m: string, a?: unknown) => Promise<unknown>): Promise<void> {
  if (state.kind !== 'update' || state.update === undefined) return Promise.resolve()
  const target = state.update.target
  set({ ...state, update: { ...state.update, busy: true, error: undefined } })
  return rpc('update/abort', { cwd: target.path, slug: target.slug })
    .then(() => { set(INITIAL) })
    .catch((error: unknown) => {
      if (state.kind !== 'update' || state.update === undefined) return
      set({
        ...state,
        update: {
          ...state.update,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    })
}

/** Arm the force step for a dirty target. */
export function armDelete(): void {
  if (state.kind !== 'delete' || state.delete === undefined) return
  set({ ...state, delete: { ...state.delete, armed: true } })
}

/** Execute the removal from the delete modal. */
export function executeDelete(
  rpc: (m: string, a?: unknown) => Promise<unknown>,
  host: HostCleanup,
): Promise<void> {
  if (state.kind !== 'delete' || state.delete === undefined || !state.delete.armed) return Promise.resolve()
  const target = state.delete.target
  set({ ...state, delete: { ...state.delete, busy: true, error: undefined } })
  return rpc('remove', { cwd: target.path, slug: target.slug, force: target.dirty })
    .then(() => cleanupHost(target, host))
    .then(() => { set(INITIAL) })
    .catch((error: unknown) => {
      if (state.kind !== 'delete' || state.delete === undefined) return
      set({
        ...state,
        delete: {
          ...state.delete,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    })
}

/** Mark the create flow in/out of flight (re-entry guard). */
function setCreating(creating: boolean): void {
  set({ ...state, creating })
}

/** Reset for tests. */
export function resetModalStore(): void {
  set(INITIAL)
}

/**
 * The auto-named create flow, driven straight from the repo-row button.
 *
 * No modal (rev 3 decision): the name is omitted so the host applies its
 * own suggestion. Order matters: the worktree exists before the workspace
 * is registered (the workspace path must resolve), the session exists
 * before the bind (the bind claims the row for the session), and the open
 * comes last so the user lands in the bound session.
 *
 * @param input - the repo cwd plus the service/RPC faces.
 */
export async function runCreateFlow(input: {
  readonly cwd: string
  readonly rpc: (method: string, args?: unknown) => Promise<unknown>
  readonly workspaces: {
    create(a: { path: string }): Promise<{ workspaceId: string }>
    delete?(workspaceId: string): Promise<void>
  }
  readonly sessions: { create(a: { workspaceId: string }): Promise<string>; open(id: string): void }
  readonly onTopologyRefresh: () => void
}): Promise<void> {
  const { cwd, rpc, workspaces, sessions, onTopologyRefresh } = input
  if (state.creating) return
  setCreating(true)
  let created: { slug: string; path: string; relPath: string } | undefined
  let workspaceId: string | undefined
  try {
    created = await rpc('create', {
      cwd,
    }) as {
      slug: string
      path: string
      relPath: string
    }
    const workspacePath = created.relPath === ''
      ? created.path
      : `${created.path}/${created.relPath}`
    const workspace = await workspaces.create({ path: workspacePath })
    workspaceId = workspace.workspaceId
    const sessionId = await sessions.create({ workspaceId: workspace.workspaceId })
    await rpc('bind', { sessionId })
    sessions.open(sessionId)
    set(INITIAL)
    onTopologyRefresh()
  } catch (error) {
    // Host create is not transactional with workspace/session/bind: if a
    // later step fails, drop the git worktree (and any workspace we did
    // register) so the error modal's "nothing was changed" hint holds.
    if (created !== undefined) {
      await rpc('remove', { cwd: created.path, slug: created.slug, force: true }).catch(() => {})
      if (workspaceId !== undefined && workspaceId !== '' && workspaces.delete !== undefined) {
        await workspaces.delete(workspaceId).catch(() => {})
      }
    }
    set({
      ...INITIAL,
      kind: 'create-error',
      createError: error instanceof Error ? error.message : String(error),
    })
  }
}
