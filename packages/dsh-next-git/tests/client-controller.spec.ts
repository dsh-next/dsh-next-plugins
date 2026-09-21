import { describe, expect, it, vi } from 'vitest'
import { GitApiError, type GitApi } from '../src/client/api.ts'
import { PanelStore } from '../src/client/controller.ts'
import type { PanelState } from '../src/core/types.ts'

/**
 * Controller wiring: the refresh model, every write path, and the failure
 * states the panel renders. The host half is contract-tested separately; this
 * suite proves the browser half turns envelopes into the snapshot the UI
 * reads (and turns a named failure into the right phase).
 */

/** A minimal panel state for the store to hold. */
function state(overrides: Partial<PanelState> = {}): PanelState {
  return {
    root: '/repo',
    gitDir: '/repo/.git',
    bare: false,
    head: {
      oid: 'aaaaaaaa',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      detached: false,
      unborn: false,
    },
    operation: { kind: null, step: null, message: null, conflicts: [] },
    changes: {
      staged: [{ path: 'a.ts', xy: 'M.', untracked: false, ignored: false, index: 'modified' }],
      unstaged: [{ path: 'b.ts', xy: '.M', untracked: false, ignored: false, worktree: 'modified' }],
      untracked: [],
      ignored: [],
      conflicts: [],
      ignoredCount: 0,
      ignoredTruncated: false,
    },
    worktrees: [],
    worktreeBase: { name: 'origin/main', source: 'default-branch', candidates: ['main'] },
    branches: [{ name: 'main', current: true, oid: 'aaaaaaaa', upstream: 'origin/main', remote: false, author: 'A', committedAt: 1, ahead: 0, behind: 0, subject: 'tip' }],
    tags: [],
    identity: { name: 'A', email: 'a@b' },
    cwd: '/repo',
    ...overrides,
  }
}

/** A scripted API double. */
function api(script: Record<string, unknown | (() => unknown)>): {
  api: GitApi
  calls: { method: string; args: Record<string, unknown> }[]
} {
  const calls: { method: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    api: {
      async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
        calls.push({ method, args })
        if (!(method in script)) throw new GitApiError({ code: 'git-failed', detail: `no script for ${method}` }, null)
        const entry = script[method]
        const value = typeof entry === 'function' ? (entry as () => unknown)() : entry
        if (value instanceof Error) throw value
        return value as T
      },
    },
  }
}

/** A store over one scripted API. */
function store(script: Record<string, unknown | (() => unknown)>, sessionId = `s${Math.random()}`): {
  store: PanelStore
  calls: { method: string; args: Record<string, unknown> }[]
} {
  const double = api(script)
  return { store: new PanelStore(double.api, sessionId), calls: double.calls }
}

