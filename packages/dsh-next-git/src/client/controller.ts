/**
 * The panel's state controller.
 *
 * One store per mount, framework-free (`getSnapshot` / `subscribe`), so React
 * binds it with `useSyncExternalStore` and jsdom tests drive it directly. It
 * owns:
 *
 * - the last read state and its phase (ready / degraded / failed);
 * - the sub-view (the stacked sections, or one file's diff);
 * - the refresh model (see `refresh.ts`);
 * - every write, each of which re-reads and can never leave the panel busy.
 *
 * Copy stays out: failures arrive as codes, and the components map them to
 * dictionary keys.
 */

import { asApiError, type GitApi } from './api.ts'
import { buildAgentPayload, type AgentPayload, type AgentVerb } from '../core/agent-verbs.ts'
import { RefreshScheduler, type RefreshReason } from './refresh.ts'
import type {
  DegradedState,
  DiffResult,
  DiffSide,
  GitFailure,
  HistoryPage,
  HookNotice,
  PanelState,
  PreflightAction,
  PreflightDecision,
  SetupReport,
  StatePayload,
} from '../core/types.ts'

/** The stacked sections whose header collapses its body. */
export type PanelSection = 'changes' | 'worktrees' | 'history'

/** Which surface the body is showing. */
export type PanelView =
  | { readonly kind: 'sections' }
  | { readonly kind: 'diff'; readonly path: string; readonly side: DiffSide }

/** Lifecycle of the panel's read state. */
export type PanelPhase = 'loading' | 'ready' | 'degraded' | 'failed'

/** The store's observable snapshot. */
export interface PanelSnapshot {
  readonly phase: PanelPhase
  readonly state: PanelState | null
  readonly degraded: DegradedState | null
  readonly failure: GitFailure | null
  readonly reason: RefreshReason
  /** Dictionary key of the write in flight, or null. */
  readonly busy: string | null
  /** A failed commit hook waiting for Retry or Cancel. */
  readonly hook: HookNotice | null
  /** Dictionary key of a one-shot notice (setup outcome), or null. */
  readonly notice: string | null
  /** Setup report of the last worktree create, when it ran any step. */
  readonly setup: { readonly slug: string; readonly report: SetupReport } | null
  readonly view: PanelView
  readonly diff: DiffResult | null
  readonly diffLoading: boolean
  readonly history: HistoryPage | null
  readonly historyLoading: boolean
  /** Per-section collapse state; every section starts open. */
  readonly collapsed: Readonly<Record<PanelSection, boolean>>
  readonly expandedCommit: string | null
  /** The commit message in the composer, mirrored so a hook Retry can repeat it. */
  readonly message: string
}

/** A store with the observable face React needs. */
export class PanelStore {
  private snapshot: PanelSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly scheduler: RefreshScheduler
  /** The last commit message seen by a failing hook, for Retry. */
  private pendingCommit: { message: string; amend: boolean } | null = null
  private requestId = 0
  private readonly sessionId: string
  private disposed = false
  /** A worktree comparison base the user picked; null means the default. */
  private worktreeBase: string | null = null
  /** The window the history section is showing, so a refresh keeps it. */
  private historyLimit = 30

  constructor(
    private readonly api: GitApi,
    sessionId: string,
    private readonly onError?: (message: string) => void,
  ) {
    this.sessionId = sessionId
    this.snapshot = {
      phase: 'loading',
      state: null,
      degraded: null,
      failure: null,
      reason: 'open',
      busy: null,
      hook: null,
      notice: null,
      setup: null,
      view: { kind: 'sections' },
      diff: null,
      diffLoading: false,
      history: null,
      historyLoading: false,
      collapsed: { changes: false, worktrees: false, history: false },
      expandedCommit: null,
      message: '',
    }
    this.scheduler = new RefreshScheduler({
      load: (reason) => this.load(reason),
      onError: (error) => this.reportError(error),
    })
  }

  /* ---------------------------------------------------------- observable */

  /** The current snapshot; a new object only when something changed. */
  getSnapshot = (): PanelSnapshot => this.snapshot

  /** Subscribe to changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Re-read the history section after a write that changes history.
   *
   * The section loads on first render, so a commit made afterwards would
   * otherwise stay invisible until the panel remounted.
   */
  private async reloadHistory(): Promise<void> {
    if (this.snapshot.history === null) return
    await this.loadHistory()
  }

