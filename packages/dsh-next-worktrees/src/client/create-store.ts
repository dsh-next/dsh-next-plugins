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

export type ModalKind = 'closed' | 'create'

export interface ModalState {
  readonly kind: ModalKind
  readonly create: CreateModalState
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
  })
}

/** Close whatever modal is open (Escape, mask click, cancel). */
export function closeModal(): void {
  if (state.create.busy) return
  set({ kind: 'closed', create: CLOSED_CREATE })
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