describe('panel store reads', () => {
  it('starts in loading and settles into ready on the first read', async () => {
    const { store: panel } = store({ getState: { state: state(), notice: null } })
    expect(panel.getSnapshot().phase).toBe('loading')
    await panel.start()
    expect(panel.getSnapshot()).toMatchObject({ phase: 'ready', reason: 'open' })
    expect(panel.getSnapshot().state?.head.branch).toBe('main')
    expect(panel.getSnapshot().degraded).toBeNull()
    panel.dispose()
  })

  it('notifies subscribers only when something changed', async () => {
    const { store: panel } = store({ getState: { state: state(), notice: null } })
    const listener = vi.fn()
    const off = panel.subscribe(listener)
    await panel.start()
    await panel.refresh()
    const afterRefresh = listener.mock.calls.length
    expect(afterRefresh).toBeGreaterThan(0)
    off()
    panel.setMessage('x')
    expect(listener.mock.calls.length).toBe(afterRefresh)
    panel.dispose()
  })

  it('enters the degraded phase on a terminal failure', async () => {
    const { store: panel } = store({
      getState: new GitApiError(
        { code: 'not-a-repository', detail: '/tmp' },
        { code: 'not-a-repository', detail: '/tmp', requiredVersion: null, installedVersion: null },
      ),
    })
    await panel.start()
    expect(panel.getSnapshot().phase).toBe('degraded')
    expect(panel.getSnapshot().degraded?.code).toBe('not-a-repository')
    expect(panel.getSnapshot().state).toBeNull()
    panel.dispose()
  })

  // Reproduction of the restart bug: a restored tab asks for state before the
  // host has loaded the session, and the panel must recover on its own rather
  // than latching a terminal "not in a git repository" state until the tab is
  // reopened by hand.
  it('retries while the session is not ready and heals without user action', async () => {
    vi.useFakeTimers()
    try {
      let ready = false
      const { store: panel, calls } = store({
        getState: () => {
          if (!ready) {
            throw new GitApiError({ code: 'session-not-ready', detail: 'session has no working directory' }, null)
          }
          return { state: state(), notice: null }
        },
      })
      await panel.start()
      expect(panel.getSnapshot()).toMatchObject({ phase: 'loading', state: null, failure: null })
      expect(panel.getSnapshot().degraded).toBeNull()

      ready = true
      await vi.advanceTimersByTimeAsync(20_000)
      expect(panel.getSnapshot()).toMatchObject({ phase: 'ready', failure: null })
      expect(panel.getSnapshot().state?.root).toBe('/repo')
      expect(calls.filter((call) => call.method === 'getState').length).toBeGreaterThan(1)
      panel.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a named state and reports once after the fast retry window', async () => {
    vi.useFakeTimers()
    try {
      const errors: string[] = []
      const double = api({
        getState: new GitApiError({ code: 'session-not-ready', detail: 'session has no working directory' }, null),
      })
      const panel = new PanelStore(double.api, 'session-budget', (message) => errors.push(message))
      await panel.start()
      const attempts = (): number => double.calls.filter((call) => call.method === 'getState').length
      expect(panel.getSnapshot().phase).toBe('loading')
      // Fast window: quiet retries, no named state and no repeated toast.
      await vi.advanceTimersByTimeAsync(60_000)
      const fast = attempts()
      expect(fast).toBeGreaterThan(10)
      expect(panel.getSnapshot().phase).toBe('failed')
      expect(panel.getSnapshot().failure?.code).toBe('session-not-ready')
      expect(errors).toHaveLength(1)
      // After it, retries slow right down but never stop: a session opened
      // later still heals the panel, and the failure is reported only once.
      await vi.advanceTimersByTimeAsync(180_000)
      const slow = attempts() - fast
      expect(slow).toBeGreaterThan(0)
      expect(slow).toBeLessThan(fast)
      expect(errors).toHaveLength(1)
      panel.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores the retry budget when the user asks again', async () => {
    vi.useFakeTimers()
    try {
      let ready = false
      const { store: panel } = store({
        getState: () => {
          if (!ready) throw new GitApiError({ code: 'session-not-ready', detail: 'session has no working directory' }, null)
          return { state: state(), notice: null }
        },
      })
      await panel.start()
      await vi.advanceTimersByTimeAsync(180_000)
      expect(panel.getSnapshot().phase).toBe('failed')
      expect(panel.getSnapshot().failure?.code).toBe('session-not-ready')
      ready = true
      // A deliberate trigger retries immediately instead of waiting for the
      // slow cadence.
      await panel.refresh()
      expect(panel.getSnapshot()).toMatchObject({ phase: 'ready', failure: null })
      panel.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never retries a real not-a-repository failure, and stops retrying after dispose', async () => {
    vi.useFakeTimers()
    try {
      const { store: panel, calls } = store({
        getState: new GitApiError(
          { code: 'not-a-repository', detail: '/tmp/plain' },
          { code: 'not-a-repository', detail: '/tmp/plain', requiredVersion: null, installedVersion: null },
        ),
      })
      await panel.start()
      await vi.advanceTimersByTimeAsync(180_000)
      expect(panel.getSnapshot().phase).toBe('degraded')
      expect(calls.filter((call) => call.method === 'getState')).toHaveLength(1)
      panel.dispose()

      const retrying = store({
        getState: new GitApiError({ code: 'session-not-ready', detail: 'session has no working directory' }, null),
      })
      await retrying.store.start()
      retrying.store.dispose()
      const after = retrying.calls.filter((call) => call.method === 'getState').length
      await vi.advanceTimersByTimeAsync(180_000)
      expect(retrying.calls.filter((call) => call.method === 'getState')).toHaveLength(after)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the last state and records a non-terminal failure', async () => {
    let failing = false
    const { store: panel } = store({
      getState: () => {
        if (failing) {
          throw new GitApiError({ code: 'index-locked', detail: 'index.lock' }, null)
        }
        return { state: state(), notice: null }
      },
    })
    await panel.start()
    failing = true
    await panel.refresh()
    expect(panel.getSnapshot().phase).toBe('ready')
    expect(panel.getSnapshot().state).not.toBeNull()
    expect(panel.getSnapshot().failure?.code).toBe('index-locked')
    panel.dispose()
  })

  it('reports a failed first read as the failed phase', async () => {
    const { store: panel } = store({
      getState: new GitApiError({ code: 'git-failed', detail: 'boom' }, null),
    })
    await panel.start()
    expect(panel.getSnapshot().phase).toBe('failed')
    expect(panel.getSnapshot().failure?.detail).toBe('boom')
    panel.dispose()
  })

  it('refreshes on demand and from the agent-turn trigger', async () => {
    const { store: panel, calls } = store({ getState: { state: state(), notice: null } })
    await panel.start()
    await panel.refresh()
    panel.agentTurnEnded()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls.filter((call) => call.method === 'getState').length).toBeGreaterThanOrEqual(3)
    panel.dispose()
  })

  it('sends the session id with every call', async () => {
    const { store: panel, calls } = store({ getState: { state: state(), notice: null } }, 'session-1')
    await panel.start()
    expect(calls[0]!.args).toMatchObject({ sessionId: 'session-1' })
    panel.dispose()
  })
})

describe('section collapse', () => {
  it('starts with every section collapsed', async () => {
    const { store: panel } = store({ getState: { state: state(), notice: null } })
    await panel.start()
    expect(panel.getSnapshot().collapsed).toEqual({ changes: true, worktrees: true, history: true })
    expect(panel.isCollapsed('changes')).toBe(true)
    panel.dispose()
  })

  it('opens only one section and reads history only when its accordion opens', async () => {
    const { store: panel, calls } = store({ getState: { state: state(), notice: null }, getHistory: { commits: [], lanes: [], hasMore: false } })
    await panel.start()
    expect(calls.some(call => call.method === 'getHistory')).toBe(false)

    for (const section of ['changes', 'worktrees', 'history', 'changes'] as const) {
      panel.toggleSection(section)
      expect(panel.getSnapshot().collapsed).toEqual({ changes: true, worktrees: true, history: true, [section]: false })
    }
    await vi.waitFor(() => expect(panel.getSnapshot().history).not.toBeNull())
    expect(calls.filter(call => call.method === 'getHistory')).toHaveLength(1)

    panel.toggleSection('changes')
    expect(panel.getSnapshot().collapsed).toEqual({ changes: true, worktrees: true, history: true })
    panel.toggleSection('history')
    expect(panel.getSnapshot().collapsed).toEqual({ changes: true, worktrees: true, history: false })
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'getHistory')).toHaveLength(2))
    panel.dispose()
  })

  it('keeps the collapse state across a refresh', async () => {
    const { store: panel } = store({ getState: { state: state(), notice: null } })
    await panel.start()
    panel.toggleSection('changes')
    await panel.refresh()
    expect(panel.isCollapsed('changes')).toBe(false)
    panel.dispose()
  })
})

