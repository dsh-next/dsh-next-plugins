/**
 * External store for the merge/delete/create modals.
 * React 18's useSyncExternalStore consumes it; non-React callers
 * (the bridge) drive it directly.
 *
 * Create opens a one-field name modal (clusters one-pager): the typed
 * text is the folder title only. Path, slug, and branch stay generated.
 * `creating` guards re-entry and writes `html[data-dshx-creating]` so the
 * repo-row icon can spin until the cluster exists; `settingUp` then
 * moves the spinner onto that row's identity icon while `.worktrees.json`
 * runs.
 */
import type { MergeBlocker, MergeWarning } from '../core/merge.ts'
import type { UpdateBlocker } from '../core/update.ts'
import { validateFolderName } from '../core/slug.ts'
import { WorktreesRpcError } from './rpc.ts'

export type ModalKind = 'closed' | 'create' | 'create-error' | 'merge' | 'delete' | 'update'

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
  readonly warnings?: readonly MergeWarning[]
  readonly green: boolean
  readonly target?: string
  readonly source?: string
  readonly fastForward: boolean
  readonly aheadCount: number
  readonly manualCommand?: string
  readonly dirtyPrimary?: readonly string[]
  readonly dirtyWorktree?: readonly string[]
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
  readonly dirtyWorktree?: readonly string[]
}

/** Optional session handoff after a conflicting update starts. */
export interface UpdateHandoff {
  open(sessionId: string): void
  prompt?(sessionId: string, text: string): void
}

export interface ModalState {
  readonly kind: ModalKind
  /** True while the named create flow is in flight. */
  readonly creating: boolean
  /** One-field name modal (suggestion prefilled). */
  readonly create?: {
    readonly cwd: string
    readonly repoLabel: string
    readonly suggestion: string
    readonly name: string
    /** Distinguishes an async suggestion from an earlier Create opening. */
    readonly requestId: number
    readonly busy: boolean
  }
  /**
   * Set once the session row exists and `.worktrees.json` setup is
   * running. Drives the identity-icon spinner.
   */
  readonly settingUp?: {
    readonly slug: string
    readonly sessionId: string
    readonly workspaceId: string
    readonly path: string
  }
  /** Why the auto-named create flow failed (modal-free flow, modal error). */
  readonly createError?: string
  /**
   * `setup` when the worktree and session already exist (command failed
   * after open). `create` when the flow rolled back so nothing remains.
   */
  readonly createErrorKind?: 'create' | 'setup'
  /** Sidebar title for a setup failure (disk folder stays generated). */
  readonly createErrorTitle?: string
  /** Generated disk folder name (slug) when setup names a path. */
  readonly createErrorFolder?: string
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
let nextCreateRequestId = 0
let state: ModalState = INITIAL

function emit(): void {
  for (const listener of listeners) listener()
}

function set(next: ModalState): void {
  state = next
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.dshxCreating = next.creating ? 'true' : 'false'
    if (next.settingUp !== undefined) {
      document.documentElement.dataset.dshxSettingUp = next.settingUp.slug
    } else {
      delete document.documentElement.dataset.dshxSettingUp
    }
  }
  emit()
}

function setModalError(kind: 'merge' | 'update' | 'delete', error: unknown): void {
  if (state.kind !== kind || state[kind] === undefined) return
  set({
    ...state,
    [kind]: {
      ...state[kind],
      busy: false,
      error: error instanceof Error ? error.message : String(error),
    },
  })
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
  rpc('merge/preflight', {
    cwd: target.path,
    slug: target.slug,
    sessionIds: target.sessionIds ?? [],
  })
    .then((preflight) => {
      if (state.kind !== 'merge' || state.merge === undefined || state.merge.target !== target) return
      set({ ...state, merge: { ...state.merge, preflight: preflight as MergePreflightFacts, busy: false } })
    })
    .catch((error: unknown) => { setModalError('merge', error) })
}

