import { describe, expect, it, vi } from 'vitest'
import { RESET_HANDOFF } from '../src/core/handoff.ts'
import { watchResetHandoff, type EventSourceLike, type SessionsLike, type WorkspacesLike } from '../src/client/handoff.ts'

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

function makeSessions(source: EventSourceLike, current = 'old'): SessionsLike & {
  current: string | undefined
  opened: string[]
} {
  const listListeners = new Set<() => void>()
  const state = {
    current: current as string | undefined,
    opened: [] as string[],
  }
  const sessions: SessionsLike & { current: string | undefined; opened: string[] } = {
    get current() { return state.current },
    set current(value) { state.current = value },
    opened: state.opened,
    list: {
      getSnapshot: () => ({ current: state.current }),
      subscribe: (listener) => {
        listListeners.add(listener)
        return () => { listListeners.delete(listener) }
      },
    },
    binding: (id) => id === 'old' || id === state.current ? { eventSource: source } : undefined,
    open: (id) => {
      state.opened.push(id)
      state.current = id
      for (const listener of listListeners) listener()
    },
  }
  return sessions
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
  it('opens next then archives old on a live handoff append', async () => {
    const source = makeSource()
    const sessions = makeSessions(source)
    const workspaces = makeWorkspaces()
    const dispose = watchResetHandoff(sessions, workspaces)
    source.emit({
      kind: 'append',
      entries: [{ type: 'event', event: { type: RESET_HANDOFF, data: { nextSessionId: 'next' } } }],
    })
    await vi.waitFor(() => {
      expect(sessions.opened).toEqual(['next'])
      expect(workspaces.archiveSession).toHaveBeenCalledWith('old')
    })
    expect(sessions.opened[0]).toBe('next')
    dispose()
  })

  it('ignores history replace windows', async () => {
    const source = makeSource()
    const sessions = makeSessions(source)
    const workspaces = makeWorkspaces()
    watchResetHandoff(sessions, workspaces)
    source.emit({
      kind: 'replace',
      entries: [{ type: 'event', event: { type: RESET_HANDOFF, data: { nextSessionId: 'next' } } }],
    })
    await Promise.resolve()
    expect(sessions.opened).toEqual([])
    expect(workspaces.archiveSession).not.toHaveBeenCalled()
  })

  it('is idempotent when next is already current and old is archived', async () => {
    const source = makeSource()
    const sessions = makeSessions(source, 'next')
    const workspaces = makeWorkspaces(['old'])
    watchResetHandoff(sessions, workspaces)
    source.emit({
      kind: 'append',
      entries: [{ type: 'event', event: { type: RESET_HANDOFF, data: { nextSessionId: 'next' } } }],
    })
    await Promise.resolve()
    expect(sessions.opened).toEqual([])
    expect(workspaces.archiveSession).not.toHaveBeenCalled()
  })
})