describe('diff view', () => {
  it('opens and closes a file diff', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      getDiff: { path: 'a.ts', side: 'staged', file: { added: 2, removed: 1, patch: 'p', hunks: [] }, empty: false },
    })
    await panel.start()
    await panel.openDiff('a.ts', 'staged', 'old-a.ts')
    expect(panel.getSnapshot().view).toEqual({ kind: 'diff', path: 'a.ts', side: 'staged' })
    expect(panel.getSnapshot().diffLoading).toBe(false)
    expect(calls.find((call) => call.method === 'getDiff')?.args).toMatchObject({
      path: 'a.ts',
      side: 'staged',
      oldPath: 'old-a.ts',
    })
    panel.closeDiff()
    expect(panel.getSnapshot().view).toEqual({ kind: 'sections' })
    expect(panel.getSnapshot().diff).toBeNull()
    panel.dispose()
  })

  it('records a failed diff as a failure and stops loading', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      getDiff: new GitApiError({ code: 'path-missing', detail: 'gone' }, null),
    })
    await panel.start()
    await panel.openDiff('gone.ts', 'unstaged')
    expect(panel.getSnapshot().diffLoading).toBe(false)
    expect(panel.getSnapshot().failure?.code).toBe('path-missing')
    panel.dispose()
  })

  it('ignores a stale diff reply after the view moved on', async () => {
    let release: (() => void) | undefined
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      getDiff: () =>
        new Promise((resolve) => {
          release = () => resolve({ path: 'slow.ts', side: 'unstaged', file: null, empty: true })
        }),
    })
    await panel.start()
    const pending = panel.openDiff('slow.ts', 'unstaged')
    panel.closeDiff()
    release?.()
    await pending
    expect(panel.getSnapshot().view).toEqual({ kind: 'sections' })
    expect(panel.getSnapshot().diff).toBeNull()
    panel.dispose()
  })
})

describe('history', () => {
  it('retains checkout and refreshes an already loaded recent list', async () => {
    const initial = state()
    const detached = state({ head: { ...initial.head, branch: null, oid: 'b'.repeat(40) } })
    const { store: panel, calls } = store({
      getState: { state: initial, notice: null },
      checkoutCommit: detached,
      getHistory: { commits: [], lanes: [], hasMore: false },
    }, 'checkout-history')
    await panel.start()
    panel.toggleSection('history')
    await vi.waitFor(() => expect(panel.getSnapshot().history).not.toBeNull())
    await panel.checkoutCommit(detached.head.oid!)
    expect(calls.find(call => call.method === 'checkoutCommit')?.args).toEqual({ sessionId: 'checkout-history', hash: detached.head.oid })
    expect(calls.filter(call => call.method === 'getHistory')).toHaveLength(2)
    expect(calls.at(-1)).toEqual({ method: 'getHistory', args: { sessionId: 'checkout-history', limit: 30, anchor: detached.head.oid } })
    expect(panel.getSnapshot().state?.head).toEqual(detached.head)
    panel.dispose()
  })

  it('reads only the current checkout and follows header branch changes', async () => {
    const main = state()
    const topic = state({ head: { ...main.head, branch: 'topic', oid: 'b'.repeat(40) } })
    const { store: panel, calls } = store({
      getState: { state: main, notice: null },
      branchSwitch: topic,
      getHistory: { commits: [], lanes: [], hasMore: false },
    }, 'history-branch-switch')
    await panel.start()
    panel.toggleSection('history')
    await vi.waitFor(() => expect(panel.getSnapshot().history).not.toBeNull())
    expect(calls.at(-1)).toEqual({ method: 'getHistory', args: { sessionId: 'history-branch-switch', limit: 30, anchor: main.head.oid } })
    await panel.branchSwitch('topic')
    expect(calls.filter(call => call.method === 'getHistory')).toHaveLength(2)
    expect(calls.filter(call => call.method === 'getHistory').at(-1)?.args).toEqual({ sessionId: 'history-branch-switch', limit: 30, anchor: topic.head.oid })
    panel.dispose()
  })
  it('loads a recent commit page', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      getHistory: { commits: [], lanes: [], hasMore: false },
    })
    await panel.start()
    await panel.loadHistory(10)
    expect(panel.getSnapshot().history).toEqual({ commits: [], lanes: [], hasMore: false })
    panel.dispose()
  })

  it('does not refresh previously loaded history while its accordion is closed', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      getHistory: { commits: [], lanes: [], hasMore: false },
    })
    await panel.start()
    panel.toggleSection('history')
    await vi.waitFor(() => expect(panel.getSnapshot().history).not.toBeNull())
    panel.toggleSection('history')
    const loaded = calls.filter(call => call.method === 'getHistory').length

    await panel.refresh()
    expect(calls.filter(call => call.method === 'getHistory')).toHaveLength(loaded)

    panel.toggleSection('history')
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'getHistory')).toHaveLength(loaded + 1))
    panel.dispose()
  })

  it('records a failed history read', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      getHistory: new GitApiError({ code: 'git-failed', detail: 'no log' }, null),
    })
    await panel.start()
    await panel.loadHistory()
    expect(panel.getSnapshot().historyLoading).toBe(false)
    expect(panel.getSnapshot().failure?.detail).toBe('no log')
    panel.dispose()
  })
})