/** Execute the guarded merge from the merge modal. */
export function executeMerge(rpc: (m: string, a?: unknown) => Promise<unknown>): void {
  if (state.kind !== 'merge' || state.merge === undefined) return
  const target = state.merge.target
  set({ ...state, merge: { ...state.merge, busy: true, error: undefined } })
  void rpc('merge/execute', {
    cwd: target.path,
    slug: target.slug,
    sessionIds: target.sessionIds ?? [],
  })
    .then((result) => {
      if (state.kind !== 'merge' || state.merge === undefined) return
      const done = result as { target: string; fastForward: boolean }
      set({ ...state, merge: { ...state.merge, busy: false, done } })
    })
    .catch((error: unknown) => { setModalError('merge', error) })
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
    .catch((error: unknown) => { setModalError('merge', error) })
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
  rpc('update/preflight', {
    cwd: target.path,
    slug: target.slug,
    sessionIds: target.sessionIds ?? [],
  })
    .then((preflight) => {
      if (state.kind !== 'update' || state.update === undefined || state.update.target !== target) return
      set({ ...state, update: { ...state.update, preflight: preflight as UpdatePreflightFacts, busy: false } })
    })
    .catch((error: unknown) => { setModalError('update', error) })
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
  void rpc('update/execute', {
    cwd: target.path,
    slug: target.slug,
    sessionIds: target.sessionIds ?? [],
  })
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
    .catch((error: unknown) => { setModalError('update', error) })
}

/** Abort an in-flight update merge in the worktree. */
export function abortUpdate(rpc: (m: string, a?: unknown) => Promise<unknown>): Promise<void> {
  if (state.kind !== 'update' || state.update === undefined) return Promise.resolve()
  const target = state.update.target
  set({ ...state, update: { ...state.update, busy: true, error: undefined } })
  return rpc('update/abort', { cwd: target.path, slug: target.slug })
    .then(() => { set(INITIAL) })
    .catch((error: unknown) => { setModalError('update', error) })
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
    .catch((error: unknown) => { setModalError('delete', error) })
}

/** Mark the create flow in/out of flight (re-entry guard). */
function setCreating(creating: boolean): void {
  set({ ...state, creating })
}

/** Open the name modal and pull a host suggestion. */
export function openCreate(
  cwd: string,
  repoLabel: string,
  rpc: (m: string, a?: unknown) => Promise<unknown>,
): void {
  if (state.creating) return
  const requestId = ++nextCreateRequestId
  set({
    kind: 'create',
    creating: false,
    create: { cwd, repoLabel, suggestion: '', name: '', requestId, busy: true },
  })
  rpc('suggestName', { cwd })
    .then((suggestion) => {
      if (state.kind !== 'create' || state.create === undefined || state.create.requestId !== requestId) return
      const value = typeof suggestion === 'string' ? suggestion : ''
      set({
        ...state,
        create: { ...state.create, suggestion: value, name: value, busy: false },
      })
    })
    .catch(() => {
      if (state.kind !== 'create' || state.create === undefined || state.create.requestId !== requestId) return
      set({ ...state, create: { ...state.create, busy: false } })
    })
}

/** Edit the name field. Empty stays empty so submit can fall back. */
export function setCreateName(name: string): void {
  if (state.kind !== 'create' || state.create === undefined) return
  set({ ...state, create: { ...state.create, name } })
}

interface CreateServices {
  readonly rpc: (method: string, args?: unknown) => Promise<unknown>
  readonly workspaces: {
    create(a: { path: string }): Promise<{ workspaceId: string }>
    delete?(workspaceId: string): Promise<void>
    archiveSession?(sessionId: string): Promise<void>
    rename?(workspaceId: string, title: string): Promise<unknown>
  }
  readonly sessions: { create(a: { workspaceId: string }): Promise<string>; open(id: string): void }
  readonly onTopologyRefresh: () => void
}

/** Confirm the name modal: empty field uses the suggestion. */
export function submitCreate(input: CreateServices): void {
  if (state.kind !== 'create' || state.create === undefined || state.create.busy) return
  const { cwd, suggestion, name } = state.create
  const title = name.trim() === '' ? suggestion : name
  if (!validateFolderName(title).ok) return
  set({ ...state, kind: 'closed', create: undefined })
  void runCreateFlow({
    cwd,
    name: title,
    rpc: input.rpc,
    workspaces: input.workspaces,
    sessions: input.sessions,
    onTopologyRefresh: input.onTopologyRefresh,
  })
}

