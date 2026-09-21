/**
 * Watch every live session binding and, on a live `reset/handoff` append, open
 * the next session then archive the old one. Current clients keep selection in
 * uiWorkspace rather than the session catalog, so selection is not the watch seam.
 */
import { handoffNextId } from '../core/handoff.ts'
import { openThenArchive } from '../core/switch.ts'

export interface EventLike {
  readonly type: string
  readonly data?: unknown
}

export interface EventSourceLike {
  getSnapshot(): {
    readonly change: {
      readonly kind: string
      readonly entries?: readonly { readonly type: string; readonly event: EventLike }[]
    }
  }
  subscribe(listener: () => void): () => void
}

export interface SessionsLike {
  readonly list: {
    getSnapshot(): {
      /** Current selection on legacy clients. */
      readonly current?: string
      /** Catalog ids on current clients, where selection moved into uiWorkspace. */
      readonly ids?: readonly string[]
    }
    subscribe(listener: () => void): () => void
  }
  binding(id: string): { readonly eventSource: EventSourceLike } | undefined
}

/**
 * Show an already-created session.
 *
 * The caller resolves whichever service the host exposes for navigation; this
 * module never assumes a method name that the live session service may not
 * have.
 */
export type NavigatePort = (sessionId: string) => boolean

export interface WorkspacesLike {
  readonly list: {
    getSnapshot(): { readonly archivedSessionIds?: readonly string[] }
  }
  archiveSession(sessionId: string): Promise<void>
}

/** Subscribe to every live session event window; dispose unsubscribes all. */
export function watchResetHandoff(
  sessions: SessionsLike,
  workspaces: WorkspacesLike,
  navigate: NavigatePort,
): () => void {
  const watched = new Map<string, () => void>()

  const follow = (): void => {
    const snapshot = sessions.list.getSnapshot()
    // Current clients removed selection from the session catalog, so observe
    // every live binding. Legacy clients expose only `current` and keep the
    // original single-session behavior.
    const ids = snapshot.ids ?? (snapshot.current === undefined ? [] : [snapshot.current])
    const active = new Set(ids)
    for (const [id, off] of watched) {
      if (active.has(id)) continue
      off()
      watched.delete(id)
    }
    for (const id of ids) {
      if (watched.has(id)) continue
      const binding = sessions.binding(id)
      if (binding === undefined) continue
      watched.set(id, binding.eventSource.subscribe(() => {
        void onAppend(id, binding.eventSource, sessions, workspaces, navigate)
      }))
    }
  }

  const offList = sessions.list.subscribe(follow)
  follow()
  return () => {
    offList()
    for (const off of watched.values()) off()
    watched.clear()
  }
}

async function onAppend(
  fromId: string,
  source: EventSourceLike,
  sessions: SessionsLike,
  workspaces: WorkspacesLike,
  navigate: NavigatePort,
): Promise<void> {
  const change = source.getSnapshot().change
  if (change.kind !== 'append' || change.entries === undefined) return
  for (const entry of change.entries) {
    if (entry.type !== 'event') continue
    const nextId = handoffNextId(entry.event)
    if (nextId === undefined) continue
    const archivedIds = workspaces.list.getSnapshot().archivedSessionIds ?? []
    try {
      await openThenArchive({
        fromId,
        nextId,
        currentId: sessions.list.getSnapshot().current,
        archivedIds,
        ports: {
          open: (id) => navigate(id),
          archive: (id) => workspaces.archiveSession(id),
        },
      })
    } catch {
      // A failed switch must not tear down the watcher.
    }
  }
}