describe('writes', () => {
  it('stage sets busy, replaces the state and clears busy', async () => {
    const seen: (string | null)[] = []
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      stage: () => {
        seen.push(panel.getSnapshot().busy)
        return state({ changes: { ...state().changes, staged: [], unstaged: [] } })
      },
    })
    await panel.start()
    await panel.stage(['b.ts'])
    expect(seen).toEqual(['busy.stage'])
    expect(panel.getSnapshot().busy).toBeNull()
    expect(panel.getSnapshot().state?.changes.staged).toEqual([])
    panel.dispose()
  })

  it('records a failed write without leaving the panel busy', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      unstage: new GitApiError({ code: 'path-missing', detail: 'gone' }, null),
    })
    await panel.start()
    await panel.unstage(['x.ts'])
    expect(panel.getSnapshot().busy).toBeNull()
    expect(panel.getSnapshot().failure?.code).toBe('path-missing')
    panel.dispose()
  })

  it('commits and clears the composer message', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      commit: state({ changes: { ...state().changes, staged: [] } }),
    })
    await panel.start()
    panel.setMessage('feat: thing')
    await panel.commit('feat: thing')
    expect(calls.find((call) => call.method === 'commit')?.args).toMatchObject({
      message: 'feat: thing',
      requestId: expect.any(String),
    })
    expect(panel.getSnapshot().message).toBe('')
    panel.dispose()
  })

  it('re-reads the history section after a commit', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      getHistory: { commits: [], lanes: [], hasMore: false },
      commit: state({ changes: { ...state().changes, staged: [] } }),
    })
    await panel.start()
    panel.toggleSection('history')
    await vi.waitFor(() => expect(panel.getSnapshot().history).not.toBeNull())
    await panel.loadHistory(15)
    const before = calls.filter((call) => call.method === 'getHistory').length
    await panel.commit('feat: thing')
    // The section was already loaded, so the new commit must appear without a
    // remount.
    expect(calls.filter((call) => call.method === 'getHistory')).toHaveLength(before + 1)
    expect(calls.filter((call) => call.method === 'getHistory').pop()?.args).toMatchObject({ limit: 15 })
    panel.dispose()
  })

  it('does not touch history when the section was never opened', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      commit: state({ changes: { ...state().changes, staged: [] } }),
    })
    await panel.start()
    await panel.commit('feat: thing')
    expect(calls.some((call) => call.method === 'getHistory')).toBe(false)
    panel.dispose()
  })

  it('commits the staged index with one request id and reports success', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      commit: state({ changes: { ...state().changes, staged: [] } }),
    })
    await panel.start()
    expect(await panel.commit('feat: one')).toBe(true)
    expect(calls.map((call) => call.method)).toEqual(['getState', 'commit'])
    expect(calls[1]!.args).toMatchObject({ message: 'feat: one' })
    expect(panel.getSnapshot().message).toBe('')
    panel.dispose()
  })

  it('refuses a commit while any path remains conflicted', async () => {
    const conflicted = state({
      changes: {
        ...state().changes,
        conflicts: [{ path: 'c.ts', xy: 'UU', untracked: false, ignored: false, index: 'unmerged', worktree: 'unmerged', unmerged: 'both-modified' }],
        unstaged: [
          ...state().changes.unstaged,
          { path: 'c.ts', xy: 'UU', untracked: false, ignored: false, index: 'unmerged', worktree: 'unmerged', unmerged: 'both-modified' },
        ],
      },
    })
    const { store: panel, calls } = store({
      getState: { state: conflicted, notice: null },
      commit: conflicted,
    })
    await panel.start()
    expect(await panel.commit('feat: one')).toBe(false)
    expect(calls.map((call) => call.method)).toEqual(['getState'])
    expect(panel.getSnapshot().failure?.code).toBe('operation-in-progress')
    panel.dispose()
  })


  it('ignores an empty commit message', async () => {
    const { store: panel, calls } = store({ getState: { state: state(), notice: null } })
    await panel.start()
    await panel.commit('   ')
    expect(calls.some((call) => call.method === 'commit')).toBe(false)
    panel.dispose()
  })

  it('moves a failing hook into the hook section and retries it', async () => {
    let attempts = 0
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      commit: () => {
        attempts += 1
        if (attempts === 1) {
          throw new GitApiError(
            { code: 'hook-failed', detail: 'husky - pre-commit hook exited with code 1\nboom', exitCode: 1 },
            null,
          )
        }
        return state()
      },
    })
    await panel.start()
    await panel.commit('feat: hooky')
    expect(panel.getSnapshot().hook).toMatchObject({ hook: 'pre-commit', exitCode: 1 })
    expect(panel.getSnapshot().hook?.output).toContain('boom')
    expect(panel.getSnapshot().busy).toBeNull()
    await panel.retryCommit()
    expect(panel.getSnapshot().hook).toBeNull()
    expect(calls.filter((call) => call.method === 'commit')).toHaveLength(2)
    panel.dispose()
  })

  it('defaults the hook name when the output names none', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      commit: new GitApiError({ code: 'hook-failed', detail: 'failed', exitCode: 2 }, null),
    })
    await panel.start()
    await panel.commit('feat: x')
    expect(panel.getSnapshot().hook?.hook).toBe('pre-commit')
    panel.dismissHook()
    expect(panel.getSnapshot().hook).toBeNull()
    panel.dispose()
  })

  it('treats a cancelled hook as a hook failure too', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      commit: new GitApiError({ code: 'hook-cancelled', detail: 'commit cancelled' }, null),
    })
    await panel.start()
    await panel.commit('feat: x')
    expect(panel.getSnapshot().hook).not.toBeNull()
    panel.dispose()
  })

  it('cancels only its in-flight operation and sends its session ownership', async () => {
    let release!: (value: PanelState) => void
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      commit: () => new Promise<PanelState>((resolve) => { release = resolve }),
      cancelCommit: { cancelled: true },
    }, 'cancel-session')
    await panel.start()
    await panel.cancelCommit()
    expect(calls.some((call) => call.method === 'cancelCommit')).toBe(false)
    const pending = panel.commit('feat: cancellable')
    await panel.cancelCommit()
    const commitId = calls.find((call) => call.method === 'commit')!.args.requestId
    expect(commitId).toMatch(/^cancel-session:/)
    expect(calls.find((call) => call.method === 'cancelCommit')?.args).toEqual({ sessionId: 'cancel-session', requestId: commitId })
    release(state())
    await pending
    await panel.cancelCommit()
    expect(calls.filter((call) => call.method === 'cancelCommit')).toHaveLength(1)
    panel.dispose()
  })

  it('drafts a message into the composer', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      draftMessage: 'Update src: app.ts',
    })
    await panel.start()
    await panel.draftMessage()
    expect(panel.getSnapshot().message).toBe('Update src: app.ts')
    expect(panel.getSnapshot().busy).toBeNull()
    panel.dispose()
  })

  it('records a failed draft', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      draftMessage: new GitApiError({ code: 'git-failed', detail: 'nope' }, null),
    })
    await panel.start()
    await panel.draftMessage()
    expect(panel.getSnapshot().failure?.detail).toBe('nope')
    panel.dispose()
  })

  it('creates a worktree and surfaces the setup report', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      worktreeAdd: {
        plan: { slug: 'feature', path: '/repo/.worktrees/feature', branch: 'dsh-git/feature', base: 'main', setup: [] },
        state: state(),
        setup: { ran: 2, failed: true, output: 'boom' },
        notice: 'setup-failed',
      },
    })
    await panel.start()
    await panel.worktreeAdd({ mode: 'new', name: 'feature' })
    expect(panel.getSnapshot().setup).toEqual({ slug: 'feature', report: { ran: 2, failed: true, output: 'boom' } })
    // The host reports a machine code; the panel shows a dictionary key.
    expect(panel.getSnapshot().notice).toBe('notice.setupFailed')
    panel.dismissNotice()
    expect(panel.getSnapshot().notice).toBeNull()
    expect(panel.getSnapshot().setup).toBeNull()
    panel.dispose()
  })

  it('previews the declared setup and forwards only the approvals given', async () => {
    const preview = {
      root: '/repo',
      slug: 'feature',
      path: '/repo/.worktrees/feature',
      branch: 'dsh-git/feature',
      base: 'main',
      baseOid: 'a'.repeat(40),
      version: 'setup-v9',
      steps: [{ kind: 'command', command: 'pnpm install' }],
      includePaths: ['.env'],
      notice: null,
    }
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      worktreeSetup: preview,
      worktreeAdd: {
        plan: { slug: 'feature' },
        state: state(),
        setup: { ran: 0, failed: false, output: '' },
        copied: [],
        notice: 'setup-skipped',
      },
    })
    await panel.start()
    expect(await panel.worktreeSetup({ mode: 'new', name: 'feature' })).toEqual(preview)
    const created = await panel.worktreeAdd({
      mode: 'new',
      name: 'feature',
      setupApproved: true,
      expectedSetupVersion: 'setup-v9',
    })
    expect(created).toBe(true)
    expect(calls.find((call) => call.method === 'worktreeAdd')?.args).toMatchObject({
      name: 'feature',
      setupApproved: true,
      expectedSetupVersion: 'setup-v9',
    })
    // An approval that was not given never reaches the host.
    expect(calls.find((call) => call.method === 'worktreeAdd')?.args).not.toHaveProperty('copyApproved')
    expect(panel.getSnapshot().notice).toBe('notice.setupSkipped')
    panel.dispose()
  })

  it('reports a failed create without clearing the panel state', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      worktreeAdd: new GitApiError({ code: 'setup-stale', detail: 'setup' }, null),
    })
    await panel.start()
    const created = await panel.worktreeAdd({ mode: 'new', name: 'feature', setupApproved: true })
    expect(created).toBe(false)
    expect(panel.getSnapshot().failure?.code).toBe('setup-stale')
    panel.dispose()
  })

  it('drops an unknown setup notice code instead of rendering a raw key', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      worktreeAdd: {
        plan: { slug: 'x' },
        state: state(),
        setup: { ran: 0, failed: false, output: '' },
        notice: 'setup-not-object',
      },
    })
    await panel.start()
    await panel.worktreeAdd({ mode: 'new', name: 'x' })
    expect(panel.getSnapshot().notice).toBeNull()
    panel.dispose()
  })

  it('does not surface a setup section when no step ran', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      worktreeAdd: {
        plan: { slug: 'x', path: '/repo/.worktrees/x', branch: 'dsh-git/x', base: 'main', setup: [] },
        state: state(),
        setup: { ran: 0, failed: false, output: '' },
        notice: null,
      },
    })
    await panel.start()
    await panel.worktreeAdd({ mode: 'new', name: 'x' })
    expect(panel.getSnapshot().setup).toBeNull()
    panel.dispose()
  })

  it('routes the worktree, branch and history writes through their methods', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      worktreeRemove: state(),
      worktreeMerge: state(),
      worktreeUpdate: state(),
      branchSwitch: state(),
      branchCreate: state(),
      branchRename: state(),
      branchDelete: state(),
      operationContinue: state(),
      operationAbort: state(),
      updateFromBranch: state(),
      checkoutCommit: state(),
      getHistory: { commits: [], lanes: [], hasMore: false },
    })
    await panel.start()
    await panel.worktreeRemove('/repo/.worktrees/x', true, true)
    await panel.worktreeMerge('/repo/.worktrees/x')
    await panel.worktreeUpdate('/repo/.worktrees/x')
    await panel.branchSwitch('feature')
    await panel.branchCreate('feature', 'main')
    await panel.branchRename('a', 'b')
    await panel.branchDelete('b', true)
    await panel.operationContinue()
    await panel.operationAbort()
    await panel.updateFromBranch()
    await panel.checkoutCommit('abc')
    expect(calls.map((call) => call.method)).toEqual([
      'getState',
      'worktreeRemove',
      'worktreeMerge',
      'worktreeUpdate',
      'branchSwitch',
      'branchCreate',
      'branchRename',
      'branchDelete',
      'operationContinue',
      'operationAbort',
      'updateFromBranch',
      'checkoutCommit',
    ])
    // History is re-read only when the section is actually showing, which it
    // is not in this test.
    expect(calls.find((call) => call.method === 'worktreeRemove')?.args).toMatchObject({
      path: '/repo/.worktrees/x',
      force: true,
      deleteBranch: true,
    })
    panel.dispose()
  })

  it('runs the preflight call verbatim', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      preflight: { verdict: 'confirm', code: 'dirty-tree', paths: ['a.ts'], detail: 'discard' },
    })
    await panel.start()
    const decision = await panel.preflight('discard')
    expect(decision).toMatchObject({ verdict: 'confirm' })
    expect(calls.find((call) => call.method === 'preflight')?.args).toEqual({
      sessionId: calls[0]!.args.sessionId,
      action: 'discard',
    })
    panel.dispose()
  })
})

