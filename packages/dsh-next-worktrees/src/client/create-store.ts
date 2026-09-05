/**
 * External store for the create modal (and the shared modal surface the
 * merge/delete flows will join). React 18's useSyncExternalStore consumes
 * it; non-React callers (the bridge) drive it directly.
 */

export interface CreateModalState {
  readonly open: boolean
  readonly repoPath: string
  readonly repoLabel: string
  readonly suggestion: string
  readonly name: string
  readonly busy: boolean
  readonly error?: string
}

export type ModalKind = 'closed' | 'create' | 'merge' | 'delete'

/** Facts a worktree modal needs, carried from the row decoration. */
export interface WorktreeModalTarget {
  readonly slug: string
  readonly title: string
  readonly branch: string
  readonly path: string
  readonly dirty: boolean
  readonly ahead: number
  readonly merged: boolean
}

export interface MergePreflightFacts {
  readonly blockers: readonly string[]
  readonly green: boolean
  readonly target?: string
  readonly source?: string
  readonly fastForward: boolean
  readonly aheadCount: number
  readonly manualCommand?: string
}

export interface ModalState {
  readonly kind: ModalKind
  readonly create: CreateModalState
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
}

const CLOSED_CREATE: CreateModalState = {
  open: false,
  repoPath: '',
  repoLabel: '',
  suggestion: '',
  name: '',
  busy: false,
}

const INITIAL: ModalState = { kind: 'closed', create: CLOSED_CREATE }

type Listener = () => void

const listeners = new Set<Listener>()
let state: ModalState = INITIAL

function emit(): void {
  for (const listener of listeners) listener()
}

function set(next: ModalState): void {
  state = next
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

/** Open the create modal for a repo row. */
export function openCreate(repoPath: string, repoLabel: string, suggestion: string): void {
  set({
    kind: 'create',
    create: {
      open: true,
      repoPath,
      repoLabel,
      suggestion,
      name: suggestion,
      busy: false,
      error: undefined,
    },
    merge: undefined,
    delete: undefined,
  })
}

/** Close whatever modal is open (Escape, mask click, cancel). */
export function closeModal(): void {
  if (state.create.busy) return
  if (state.merge !== undefined && state.merge.busy) return
  if (state.delete !== undefined && state.delete.busy) return
  set({ kind: 'closed', create: CLOSED_CREATE })
}

/** Open the merge modal and pull its preflight. */
export function openMerge(target: WorktreeModalTarget, rpc: (m: string, a?: unknown) => Promise<unknown>): void {
  set({
    kind: 'merge',
    create: CLOSED_CREATE,
    merge: { target, busy: true },
    delete: undefined,
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

/** Remove the merged worktree from the merge-done view. */
export function cleanupMerged(rpc: (m: string, a?: unknown) => Promise<unknown>): Promise<void> {
  if (state.kind !== 'merge' || state.merge === undefined) return Promise.resolve()
  const target = state.merge.target
  set({ ...state, merge: { ...state.merge, busy: true, error: undefined } })
  return rpc('remove', { cwd: target.path, slug: target.slug, force: false })
    .then(() => { set({ kind: 'closed', create: CLOSED_CREATE }) })
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
    create: CLOSED_CREATE,
    merge: undefined,
    delete: { target, busy: false, armed: !target.dirty },
  })
}

/** Arm the force step for a dirty target. */
export function armDelete(): void {
  if (state.kind !== 'delete' || state.delete === undefined) return
  set({ ...state, delete: { ...state.delete, armed: true } })
}

/** Execute the removal from the delete modal. */
export function executeDelete(rpc: (m: string, a?: unknown) => Promise<unknown>): Promise<void> {
  if (state.kind !== 'delete' || state.delete === undefined || !state.delete.armed) return Promise.resolve()
  const target = state.delete.target
  set({ ...state, delete: { ...state.delete, busy: true, error: undefined } })
  return rpc('remove', { cwd: target.path, slug: target.slug, force: target.dirty })
    .then(() => { set({ kind: 'closed', create: CLOSED_CREATE }) })
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

/** Edit the name field. */
export function setCreateName(name: string): void {
  if (state.kind !== 'create') return
  set({ ...state, create: { ...state.create, name } })
}

/** Mark the create flow busy (submit in flight). */
export function setCreateBusy(busy: boolean, error?: string): void {
  if (state.kind !== 'create') return
  set({ ...state, create: { ...state.create, busy, error } })
}

/** Reset for tests. */
export function resetModalStore(): void {
  set(INITIAL)
}

/**
 * The full create flow, driven from the modal's confirm button.
 *
 * Order matters: the worktree exists before the workspace is registered
 * (the workspace path must resolve), the session exists before the bind
 * (the bind claims the row for the session), and the open comes last so
 * the user lands in the bound session.
 *
 * @param input - the current modal state plus the service/RPC faces.
 */
export async function runCreateFlow(input: {
  readonly state: CreateModalState
  readonly rpc: (method: string, args?: unknown) => Promise<unknown>
  readonly workspaces: { create(a: { path: string }): Promise<{ workspaceId: string }> }
  readonly sessions: { create(a: { workspaceId: string }): Promise<string>; open(id: string): void }
  readonly onTopologyRefresh: () => void
}): Promise<void> {
  const { state: modal, rpc, workspaces, sessions, onTopologyRefresh } = input
  setCreateBusy(true)
  try {
    const created = await rpc('create', {
      cwd: modal.repoPath,
      name: modal.name === modal.suggestion ? undefined : modal.name,
    }) as {
      slug: string
      path: string
      relPath: string
    }
    const workspacePath = created.relPath === ''
      ? created.path
      : `${created.path}/${created.relPath}`
    const workspace = await workspaces.create({ path: workspacePath })
    const sessionId = await sessions.create({ workspaceId: workspace.workspaceId })
    await rpc('bind', { sessionId })
    sessions.open(sessionId)
    set({ kind: 'closed', create: CLOSED_CREATE })
    onTopologyRefresh()
  } catch (error) {
    setCreateBusy(false, error instanceof Error ? error.message : String(error))
  }
}