  /** Shallow-patch the snapshot and notify; a disposed store never patches. */
  private patch(changes: Partial<PanelSnapshot>): void {
    if (this.disposed) return
    let changed = false
    for (const key of Object.keys(changes) as (keyof PanelSnapshot)[]) {
      if (this.snapshot[key] !== changes[key]) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.snapshot = { ...this.snapshot, ...changes }
    for (const listener of this.listeners) listener()
  }

  /* ------------------------------------------------------------ lifecycle */

  /** Initial read, then the DOM triggers. */
  async start(dom?: {
    addEventListener(type: string, listener: () => void): void
    removeEventListener(type: string, listener: () => void): void
  }): Promise<void> {
    await this.scheduler.request('open', true)
    if (dom !== undefined) this.bindDom(dom)
  }

  /** Wire focus/visibility triggers; returns the disposer. */
  bindDom(dom: {
    addEventListener(type: string, listener: () => void): void
    removeEventListener(type: string, listener: () => void): void
  }): () => void {
    const onFocus = (): void => this.scheduler.trigger('focus')
    const onVisibility = (): void => {
      if (typeof document === 'undefined' || !document.hidden) this.scheduler.trigger('visible')
    }
    dom.addEventListener('focus', onFocus)
    dom.addEventListener('visibilitychange', onVisibility)
    const off = (): void => {
      dom.removeEventListener('focus', onFocus)
      dom.removeEventListener('visibilitychange', onVisibility)
    }
    this.domDisposer = off
    return off
  }

  private domDisposer: (() => void) | null = null

  /** A refresh requested by the toolbar; resolves when the read settled. */
  async refresh(): Promise<void> {
    await this.scheduler.request('manual', true)
  }

  /** A refresh triggered by the session's agent finishing a turn. */
  agentTurnEnded(): void {
    this.scheduler.trigger('agent-turn')
  }

  /** Release listeners and pending waits. */
  dispose(): void {
    this.disposed = true
    this.scheduler.dispose()
    this.domDisposer?.()
    this.domDisposer = null
    this.listeners.clear()
  }

  /** Whether the panel has been disposed (late RPC replies must not patch). */
  get isDisposed(): boolean {
    return this.disposed
  }

  /* ---------------------------------------------------------------- reads */

  /** One read: the whole panel state. */
  private async load(reason: RefreshReason): Promise<{ changed: boolean }> {
    this.patch({ reason, ...(this.snapshot.state === null ? { phase: 'loading' as const } : {}) })
    try {
      const payload = await this.api.call<StatePayload>('getState', {
        sessionId: this.sessionId,
        ...(this.worktreeBase === null ? {} : { base: this.worktreeBase }),
      })
      const changed = payload.state.head.oid !== this.snapshot.state?.head.oid
        || payload.state.changes.staged.length !== this.snapshot.state?.changes.staged.length
        || payload.state.changes.unstaged.length !== this.snapshot.state?.changes.unstaged.length
        || payload.state.changes.untracked.length !== this.snapshot.state?.changes.untracked.length
      this.patch({
        phase: 'ready',
        state: payload.state,
        degraded: null,
        failure: null,
      })
      return { changed }
    } catch (error) {
      const api = asApiError(error)
      if (api.degraded !== null) {
        this.patch({ phase: 'degraded', degraded: api.degraded, failure: api.failure, state: null })
      } else {
        this.patch({
          phase: this.snapshot.state === null ? 'failed' : 'ready',
          failure: api.failure,
        })
      }
      this.onError?.(api.failure.code)
      return { changed: false }
    }
  }

  /** Open one file's diff in place of the sections. */
  async openDiff(path: string, side: DiffSide, oldPath?: string): Promise<void> {
    const request = ++this.requestId
    this.patch({ view: { kind: 'diff', path, side }, diff: null, diffLoading: true })
    try {
      const result = await this.api.call<DiffResult>('getDiff', {
        sessionId: this.sessionId,
        path,
        side,
        ...(oldPath === undefined ? {} : { oldPath }),
      })
      if (this.disposed || request !== this.requestId) return
      this.patch({ diff: result, diffLoading: false })
    } catch (error) {
      if (this.disposed || request !== this.requestId) return
      this.patch({ diffLoading: false })
      this.reportError(error)
    }
  }

  /** Return to the stacked sections. */
  closeDiff(): void {
    this.requestId += 1
    this.patch({ view: { kind: 'sections' }, diff: null, diffLoading: false })
  }

  /** Load a page of history (called when the section first opens). */
  async loadHistory(limit = this.historyLimit): Promise<void> {
    this.historyLimit = limit
    this.patch({ historyLoading: true })
    try {
      const page = await this.api.call<HistoryPage>('getHistory', {
        sessionId: this.sessionId,
        limit,
      })
      this.patch({ history: page, historyLoading: false })
    } catch (error) {
      this.patch({ historyLoading: false })
      this.reportError(error)
    }
  }

  /**
   * Collapse or expand one section.
   *
   * Sections are independent: an answer in this panel is rarely the only one
   * the user wants, so opening History does not close Changes.
   */
  toggleSection(section: PanelSection): void {
    const collapsed = { ...this.snapshot.collapsed, [section]: !this.snapshot.collapsed[section] }
    this.patch({ collapsed })
  }

  /** Whether one section's body is hidden. */
  isCollapsed(section: PanelSection): boolean {
    return this.snapshot.collapsed[section]
  }

  /** Expand one commit row's actions. */
  toggleCommit(hash: string): void {
    this.patch({ expandedCommit: this.snapshot.expandedCommit === hash ? null : hash })
  }

  /** Mirror the composer's message so Retry can repeat it. */
  setMessage(message: string): void {
    this.patch({ message })
  }

  /** Dismiss the one-shot notice banner. */
  dismissNotice(): void {
    this.patch({ notice: null, setup: null })
  }

  /* --------------------------------------------------------------- writes */

  /**
   * Run one write: mark busy, replace state with the reply, clear busy.
   *
   * @param label - dictionary key naming the write.
   * @param run - the RPC call; its resolved state becomes the new read state.
   */
  private async write(label: string, run: () => Promise<PanelState>): Promise<void> {
    this.patch({ busy: label, failure: null })
    try {
      const state = await run()
      if (this.disposed) return
      this.patch({ state, phase: 'ready', failure: null })
    } catch (error) {
      this.reportError(error)
    } finally {
      if (!this.disposed) this.patch({ busy: null })
    }
  }

  stage(paths: readonly string[]): Promise<void> {
    return this.write('busy.stage', () => this.api.call<PanelState>('stage', { sessionId: this.sessionId, paths }))
  }

  unstage(paths: readonly string[]): Promise<void> {
    return this.write('busy.unstage', () => this.api.call<PanelState>('unstage', { sessionId: this.sessionId, paths }))
  }

  /** Discard runs only after the panel confirmed it (preflight or the danger dialog). */
  discard(paths: readonly string[]): Promise<void> {
    return this.write('busy.discard', () => this.api.call<PanelState>('discard', { sessionId: this.sessionId, paths }))
  }

  /** Commit the staged index; a hook failure lands in `hook` for Retry. */
  async commit(message: string, amend = false): Promise<void> {
    const body = message.trim()
    if (body === '') return
    this.pendingCommit = { message: body, amend }
    this.patch({ busy: 'busy.commit', failure: null, hook: null })
    try {
      const state = await this.api.call<PanelState>('commit', {
        sessionId: this.sessionId,
        message: body,
        amend,
        requestId: this.commitRequestId,
      })
      if (this.disposed) return
      this.pendingCommit = null
      this.patch({ state, phase: 'ready', hook: null, message: '' })
      await this.reloadHistory()
    } catch (error) {
      const api = asApiError(error)
      if (api.code === 'hook-failed' || api.code === 'hook-cancelled') {
        this.patch({
          hook: {
            hook: this.hookName(api.failure.detail),
            output: api.failure.detail,
            exitCode: api.failure.exitCode ?? 1,
            message: body,
          },
        })
      } else {
        this.reportError(error)
      }
    } finally {
      if (!this.disposed) this.patch({ busy: null })
    }
  }

  /**
   * Stage every change the panel can stage, then commit it.
   *
   * A conflicted path is left alone: `git commit` cannot commit one, and the
   * resolution belongs to whoever is resolving, not to a bulk action.
   */
  async commitAll(message: string): Promise<void> {
    const state = this.snapshot.state
    if (state === null) return
    const paths = [
      ...new Set([
        ...state.changes.staged.map((entry) => entry.path),
        ...state.changes.unstaged.filter((entry) => entry.unmerged === undefined).map((entry) => entry.path),
        ...state.changes.untracked.map((entry) => entry.path),
      ]),
    ]
    if (paths.length > 0) {
      await this.write('busy.stage', () =>
        this.api.call<PanelState>('stage', { sessionId: this.sessionId, paths }),
      )
    }
    await this.commit(message)
  }

  /** Cancel a commit whose hook is hanging. */
  async cancelCommit(): Promise<void> {
    try {
      await this.api.call<{ cancelled: boolean }>('cancelCommit', { requestId: this.commitRequestId })
    } catch (error) {
      this.reportError(error)
    }
  }

  /** Request id shared by commit and cancelCommit. */
  private commitRequestId = 'commit'

  /** Retry the commit a failed hook blocked. */
  retryCommit(): Promise<void> {
    const pending = this.pendingCommit
    if (pending === null) return Promise.resolve()
    return this.commit(pending.message, pending.amend)
  }

  /** Dismiss the hook-output section. */
  dismissHook(): void {
    this.patch({ hook: null })
  }

  /** The draft subject the host derives from the change list. */
  async draftMessage(): Promise<void> {
    this.patch({ busy: 'busy.draft' })
    try {
      const message = await this.api.call<string>('draftMessage', { sessionId: this.sessionId })
      if (!this.disposed) this.patch({ message })
    } catch (error) {
      this.reportError(error)
    } finally {
      if (!this.disposed) this.patch({ busy: null })
    }
  }

  /** The preflight verdict for an action; the panel shows the dialog it implies. */
  preflight(action: PreflightAction, target?: string): Promise<PreflightDecision> {
    return this.api.call<PreflightDecision>('preflight', {
      sessionId: this.sessionId,
      action,
      ...(target === undefined ? {} : { target }),
    })
  }

  private worktree<T>(method: string, args: Record<string, unknown>): Promise<T> {
    return this.api.call<T>(method, { sessionId: this.sessionId, ...args })
  }

  /** The comparison base the rows are measured against; null resets to default. */
  async setWorktreeBase(branch: string | null): Promise<void> {
    if (this.worktreeBase === branch) return
    this.worktreeBase = branch
    await this.scheduler.request('manual', true)
  }

  /** Create a worktree and surface its setup outcome. */
  async worktreeAdd(options: {
    mode: 'new' | 'ref'
    name?: string
    ref?: string
    refKind?: 'branch' | 'remote' | 'tag'
    base?: string
  }): Promise<void> {
    this.patch({ busy: 'busy.worktree-create', failure: null, notice: null, setup: null })
    try {
      const result = await this.worktree<
        { plan: { slug: string }; state: PanelState; setup: SetupReport; notice: string | null }
      >('worktreeAdd', {
        mode: options.mode,
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.ref === undefined ? {} : { ref: options.ref }),
        ...(options.refKind === undefined ? {} : { refKind: options.refKind }),
        ...(options.base === undefined ? {} : { base: options.base }),
      })
      if (this.disposed) return
      this.patch({
        state: result.state,
        phase: 'ready',
        setup: result.setup.ran > 0 ? { slug: result.plan.slug, report: result.setup } : null,
        notice: result.notice,
      })
    } catch (error) {
      this.reportError(error)
    } finally {
      if (!this.disposed) this.patch({ busy: null })
    }
  }