describe('agent verbs', () => {
  it.each(['review', 'explain', 'draft', 'resolve'] as const)('collects %s context through the file-scoped RPC', async (verb) => {
    const { store: panel, calls } = store({
      agentFiles: { state: state(), files: [], fingerprint: 'context', repositoryVersion: 'repository', availableFiles: ['a.ts'] },
    }, 'file-agent')
    const scope = { paths: ['a.ts'], side: 'staged' as const, includeSensitive: true }
    const prepared = await panel.prepareAgentAction(verb, scope)
    expect(calls).toEqual([{ method: 'agentFiles', args: { sessionId: 'file-agent', verb, ...scope } }])
    expect(prepared).toMatchObject({ fingerprint: 'context', repositoryVersion: 'repository', availableFiles: ['a.ts'], payload: { verb } })
    panel.dispose()
  })

  it('prepares context without performing an AI submission', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      agentFiles: {
        state: state(),
        files: [{ path: 'a.ts', patch: 'diff', added: 1, removed: 1, binary: false, staged: true }],
      },
    })
    await panel.start()
    const prepared = await panel.prepareAgentAction('review')
    expect(prepared.payload.verb).toBe('review')
    expect(prepared.payload.prompt).toContain('Repository: /repo')
    expect(prepared.payload.prompt).toContain('- a.ts (staged, +1/-1)')
    expect(prepared.fingerprint).toContain('aaaaaaaa')
    expect(panel.getSnapshot().busy).toBeNull()
    panel.dispose()
  })

  it('shows a truncation notice when the payload was clipped', async () => {
    const files = Array.from({ length: 45 }, (_, index) => ({
      path: `f${index}.ts`,
      patch: 'diff',
      added: 1,
      removed: 0,
      binary: false,
      staged: false,
    }))
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      agentFiles: { state: state(), files },
    })
    await panel.start()
    const prepared = await panel.prepareAgentAction('explain')
    expect(prepared.payload.truncated).toBe(true)
    expect(prepared.payload.droppedFiles).toHaveLength(5)
    panel.dispose()
  })

  it('propagates a failed collection as a failure', async () => {
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      agentFiles: new GitApiError({ code: 'git-failed', detail: 'no files' }, null),
    })
    await panel.start()
    await expect(panel.prepareAgentAction('draft')).rejects.toBeInstanceOf(GitApiError)
    // The chooser owns presentation; collection cannot mutate the panel or submit.
    expect(panel.getSnapshot().failure).toBeNull()
    expect(panel.getSnapshot().busy).toBeNull()
    panel.dispose()
  })
})

