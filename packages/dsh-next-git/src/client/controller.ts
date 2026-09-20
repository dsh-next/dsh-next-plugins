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
import { panelPreferences, type PanelPreferenceStore } from './preferences.ts'
import { computeGraphLanes } from '../core/log.ts'
import type { HistoryAction } from '../core/history-plan.ts'
import { emptyHistoryQuery, type HistoryQuery } from '../core/history-view.ts'
import { buildHistoryAgentPayload, type AgentCommitContext } from '../core/agent-history.ts'
import { buildAgentPayload, type AgentPayload, type AgentVerb } from '../core/agent-verbs.ts'
import type { WorktreeSetupPreview } from '../core/worktree-create.ts'
import { RefreshScheduler, type RefreshReason } from './refresh.ts'
import type {
  DegradedState,
  DiffResult,
  DiffSide,
  GitFailure,
  GitFailureCode,
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

/** One worktree create request, as the panel's form builds it. */
export interface WorktreeCreateRequest {
  readonly mode: 'new' | 'ref'
  readonly name?: string
  readonly ref?: string
  readonly refKind?: 'branch' | 'remote' | 'tag'
  readonly base?: string
}

/** The approvals a create carries, bound to the preview the user saw. */
export interface WorktreeCreateApproval {
  readonly setupApproved: boolean
  readonly copyApproved: boolean
  readonly expectedSetupVersion: string
}

/**
 * Dictionary key for a host setup notice code.
 *
 * The host reports machine codes; the panel renders dictionary keys, so this
 * mapping is the one place the two vocabularies meet. An unknown code is
 * dropped rather than rendered as a raw key.
 */
export function setupNoticeKey(code: string | null): string | null {
  switch (code) {
    case 'setup-invalid': return 'notice.setupInvalid'
    case 'setup-too-many': return 'notice.setupTooMany'
    case 'setup-unsafe-path': return 'notice.setupUnsafe'
    case 'setup-failed': return 'notice.setupFailed'
    case 'setup-skipped': return 'notice.setupSkipped'
    case 'copy-skipped': return 'notice.copySkipped'
    default: return null
  }
}

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
  readonly historyQuery: HistoryQuery
  /** Per-section collapse state; a new checkout starts folded. */
  readonly collapsed: Readonly<Record<PanelSection, boolean>>
  readonly expandedCommit: string | null
  /** The commit message in the composer, mirrored so a hook Retry can repeat it. */
  readonly message: string
}

/** Immutable context snapshot, reviewed before choosing a destination. */
export interface PreparedAgentAction {
  readonly payload: AgentPayload
  readonly state: PanelState
  readonly fingerprint: string
  readonly repositoryVersion?: string
  readonly availableFiles?: readonly string[]
}

export interface AgentActionScope {
  readonly paths?: readonly string[]
  readonly side?: DiffSide
  readonly commits?: readonly string[]
  readonly historyAction?: HistoryAction
  readonly includeSensitive?: boolean
}

/** A store with the observable face React needs. */
export class PanelStore {
  private snapshot: PanelSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly scheduler: RefreshScheduler
  /** The last commit message seen by a failing hook, for Retry. */
  private pendingCommit: { message: string; amend: boolean; all: boolean } | null = null
  private commitRequestId: string | null = null
  private historyRequestId = 0
  private historyHead: string | null = null
  private historyAnchor: string | null = null
  private stateRevision = 0
  private preferenceRoot: string | null = null
  private diffOldPath: string | undefined
  private requestId = 0
  private readonly sessionId: string
  private disposed = false
  /** A worktree comparison base the user picked; null means the default. */
  private worktreeBase: string | null = null
  /** The window the history section is showing, so a refresh keeps it. */
  private historyLimit = 30