/** Reset for tests. */
export function resetModalStore(): void {
  set(INITIAL)
}

/**
 * The named create flow, driven from the name modal.
 *
 * The typed Name is a display title only; path/slug/branch stay generated.
 * Order matters: the worktree exists before the workspace is registered
 * (the workspace path must resolve), the session exists before the bind
 * (the bind claims the row for the session). Open comes next so the
 * nested cluster exists, then setup runs with that row's branch icon
 * spinning. A failed setup command keeps the worktree and session (the
 * user can finish setup or delete); earlier failures still roll back.
 *
 * @param input - the repo cwd plus the service/RPC faces.
 */
export async function runCreateFlow(input: CreateServices & {
  readonly cwd: string
  readonly name?: string
}): Promise<void> {
  const { cwd, name, rpc, workspaces, sessions, onTopologyRefresh } = input
  if (state.creating) return
  setCreating(true)
  let created: { slug: string; path: string; relPath: string; title?: string; setupPending?: boolean } | undefined
  let workspaceId: string | undefined
  let sessionId: string | undefined
  let keepOnFailure = false
  try {
    created = await rpc('create', {
      cwd,
      ...(name !== undefined && name !== '' ? { name } : {}),
    }) as {
      slug: string
      path: string
      relPath: string
      title?: string
      setupPending?: boolean
    }
    const workspacePath = created.relPath === ''
      ? created.path
      : `${created.path}/${created.relPath}`
    const workspace = await workspaces.create({ path: workspacePath })
    workspaceId = workspace.workspaceId
    const title = created.title !== undefined && created.title !== '' ? created.title : name
    if (title !== undefined && title !== '' && workspaces.rename !== undefined) {
      await workspaces.rename(workspace.workspaceId, title).catch(() => {})
    }
    sessionId = await sessions.create({ workspaceId: workspace.workspaceId })
    await rpc('bind', { sessionId })
    sessions.open(sessionId)
    // Session and worktree exist; setup is optional convenience after this.
    keepOnFailure = true
    if (created.setupPending === true) {
      set({
        ...state,
        creating: true,
        settingUp: {
          slug: created.slug,
          sessionId,
          workspaceId: workspace.workspaceId,
          path: created.path,
        },
      })
      onTopologyRefresh()
      await rpc('setup', { cwd, slug: created.slug })
    }
    set(INITIAL)
    onTopologyRefresh()
  } catch (error) {
    if (keepOnFailure) {
      const title = created?.title || name || created?.slug || ''
      const folder = folderName(created?.path ?? '')
      set({
        ...INITIAL,
        kind: 'create-error',
        createError: formatCreateError(error),
        createErrorKind: 'setup',
        createErrorTitle: title === '' ? undefined : title,
        createErrorFolder: folder === '' ? undefined : folder,
      })
      onTopologyRefresh()
      return
    }
    // Host create is not transactional with workspace/session/bind: if a
    // later step fails before the session opens, drop the git worktree
    // (and any workspace we did register) so "nothing was changed" holds.
    if (sessionId !== undefined && sessionId !== '' && workspaces.archiveSession !== undefined) {
      await workspaces.archiveSession(sessionId).catch(() => {})
    }
    if (created !== undefined) {
      await rpc('remove', { cwd: created.path, slug: created.slug, force: true }).catch(() => {})
      if (workspaceId !== undefined && workspaceId !== '' && workspaces.delete !== undefined) {
        await workspaces.delete(workspaceId).catch(() => {})
      }
    }
    set({
      ...INITIAL,
      kind: 'create-error',
      createError: formatCreateError(error),
      createErrorKind: 'create',
    })
  }
}

/** Last path segment, POSIX or Windows. */
export function folderName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter((part) => part !== '').pop() ?? ''
}

/** Message plus host hint (setup stderr) so the modal is actionable. */
export function formatCreateError(error: unknown): string {
  if (error instanceof WorktreesRpcError) {
    const hint = error.hint?.trim() ?? ''
    return hint === '' ? error.message : `${error.message}\n${hint}`
  }
  return error instanceof Error ? error.message : String(error)
}