describe('lifecycle', () => {
  it('binds and unbinds the dom triggers', async () => {
    const listeners = new Map<string, () => void>()
    const dom = {
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    }
    const { store: panel, calls } = store({ getState: { state: state(), notice: null } })
    await panel.start(dom)
    expect(listeners.has('focus')).toBe(true)
    listeners.get('focus')?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls.filter((call) => call.method === 'getState').length).toBeGreaterThanOrEqual(2)
    panel.dispose()
    expect(listeners.size).toBe(0)
    expect(panel.isDisposed).toBe(true)
  })

  it('drops a late reply after dispose', async () => {
    let release: (() => void) | undefined
    const { store: panel } = store({
      getState: () =>
        new Promise((resolve) => {
          release = () => resolve({ state: state(), notice: null })
        }),
    })
    const running = panel.start()
    panel.dispose()
    release?.()
    await running
    expect(panel.getSnapshot().phase).toBe('loading')
  })

  it('reports errors to the injected reporter', async () => {
    const reported: string[] = []
    const double = api({ getState: new GitApiError({ code: 'dirty-tree', detail: 'x' }, null) })
    const panel = new PanelStore(double.api, 's1', (code) => reported.push(code))
    await panel.start()
    expect(reported).toEqual(['dirty-tree'])
    panel.dispose()
  })
})