  worktreeRemove(path: string, force: boolean, deleteBranch = false): Promise<void> {
    return this.write('busy.worktree-remove', () =>
      this.worktree<PanelState>('worktreeRemove', { path, force, deleteBranch }),
    )
  }

  async worktreeMerge(path: string): Promise<void> {
    await this.write('busy.worktree-merge', () => this.worktree<PanelState>('worktreeMerge', { path }))
    await this.reloadHistory()
  }

  worktreeUpdate(path: string, base?: string): Promise<void> {
    return this.write('busy.worktree-update', () =>
      this.worktree<PanelState>('worktreeUpdate', { path, ...(base === undefined ? {} : { base }) }),
    )
  }

  worktreeUnlock(path: string): Promise<void> {
    return this.write('busy.worktree-unlock', () => this.worktree<PanelState>('worktreeUnlock', { path }))
  }

  worktreePrune(): Promise<void> {
    return this.write('busy.worktree-prune', () => this.worktree<PanelState>('worktreePrune', {}))
  }

  branchSwitch(name: string, remote?: string): Promise<void> {
    return this.write('busy.branch-switch', () =>
      this.api.call<PanelState>('branchSwitch', {
        sessionId: this.sessionId,
        name,
        ...(remote === undefined ? {} : { remote }),
      }),
    )
  }