  constructor(
    readonly api: GitApi,
    sessionId: string,
    private readonly onError?: (message: string) => void,
    private readonly preferences: PanelPreferenceStore = panelPreferences,
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
      historyQuery: emptyHistoryQuery,
      collapsed: { changes: true, worktrees: true, history: true },
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
    if (this.preferenceRoot !== null && ('message' in changes || 'collapsed' in changes)) {
      this.preferences.write(this.sessionId, this.preferenceRoot, {
        message: this.snapshot.message, collapsed: this.snapshot.collapsed,
      })
    }
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
  private async load(reason: RefreshReason, duringWrite = false): Promise<{ changed: boolean }> {
    const revision = this.stateRevision
    this.patch({ reason, ...(this.snapshot.state === null ? { phase: 'loading' as const } : {}) })
    try {
      const payload = await this.api.call<StatePayload>('getState', {
        sessionId: this.sessionId,
        ...(this.worktreeBase === null ? {} : { base: this.worktreeBase }),
      })
      if (this.disposed || revision !== this.stateRevision || (!duringWrite && this.snapshot.busy !== null)) return { changed: false }
      if (this.preferenceRoot !== payload.state.root) {
        this.preferenceRoot = payload.state.root
        const saved = this.preferences.read(this.sessionId, payload.state.root)
        this.patch(saved ?? { message: '', collapsed: { changes: true, worktrees: true, history: true } })
      }
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
      await this.refreshVisible()
      return { changed }
    } catch (error) {
      if (this.disposed || revision !== this.stateRevision) return { changed: false }
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

  /** Invalidate all visible reads, including after external/agent writes. */
  private async refreshVisible(): Promise<void> {
    const view = this.snapshot.view
    await Promise.all([
      this.snapshot.history === null && !this.snapshot.collapsed.history ? this.loadHistory() : this.reloadHistory(),
      view.kind === 'diff' ? this.openDiff(view.path, view.side, this.diffOldPath) : Promise.resolve(),
    ])
  }

  /** Open one file's diff in place of the sections. */
  async openDiff(path: string, side: DiffSide, oldPath?: string): Promise<void> {
    const request = ++this.requestId
    this.diffOldPath = oldPath
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

  async setHistoryQuery(query: HistoryQuery): Promise<void> {
    if (JSON.stringify(query) === JSON.stringify(this.snapshot.historyQuery)) return
    this.historyRequestId += 1
    this.historyAnchor = null
    this.historyLimit = 30
    this.patch({ historyQuery: { ...query }, history: null })
    await this.loadHistory()
  }

  /** Re-read a bounded window, paging instead of silently stopping at the host cap. */
  async loadHistory(limit = this.historyLimit): Promise<void> {
    this.historyLimit = Math.max(1, limit)
    await this.readHistory(this.historyLimit, [])
  }

  /** Append the next page; a changed HEAD starts a fresh, consistent window. */
  async loadMoreHistory(): Promise<void> {
    const history = this.snapshot.history
    if (this.snapshot.historyLoading || history === null || !history.hasMore) return
    this.historyLimit = history.commits.length + 30
    if (this.historyHead !== this.snapshot.state?.head.oid) {
      await this.loadHistory()
      return
    }
    await this.readHistory(30, history.commits)
  }

  private async readHistory(count: number, previous: HistoryPage['commits']): Promise<void> {
    const request = ++this.historyRequestId
    const head = this.snapshot.state?.head.oid ?? null
    const query = this.snapshot.historyQuery
    let anchor = previous.length > 0 ? this.historyAnchor : query.ref ?? head
    this.patch({ historyLoading: true })
    try {
      const commits = [...previous]
      let remaining = count
      let hasMore = false
      do {
        const page = await this.api.call<HistoryPage>('getHistory', {
          sessionId: this.sessionId,
          limit: Math.min(remaining, 500),
          ...(commits.length === 0 ? {} : { skip: commits.length }),
          ...(anchor === null ? {} : { ref: anchor }),
          ...(query.search === '' ? {} : { search: query.search }),
          ...(query.author === '' ? {} : { author: query.author }),
          ...(query.since === '' ? {} : { since: query.since }),
          ...(query.until === '' ? {} : { until: query.until }),
        })
        if (this.disposed || request !== this.historyRequestId) return
        anchor = page.anchor ?? anchor
        commits.push(...page.commits)
        remaining -= page.commits.length
        hasMore = page.hasMore && page.commits.length > 0
      } while (remaining > 0 && hasMore)
      this.historyHead = head
      this.historyAnchor = anchor
      this.patch({ history: { commits, lanes: computeGraphLanes(commits), hasMore }, historyLoading: false })
    } catch (error) {
      if (this.disposed || request !== this.historyRequestId) return
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
    if (section === 'history' && !collapsed.history && this.snapshot.history === null) void this.loadHistory()
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
    if (this.snapshot.busy !== null) return
    this.stateRevision += 1
    this.patch({ busy: label, failure: null })
    try {
      const state = await run()
      if (this.disposed) return
      this.patch({ state, phase: 'ready', failure: null })
      await this.refreshVisible()
    } catch (error) {
      // A failed Git command may still advance an operation to its next conflict.
      await this.load('manual', true)
      this.reportError(error)
    } finally {
      this.stateRevision += 1
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
  async commit(message: string, amend = false, all = false): Promise<void> {
    const body = message.trim()
    if (body === '' || this.snapshot.busy !== null) return
    if ((this.snapshot.state?.changes.conflicts.length ?? 0) > 0) {
      this.patch({ failure: { code: 'operation-in-progress', detail: '' } })
      return
    }
    this.pendingCommit = { message: body, amend, all }
    this.commitRequestId = this.sessionId + ':' + globalThis.crypto.randomUUID()
    this.stateRevision += 1
    this.patch({ busy: 'busy.commit', failure: null, hook: null })
    try {
      const state = await this.api.call<PanelState>(all ? 'commitAll' : 'commit', {
        sessionId: this.sessionId,
        message: body,
        amend,
        requestId: this.commitRequestId,
        ...(all && this.snapshot.state !== null ? {
          paths: [...new Set([
            ...this.snapshot.state.changes.staged,
            ...this.snapshot.state.changes.unstaged,
            ...this.snapshot.state.changes.untracked,
          ].map((entry) => entry.path))],
        } : {}),
      })
      if (this.disposed) return
      this.pendingCommit = null
      this.patch({ state, phase: 'ready', hook: null, message: '' })
      await this.refreshVisible()
    } catch (error) {
      await this.load('manual', true)
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
      this.commitRequestId = null
      this.stateRevision += 1
      if (!this.disposed) this.patch({ busy: null })
    }
  }

  /** Bulk staging and commit are one host transaction; a stage failure cannot commit. */
  async commitAll(message: string): Promise<void> {
    if (this.snapshot.state === null) return
    await this.commit(message, false, true)
  }


  /** Cancel a commit whose hook is hanging. */
  async cancelCommit(): Promise<void> {
    try {
      if (this.commitRequestId === null) return
      await this.api.call<{ cancelled: boolean }>('cancelCommit', { sessionId: this.sessionId, requestId: this.commitRequestId })
    } catch (error) {
      this.reportError(error)
    }
  }

  /** Retry the commit a failed hook blocked. */
  retryCommit(): Promise<void> {
    const pending = this.pendingCommit
    if (pending === null) return Promise.resolve()
    return this.commit(pending.message, pending.amend, pending.all)
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
      this.stateRevision += 1
      if (!this.disposed) this.patch({ busy: null })
    }
  }

  /**
   * Surface a preflight block as the named failure state without calling git.
   *
   * The host already knows why the write is refused and what to do about it;
   * repeating the write would only produce the same failure as git stderr.
   */
  showFailure(code: GitFailureCode, detail: string): void {
    this.patch({ failure: { code, detail } })
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

  /**
   * The setup a create would perform, for the confirmation step.
   *
   * Read-only. Null means the request itself is invalid, which the failure
   * banner already explains.
   */
  async worktreeSetup(options: WorktreeCreateRequest): Promise<WorktreeSetupPreview | null> {
    try {
      return await this.worktree<WorktreeSetupPreview>('worktreeSetup', { ...options })
    } catch (error) {
      this.reportError(error)
      return null
    }
  }

  /**
   * Create a worktree and surface its setup outcome.
   *
   * Returns whether the worktree exists afterwards, so the form keeps the
   * typed name when the create failed. Approvals are sent as the caller
   * received them: an absent approval means the host runs and copies nothing.
   */
  async worktreeAdd(
    options: WorktreeCreateRequest & Partial<WorktreeCreateApproval>,
  ): Promise<boolean> {
    this.patch({ busy: 'busy.worktree-create', failure: null, notice: null, setup: null })
    try {
      const result = await this.worktree<
        {
          plan: { slug: string }
          state: PanelState
          setup: SetupReport
          copied: readonly string[]
          notice: string | null
        }
      >('worktreeAdd', {
        mode: options.mode,
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.ref === undefined ? {} : { ref: options.ref }),
        ...(options.refKind === undefined ? {} : { refKind: options.refKind }),
        ...(options.base === undefined ? {} : { base: options.base }),
        ...(options.setupApproved === true ? { setupApproved: true } : {}),
        ...(options.copyApproved === true ? { copyApproved: true } : {}),
        ...(options.expectedSetupVersion === undefined
          ? {}
          : { expectedSetupVersion: options.expectedSetupVersion }),
      })
      if (this.disposed) return true
      this.patch({
        state: result.state,
        phase: 'ready',
        setup: result.setup.ran > 0 ? { slug: result.plan.slug, report: result.setup } : null,
        notice: setupNoticeKey(result.notice),
      })
      return true
    } catch (error) {
      this.reportError(error)
      return false
    } finally {
      this.stateRevision += 1
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

  operationSkip(): Promise<void> {
    return this.write('busy.continue', () => this.api.call<PanelState>('operationSkip', { sessionId: this.sessionId, approved: true }))
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

  /** Collect context without submitting a prompt or creating a session. */
  async prepareAgentAction(verb: AgentVerb, scope: AgentActionScope = {}): Promise<PreparedAgentAction> {
    if (scope.commits !== undefined) {
      const result = await this.api.call<{ state: PanelState; commits: AgentCommitContext[]; omittedCommits: string[]; fingerprint?: string }>(
        'historyAgentContext', { sessionId: this.sessionId, commits: scope.commits },
      )
      return {
        state: result.state,
        payload: buildHistoryAgentPayload({ ...result, verb, action: scope.historyAction }),
        fingerprint: result.fingerprint ?? JSON.stringify(result),
      }
    }
    const result = await this.api.call<{
      state: PanelState
      files: Parameters<typeof buildAgentPayload>[0]['files']
      omittedPaths?: readonly string[]
      fingerprint?: string
      repositoryVersion?: string
      availableFiles?: readonly string[]
    }>('agentFiles', { sessionId: this.sessionId, verb, ...scope })
    const payload = buildAgentPayload({ verb, state: result.state, files: result.files, omittedPaths: result.omittedPaths })
    return {
      payload, state: result.state, repositoryVersion: result.repositoryVersion, availableFiles: result.availableFiles,
      fingerprint: result.fingerprint ?? JSON.stringify({ head: result.state.head, root: result.state.root, cwd: result.state.cwd, operation: result.state.operation, files: result.files, omittedPaths: result.omittedPaths }),
    }
  }

  agentQueued(): void { this.patch({ notice: 'agent.sent' }) }


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
