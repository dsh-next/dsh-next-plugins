/**
 * Watch the current session's event window and, on a live `reset/handoff`
 * append, open the next session then archive the old one.
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
    getSnapshot(): { readonly current?: string }
    subscribe(listener: () => void): () => void
  }
  binding(id: string): { readonly eventSource: EventSourceLike } | undefined
  open(id: string): void
}

export interface WorkspacesLike {
  readonly list: {
    getSnapshot(): { readonly archivedSessionIds?: readonly string[] }
  }
  archiveSession(sessionId: string): Promise<void>
}

/** Subscribe to the current session follow window; dispose unsubscribes. */
export function watchResetHandoff(sessions: SessionsLike, workspaces: WorkspacesLike): () => void {
  let unsubSource: (() => void) | undefined
  let watched: string | undefined

  const follow = (): void => {
    const current = sessions.list.getSnapshot().current
    if (current === watched) return
    unsubSource?.()
    unsubSource = undefined
    if (current === undefined) {
      watched = undefined
      return
    }
    const binding = sessions.binding(current)
    if (binding === undefined) {
      watched = undefined
      return
    }
    watched = current
    const fromId = current
    unsubSource = binding.eventSource.subscribe(() => {
      void onAppend(fromId, binding.eventSource, sessions, workspaces)
    })
  }

  const offList = sessions.list.subscribe(follow)
  follow()
  return () => {
    offList()
    unsubSource?.()
  }
}

async function onAppend(
  fromId: string,
  source: EventSourceLike,
  sessions: SessionsLike,
  workspaces: WorkspacesLike,
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
          open: (id) => sessions.open(id),
          archive: (id) => workspaces.archiveSession(id),
        },
      })
    } catch {
      // A failed switch must not tear down the watcher.
    }
  }
}