  branchCreate(name: string, from?: string): Promise<void> {
    return this.write('busy.branch-create', () =>
      this.api.call<PanelState>('branchCreate', {
        sessionId: this.sessionId,
        name,
        ...(from === undefined ? {} : { from }),
      }),
    )
  }

  branchRename(from: string, to: string): Promise<void> {
    return this.write('busy.branch-rename', () =>
      this.api.call<PanelState>('branchRename', { sessionId: this.sessionId, from, to }),
    )
  }

  branchDelete(name: string, force = false): Promise<void> {
    return this.write('busy.branch-delete', () =>
      this.api.call<PanelState>('branchDelete', { sessionId: this.sessionId, name, force }),
    )
  }

  async operationContinue(): Promise<void> {
    await this.write('busy.continue', () =>
      this.api.call<PanelState>('operationContinue', { sessionId: this.sessionId }),
    )
    await this.reloadHistory()
  }

  operationAbort(): Promise<void> {
    return this.write('busy.abort', () =>
      this.api.call<PanelState>('operationAbort', { sessionId: this.sessionId }),
    )
  }

  async updateFromBranch(): Promise<void> {
    await this.write('busy.update', () =>
      this.api.call<PanelState>('updateFromBranch', { sessionId: this.sessionId }),
    )
    await this.reloadHistory()
  }