describe('worktree verbs', () => {
  it('re-reads with the base the panel picked, then clears it', async () => {
    const { store: panel, calls } = store({ getState: { state: state(), notice: null } })
    await panel.start()
    calls.length = 0
    await panel.setWorktreeBase('origin/main')
    expect(calls.filter((call) => call.method === 'getState').at(-1)?.args).toMatchObject({
      base: 'origin/main',
    })
    calls.length = 0
    await panel.setWorktreeBase(null)
    expect(calls.filter((call) => call.method === 'getState').at(-1)?.args).not.toHaveProperty('base')
    panel.dispose()
  })

  it('dispatches ref-mode create, unlock and prune', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      worktreeAdd: {
        plan: { slug: 'feature' },
        state: state(),
        setup: { ran: 0, failed: false, output: '' },
        notice: null,
      },
      worktreeUnlock: state(),
      worktreePrune: state(),
    })
    await panel.start()
    await panel.worktreeAdd({ mode: 'ref', ref: 'feature', refKind: 'branch' })
    expect(calls.find((call) => call.method === 'worktreeAdd')?.args).toMatchObject({
      mode: 'ref',
      ref: 'feature',
      refKind: 'branch',
    })
    await panel.worktreeUnlock('/repo/.worktrees/x')
    expect(calls.find((call) => call.method === 'worktreeUnlock')?.args).toMatchObject({
      path: '/repo/.worktrees/x',
    })
    await panel.worktreePrune()
    expect(calls.some((call) => call.method === 'worktreePrune')).toBe(true)
    panel.dispose()
  })

  it('passes a chosen base to worktree update', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      worktreeUpdate: state(),
    })
    await panel.start()
    await panel.worktreeUpdate('/repo/.worktrees/x', 'release')
    expect(calls.find((call) => call.method === 'worktreeUpdate')?.args).toMatchObject({
      path: '/repo/.worktrees/x',
      base: 'release',
    })
    panel.dispose()
  })
})

