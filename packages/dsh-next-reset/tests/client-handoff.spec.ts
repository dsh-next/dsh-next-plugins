import { describe, expect, it, vi } from 'vitest'
import { RESET_HANDOFF } from '../src/core/handoff.ts'
import {
  watchResetHandoff,
  type EventSourceLike,
  type NavigatePort,
  type SessionsLike,
  type WorkspacesLike,
} from '../src/client/handoff.ts'

function makeSource(): EventSourceLike & {
  emit(change: { kind: string; entries?: { type: string; event: { type: string; data?: unknown } }[] }): void
} {
  const listeners = new Set<() => void>()
  let snapshot: ReturnType<EventSourceLike['getSnapshot']> = {
    change: { kind: 'replace', entries: [] },
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    emit(change) {
      snapshot = { change: { kind: change.kind, entries: change.entries ?? [] } }
      for (const listener of listeners) listener()
    },
  }
}

/**
 * A session list plus the navigation the entry would hand in. Navigation is a
 * separate port on purpose: the live session service has no `open`, so the
 * switch never assumes one.
 */
function makeSessions(source: EventSourceLike, current = 'old'): {
  sessions: SessionsLike
  opened: string[]
  navigate: NavigatePort
} {
  const listListeners = new Set<() => void>()
  const opened: string[] = []
  let currentId: string | undefined = current
  const sessions: SessionsLike = {
    list: {
      getSnapshot: () => ({ current: currentId }),
      subscribe: (listener) => {
        listListeners.add(listener)
        return () => { listListeners.delete(listener) }
      },
    },
    binding: (id) => id === 'old' || id === currentId ? { eventSource: source } : undefined,
  }
  const navigate: NavigatePort = vi.fn((id: string) => {
    opened.push(id)
    currentId = id
    for (const listener of listListeners) listener()
    return true
  })
  return { sessions, opened, navigate }
}

function makeWorkspaces(archived: string[] = []): WorkspacesLike & { archived: string[] } {
  const archivedIds = [...archived]
  return {
    archived: archivedIds,
    list: { getSnapshot: () => ({ archivedSessionIds: archivedIds }) },
    archiveSession: vi.fn(async (id: string) => { archivedIds.push(id) }),
  }
}

describe('watchResetHandoff', () => {
  it('opens next through the navigation port, then archives old', async () => {
    const source = makeSource()
    const { sessions, opened, navigate } = makeSessions(source)
    const workspaces = makeWorkspaces()
    const dispose = watchResetHandoff(sessions, workspaces, navigate)
    source.emit({
      kind: 'append',
      entries: [{ type: 'event', event: { type: RESET_HANDOFF, data: { nextSessionId: 'next' } } }],
    })
    await vi.waitFor(() => {
      expect(opened).toEqual(['next'])
      expect(workspaces.archiveSession).toHaveBeenCalledWith('old')
    })
    expect(navigate).toHaveBeenCalledWith('next')
    dispose()
  })

  it('ignores history replace windows', async () => {
    const source = makeSource()
    const { sessions, opened, navigate } = makeSessions(source)
    const workspaces = makeWorkspaces()
    watchResetHandoff(sessions, workspaces, navigate)
    source.emit({
      kind: 'replace',
      entries: [{ type: 'event', event: { type: RESET_HANDOFF, data: { nextSessionId: 'next' } } }],
    })
    await Promise.resolve()
    expect(opened).toEqual([])
    expect(workspaces.archiveSession).not.toHaveBeenCalled()
  })

  it('keeps the old session when navigation reports it cannot switch', async () => {
    const source = makeSource()
    const { sessions } = makeSessions(source)
    const workspaces = makeWorkspaces()
    const navigate = vi.fn(() => false)
    watchResetHandoff(sessions, workspaces, navigate)
    source.emit({
      kind: 'append',
      entries: [{ type: 'event', event: { type: RESET_HANDOFF, data: { nextSessionId: 'next' } } }],
    })
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('next')
    })
    // No navigation means no archive: the user stays where they are.
    expect(workspaces.archiveSession).not.toHaveBeenCalled()
  })

  it('is idempotent when next is already current and old is archived', async () => {
    const source = makeSource()
    const { sessions, opened, navigate } = makeSessions(source, 'next')
    const workspaces = makeWorkspaces(['old'])
    watchResetHandoff(sessions, workspaces, navigate)
    source.emit({
      kind: 'append',
      entries: [{ type: 'event', event: { type: RESET_HANDOFF, data: { nextSessionId: 'next' } } }],
    })
    await Promise.resolve()
    expect(opened).toEqual([])
    expect(workspaces.archiveSession).not.toHaveBeenCalled()
  })
})