  async revert(hash: string): Promise<void> {
    await this.write('busy.revert', () =>
      this.api.call<PanelState>('revert', { sessionId: this.sessionId, hash }),
    )
    await this.reloadHistory()
  }

  async cherryPick(hash: string): Promise<void> {
    await this.write('busy.cherry-pick', () =>
      this.api.call<PanelState>('cherryPick', { sessionId: this.sessionId, hash }),
    )
    await this.reloadHistory()
  }

  async checkoutCommit(hash: string): Promise<void> {
    await this.write('busy.checkout', () =>
      this.api.call<PanelState>('checkoutCommit', { sessionId: this.sessionId, hash }),
    )
    await this.reloadHistory()
  }

  /* ------------------------------------------------------------ agent verbs */

  /**
   * Build an agent payload and hand it to the session.
   *
   * @param verb - which verb the user picked.
   * @param send - the transport (the session's queued prompt).
   * @returns the payload, so the panel can report what was truncated.
   */
  async runAgentVerb(
    verb: AgentVerb,
    send: (prompt: string) => Promise<void> | void,
  ): Promise<AgentPayload> {
    this.patch({ busy: 'busy.agent' })
    try {
      const result = await this.api.call<{
        state: PanelState
        files: Parameters<typeof buildAgentPayload>[0]['files']
      }>('agentFiles', { sessionId: this.sessionId })
      const payload = buildAgentPayload({ verb, state: result.state, files: result.files })
      await send(payload.prompt)
      this.patch({ notice: payload.truncated ? 'notice.truncated' : null })
      return payload
    } catch (error) {
      this.reportError(error)
      throw error
    } finally {
      if (!this.disposed) this.patch({ busy: null })
    }
  }

  /* --------------------------------------------------------------- errors */

  /** Record a failure, degrading the whole panel when git cannot answer at all. */
  private reportError(error: unknown): void {
    const api = asApiError(error)
    if (api.degraded !== null) {
      this.patch({ phase: 'degraded', degraded: api.degraded, failure: api.failure })
      return
    }
    this.patch({ failure: api.failure })
    this.onError?.(api.failure.code)
  }

  /** Dirty approximation of the hook that blocked a commit, for the panel's title. */
  private hookName(detail: string): string {
    const match = /(pre-commit|pre-push|commit-msg|prepare-commit-msg|pre-rebase)/.exec(detail)
    return match === null ? 'pre-commit' : match[1]!
  }
}