describe('audited safety and freshness regressions', () => {
  it('reports a failed commit, keeps the message and never retries on its own', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      commit: new GitApiError({ code: 'path-missing', detail: 'staging failed' }, null),
    })
    await panel.start()
    panel.setMessage('all changes')
    expect(await panel.commit('all changes')).toBe(false)
    expect(calls.filter((call) => call.method === 'commit')).toHaveLength(1)
    expect(calls.some((call) => call.method === 'commitAll' || call.method === 'stage')).toBe(false)
    expect(panel.getSnapshot()).toMatchObject({ message: 'all changes', failure: { code: 'path-missing' }, busy: null })
    panel.dispose()
  })

  it('gives each attempt a unique ID and refuses a second commit while busy', async () => {
    let release!: (value: PanelState) => void
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      commit: () => new Promise<PanelState>((resolve) => { release = resolve }),
    })
    await panel.start()
    const first = panel.commit('one')
    await panel.commit('duplicate')
    expect(calls.filter((call) => call.method === 'commit')).toHaveLength(1)
    release(state())
    await first
    const second = panel.commit('two')
    release(state())
    await second
    const ids = calls.filter((call) => call.method === 'commit').map((call) => call.args.requestId)
    expect(new Set(ids).size).toBe(2)
    panel.dispose()
  })

  it('restores drafts and collapse preferences after remount without retaining a live store', async () => {
    const id = 'persistent-' + Math.random()
    const first = store({ getState: { state: state(), notice: null } }, id).store
    await first.start()
    first.setMessage('keep this draft')
    first.toggleSection('history')
    first.dispose()
    const second = store({ getState: { state: state(), notice: null } }, id).store
    await second.start()
    expect(second.getSnapshot()).toMatchObject({ message: 'keep this draft', collapsed: { history: false, changes: true } })
    second.dispose()
    const other = store({ getState: { state: state({ root: '/other' }), notice: null } }, id).store
    await other.start()
    expect(other.getSnapshot()).toMatchObject({ message: '', collapsed: { history: true } })
    other.dispose()
  })

  it('refreshes only the visible diff, then reloads open history when returning', async () => {
    const { store: panel, calls } = store({
      getState: { state: state(), notice: null },
      getHistory: { commits: [], lanes: [], hasMore: false },
      getDiff: { path: 'new.ts', side: 'unstaged', file: null, empty: true },
    })
    await panel.start()
    panel.toggleSection('history')
    await vi.waitFor(() => expect(panel.getSnapshot().history).not.toBeNull())
    await panel.openDiff('new.ts', 'unstaged', 'old.ts')
    calls.length = 0

    await panel.refresh()
    expect(calls.map((call) => call.method)).toEqual(['getState', 'getDiff'])
    expect(calls[1]!.args.oldPath).toBe('old.ts')

    panel.closeDiff()
    await vi.waitFor(() => expect(calls.filter(call => call.method === 'getHistory')).toHaveLength(1))
    panel.dispose()
  })

  it('re-reads operation state after a mutation fails while preserving the failure', async () => {
    const conflicted = state({ operation: { kind: 'merge', step: null, message: null, conflicts: ['a.ts'] } })
    const { store: panel } = store({
      getState: { state: conflicted, notice: null },
      worktreeMerge: new GitApiError({ code: 'git-failed', detail: 'merge stopped' }, null),
    })
    await panel.start()
    await panel.worktreeMerge('/repo/.worktrees/x')
    expect(panel.getSnapshot()).toMatchObject({ state: { operation: { kind: 'merge' } }, failure: { detail: 'merge stopped' }, busy: null })
    panel.dispose()
  })

  it('does not replace a newer history read with an older reply', async () => {
    const releases: ((value: unknown) => void)[] = []
    const { store: panel } = store({
      getState: { state: state(), notice: null },
      getHistory: () => new Promise((resolve) => { releases.push(resolve) }),
    })
    await panel.start()
    const old = panel.loadHistory(10)
    const current = panel.loadHistory(20)
    releases[1]!({ commits: [], lanes: [], hasMore: false })
    await current
    releases[0]!({ commits: [], lanes: [], hasMore: true })
    await old
    expect(panel.getSnapshot().history?.hasMore).toBe(false)
    panel.dispose()
  })

  it('appends beyond 500 and refreshes the loaded window in bounded requests', async () => {
    const commits = Array.from({ length: 535 }, (_, i) => ({ hash: String(i), short: String(i), parents: [String(i + 1)], subject: 'Commit ' + i, author: 'A', timestamp: i, refs: [] }))
    const calls: Record<string, unknown>[] = []
    const panel = new PanelStore({
      async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
        if (method === 'getState') return { state: state(), notice: null } as T
        calls.push(args)
        const skip = Number(args.skip ?? 0), limit = Number(args.limit)
        const page = commits.slice(skip, skip + limit)
        return { commits: page, lanes: [], hasMore: skip + page.length < commits.length } as T
      },
    }, 'pagination')
    await panel.start()
    panel.toggleSection('history')
    await vi.waitFor(() => expect(panel.getSnapshot().history).not.toBeNull())
    await panel.loadHistory(500)
    await panel.loadMoreHistory()
    expect(panel.getSnapshot().history?.commits).toHaveLength(530)
    expect(calls.at(-1)).toMatchObject({ skip: 500, limit: 30, anchor: 'aaaaaaaa' })
    await panel.refresh()
    expect(panel.getSnapshot().history?.commits).toHaveLength(530)
    expect(calls.every((args) => Number(args.limit) <= 500)).toBe(true)
    await panel.loadMoreHistory()
    expect(panel.getSnapshot().history).toMatchObject({ commits, hasMore: false })
    const before = calls.length
    await panel.loadMoreHistory()
    expect(calls).toHaveLength(before)
    panel.dispose()
  })
})
