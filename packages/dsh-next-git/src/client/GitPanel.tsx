/**
 * The Git tab's body: header, stacked sections (Changes / Worktrees /
 * History), the diff pane, and the danger confirmations.
 *
 * The panel is a narrow right-sidebar column, so every row is one line of
 * text plus a status badge, and actions appear on hover or focus. Chrome
 * values come from the Files tab (see panel.module.css); colors come only
 * from `--dsw-*` tokens; every string comes from this package's dictionaries.
 *
 * The manager verbs that need a running model are not here — the panel hands
 * its payload to the session through `onAgentVerb`, which the client entry
 * wires to the session's prompt.
 */
import * as React from 'react'
import {
  Button,
  HoverCard,
  IconBranchOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconCopyOutlineRegular,
  IconEllipsisOutlineRegular,
  FileTypeIcon,
  IconFolderOpenRegular,
  IconLoadingOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSparkleRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Menu,
  Modal,
  StateDot,
  Tag,
  Tooltip,
  writeClipboard,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { changeFileAddress, changeFileTitle, targetFileAddress, workspacePathFor } from '../core/address.ts'
import type { AgentVerb } from '../core/agent-verbs.ts'
import type { RefOption } from '../core/refs.ts'
import { filterRefs, partitionRefs, refOptions } from '../core/refs.ts'
import { asApiError } from './api.ts'
import { BranchPicker } from './branches/BranchPicker.tsx'
import { RefQuickPick } from './branches/RefQuickPick.tsx'
import { FileDiff } from './ui/FileDiff.tsx'
import { InlineMessageDraft } from './ai/InlineMessageDraft.tsx'
import type {
  CommitSummary,
  DiffSide,
  GitFailureCode,
  OperationKind,
  PanelState,
  PreflightAction,
  PreflightDecision,
  StatusEntry,
  WorktreeInfo,
} from '../core/types.ts'
import { normalizeSlug, validateSlug } from '../core/worktree.ts'
import { setupHasEffects, type WorktreeSetupPreview } from '../core/worktree-create.ts'
import { PanelStore, type PanelSection, type PanelSnapshot, type WorktreeCreateRequest } from './controller.ts'
import type { MessageKey } from './dictionaries.ts'
import classes from './panel.module.css'
import { AgentActionDialog, type AgentActionRequest, type AgentSessionControls } from './ai/action-dialog.tsx'
import { ConflictWorkspaceView } from './conflicts/ConflictWorkspace.tsx'
import { HistorySectionView } from './history/HistorySection.tsx'
import { CommitDetailsModal } from './history/CommitDetailsModal.tsx'
import { CompareModal } from './history/CompareModal.tsx'
import { HistoryActionModal } from './history/HistoryActionModal.tsx'
import type { HistoryAction } from '../core/history-plan.ts'
import { AgentResults } from './ai/AgentResults.tsx'
import type { AiTaskResults } from './ai/task-results.ts'
import { RepositoryActionDialog } from './repository/RepositoryActionDialog.tsx'
import type { RepositoryMenuCommand } from './repository/commands.ts'
import { RepositoryMenu } from './repository/RepositoryMenu.tsx'
import { WorktreeSetupDialog } from './worktrees/WorktreeSetupDialog.tsx'
import { HunkControls } from './changes/HunkControls.tsx'
import { useDialogFocus } from './ui/dialog-focus.ts'

/** The translator the slot framework injects for this package's namespace. */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/**
 * The enclosing tab face, as the slot framework binds it.
 *
 * Reading it is the panel's one call into a platform hook, and that hook
 * throws while the tab record is not committed — a state the shell passes
 * through transiently. It stays optional so a seat that hands no hook (a
 * partial share, which this seat does produce) leaves the rest of the panel
 * intact.
 */
export interface GitTabInfo {
  readonly tab: {
    readonly title: string
    readonly actions: { openResource(address: string, options?: unknown): void }
  }
}

/** Props the panel body needs beyond the framework's own shares. */
export interface GitPanelProps {
  readonly sessionId: string
  readonly useTabInfo?: (() => GitTabInfo) | undefined
  readonly t: Translate
  /**
   * Queue a prompt into the current session; the client entry wires this to
   * the session face. Without it the agent verbs are hidden rather than
   * silently doing nothing.
   */
  readonly agentSessions?: AgentSessionControls | undefined
  /**
   * Open a session whose checkout is the given worktree path; the client entry
   * wires this to the workspace navigation services. Without it the row omits
   * the action rather than offering one that does nothing.
   */
  readonly openWorktreeSession?: ((path: string) => Promise<void>) | undefined
  readonly registerCreatedWorktree?: ((path: string) => Promise<void>) | undefined
  readonly unregisterDeletedWorktree?: ((path: string) => Promise<void>) | undefined
}

/* ------------------------------------------------------------------ glyphs */

/** The branch glyph used in the chip and at the guide capsule. */
export function BranchGlyph({ size = 16 }: { size?: number }): React.ReactElement {
  return <IconBranchOutlineRegular size={size} />
}

/**
 * The unstage glyph: the platform's `+` with its vertical bar removed.
 *
 * The icon set has no minus, so this reuses the exact crossbar geometry of
 * `IconPlusOutlineRegular` in the same 16x16 filled-path style, which makes the
 * stage and unstage actions read as one pair.
 */
export function MinusGlyph({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M1.5 7.34961H14.5V8.65039H1.5V7.34961Z" fill="currentColor" />
    </svg>
  )
}

/* --------------------------------------------------------------- confirm UI */

/** One pending danger confirmation, derived from a preflight verdict. */
interface Confirmation {
  readonly title: TranslateKey
  readonly body: TranslateKey
  readonly params: Record<string, string | number>
  /** Host-reported paths and reason, shown verbatim under the body. */
  readonly detail?: string
  /** Label for the proceed button; the danger default is not always apt. */
  readonly confirmLabel?: TranslateKey
  readonly danger: boolean
  readonly run: () => void
}

type TranslateKey = MessageKey

/**
 * One History command waiting for its own modal. Inspect and Compare read; the
 * six action kinds are the only commits the host will be asked to rewrite.
 */
type HistoryModalRequest =
  | { readonly kind: 'inspect'; readonly commits: readonly CommitSummary[] }
  | { readonly kind: 'compare'; readonly commits: readonly CommitSummary[] }
  | { readonly kind: 'action'; readonly action: HistoryAction; readonly commits: readonly CommitSummary[] }

/* ------------------------------------------------------------------ helpers */

/**
 * The status mark a row shows: git's own letter, colored by what it means.
 * VS Code's SCM view reads the same way, which keeps the row scannable when
 * the file name and its directory share one line.
 */
function statusLetter(entry: StatusEntry): string {
  // Conflicts keep both letters (`UU`, `AA`), which is what git itself prints
  // and what tells the user which side is missing.
  if (entry.unmerged !== undefined) return entry.xy
  const kind = entry.index ?? entry.worktree
  switch (kind) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'typechange':
      return 'T'
    case 'untracked':
      return 'U'
    default:
      return 'M'
  }
}

/** The color class for one change's status letter. */
function statusClass(entry: StatusEntry): string {
  if (entry.unmerged !== undefined) return classes.statusDanger
  if (entry.index === 'deleted' || entry.worktree === 'deleted') return classes.statusDanger
  if (entry.untracked) return classes.statusSuccess
  if (entry.index === 'added' || entry.index === 'renamed' || entry.index === 'copied') return classes.statusSuccess
  if (entry.index === 'modified' || entry.worktree === 'modified') return classes.statusWarn
  return classes.statusQuiet
}

/** `a/b.ts` -> `b.ts`. */
function baseName(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? path : path.slice(at + 1)
}

/** Directory prefix of a path, for the row's second line. */
function dirName(path: string): string {
  const at = path.lastIndexOf('/')
  return at <= 0 ? '' : path.slice(0, at)
}

/* -------------------------------------------------------------- resilience */

/** The guard's state: the crash it caught, or none. */
interface PanelBoundaryState {
  readonly error: Error | null
}

/**
 * A crash guard for one subtree of this plugin.
 *
 * The slot runtime retires a registration that lets a render error escape:
 * the abdication is one-shot and final, the cell goes empty, and the tab stays
 * blank for the rest of the page's life while its chip keeps working. Every
 * crash therefore has to stay inside this plugin. The fallback is a render
 * function rather than an element because it reports what happened.
 *
 * `resetKey` clears a caught error when the surrounding content changes, so a
 * transient failure — a tab record not yet committed, say — heals on the next
 * meaningful render instead of pinning the fallback until a reload.
 */
export class PanelBoundary extends React.Component<
  {
    readonly renderFallback: (error: Error) => React.ReactNode
    readonly resetKey?: unknown
    readonly children: React.ReactNode
  },
  PanelBoundaryState
> {
  state: PanelBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PanelBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error): void {
    // The fallback names the failure for the user; the console keeps the stack.
    console.error('[dsh-next-git] panel render failed', error)
  }

  componentDidUpdate(previous: { readonly resetKey?: unknown }): void {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render(): React.ReactNode {
    const { error } = this.state
    return error === null ? this.props.children : this.props.renderFallback(error)
  }
}

/**
 * The panel's face when a render failed: what happened, and a way back.
 *
 * Showing the message here is deliberate — a silent blank pane is what this
 * whole guard exists to prevent, and the message is what makes the failure
 * reportable.
 */
export function PanelCrashed(props: {
  t: Translate
  error: Error
  onRetry: () => void
}): React.ReactElement {
  const detail = props.error.message.trim()
  return (
    <div className={classes.root} data-dsh-git="panel">
      <div className={classes.body} data-dsh-git="body">
        <div className={classes.banner} data-dsh-git="crashed">
          <div className={`${classes.bannerTitle} ${classes.bannerError}`}>
            <IconWarningOutlineRegular size={16} />
            <span>{props.t('state.renderFailed')}</span>
          </div>
          <div className={classes.bannerBody}>{props.t('state.renderFailedFix')}</div>
          {detail === '' ? null : <pre className={classes.hookOutput}>{detail}</pre>}
          <div className={classes.bannerActions}>
            <Button size="sm" variant="primary" onClick={props.onRetry}>
              {props.t('state.retry')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The panel's face when the seat handed it no session to read.
 *
 * A registered seat that renders nothing leaves an empty pane, so this state
 * still says what is happening rather than looking like a broken panel.
 */
export function GitPanelUnavailable(props: { t: Translate }): React.ReactElement {
  return (
    <div className={classes.root} data-dsh-git="panel">
      <div className={classes.body} data-dsh-git="body">
        <div className={classes.banner} data-dsh-git="no-session">
          <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
            <IconWarningOutlineRegular size={16} />
            <span>{props.t('state.noSession')}</span>
          </div>
          <div className={classes.bannerBody}>{props.t('state.noSessionFix')}</div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- panel */

export function GitPanel(props: GitPanelProps): React.ReactElement {
  // One crash must not cost the tab: the slot runtime retires a registration
  // that lets an error escape, and a retired registration renders an empty
  // cell for the rest of the page's life. Retry remounts the guard.
  const [attempt, setAttempt] = React.useState(0)
  return (
    <PanelBoundary
      key={attempt}
      renderFallback={(error) => (
        <PanelCrashed t={props.t} error={error} onRetry={() => setAttempt(attempt + 1)} />
      )}
    >
      <GitPanelBody {...props} />
    </PanelBoundary>
  )
}

function GitPanelBody(props: GitPanelProps): React.ReactElement {
  const { sessionId, t } = props
  const store = usePanelStore(sessionId)
  const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(null)
  // The ref picker: closed, on its browse step, or straight on the detached
  // list, which is what the repository's Checkout command opens.
  const [branchPicker, setBranchPicker] = React.useState<'closed' | 'browse' | 'detach'>('closed')
  const [repositoryAction, setRepositoryAction] = React.useState<RepositoryMenuCommand | null>(null)
  const [toolsOpen, setToolsOpen] = React.useState(false)
  const [agentRequest, setAgentRequest] = React.useState<AgentActionRequest | null>(null)
  const [conflictPath, setConflictPath] = React.useState<string | null>(null)
  const [historyModal, setHistoryModal] = React.useState<HistoryModalRequest | null>(null)
  // Commands that can change history close their modal and drop the selection.
  const closeHistoryModal = (): void => setHistoryModal(null)
  const askAgent = (verb: AgentVerb): void => {
    const view = snapshot.view
    const scope = verb === 'draft' ? { side: 'staged' as const }
      : view.kind === 'diff' && (verb !== 'resolve' || snapshot.state?.changes.conflicts.some((entry) => entry.path === view.path))
        ? { paths: [view.path], side: view.side } : undefined
    setAgentRequest({ verb, ...(scope === undefined ? {} : { scope }) })
  }
  React.useEffect(() => props.agentSessions?.subscribeRefresh(() => store.agentTurnEnded()), [props.agentSessions, store])

  // The live chip title reads the same store; the body keeps it alive, and
  // announces membership so the chip gets there without waiting for a repaint.
  React.useEffect(() => {
    announceStores()
    void store.start(getWindow())
    return () => {
      releaseStore(sessionId)
      announceStores()
    }
  }, [store, sessionId])

  const state = snapshot.state
  const busy = snapshot.busy !== null
  // The enclosing tab's actions, published by the child below, which is the
  // only place allowed to read the framework hook (during render). A ref, not
  // state: publishing through `setState` would re-render, re-read the hook and
  // publish again.
  const tabActions = React.useRef<GitTabInfo['tab']['actions'] | null>(null)
  // A panel rendered without the hook must not keep the actions a previous one
  // published: the sink below is the only writer, and it is not rendered.
  if (props.useTabInfo === undefined && tabActions.current !== null) tabActions.current = null
  /**
   * Open one changed path in the change-view tab.
   *
   * @returns whether the tab took the open; false falls back to the in-panel
   * diff, which is the shape a host without the tab action can still render.
   */
  const openChangeTab = (id: string, path: string, side: DiffSide): boolean => {
    const actions = tabActions.current
    if (actions === null) return false
    try {
      actions.openResource(changeFileAddress(id, path, side))
      return true
    } catch {
      // A host that claims no such address keeps the click useful: the caller
      // falls back to the in-panel diff.
      return false
    }
  }
  const [taskResults, setTaskResults] = React.useState<AiTaskResults | undefined>()
  React.useEffect(() => { setTaskResults(state?.root ? props.agentSessions?.taskResults?.(state.root) : undefined) }, [state?.root, props.agentSessions])

  const onDiscard = (paths: readonly string[]): void => {
    setConfirmation({
      title: 'confirm.discard',
      body: 'confirm.discardBody',
      params: { count: paths.length },
      danger: true,
      run: () => void store.discard(paths),
    })
  }

  /**
   * Gate a worktree write behind the host's own preflight.
   *
   * The panel does not guess: the host decides whether the write is safe, and
   * a refused write becomes the same named failure state with its fix instead
   * of a failed git call. A confirmation shows the exact affected paths.
   */
  const preflightThen = (action: PreflightAction, target: string, run: () => void): void => {
    void store.preflight(action, target).then((decision) => {
      if (decision.verdict === 'allow') {
        run()
        return
      }
      if (decision.verdict === 'block') {
        store.showFailure(decision.code, decision.detail)
        return
      }
      setConfirmation({
        title: failureTitleKey(decision.code),
        body: 'confirm.preflightBody',
        params: {},
        confirmLabel: 'confirm.proceed',
        detail: decision.paths.length === 0
          ? decision.detail
          : `${decision.paths.slice(0, 20).join('\n')}${decision.paths.length > 20 ? `\n… +${decision.paths.length - 20}` : ''}\n${decision.detail}`,
        danger: true,
        run,
      })
    }, run)
  }

  const onWorktreeMerge = (worktree: WorktreeInfo): void => {
    preflightThen('merge', worktree.path, () => void store.worktreeMerge(worktree.path))
  }

  const onWorktreeUpdate = (worktree: WorktreeInfo, base?: string): void => {
    preflightThen('update', worktree.path, () => void store.worktreeUpdate(worktree.path, base))
  }

  const onWorktreeDelete = (worktree: WorktreeInfo): void => {
    setConfirmation({
      title: 'confirm.deleteWorktree',
      body: worktree.merged ? 'confirm.deleteWorktreeBody' : 'confirm.deleteWorktreeUnmerged',
      params: { path: worktree.path },
      danger: true,
      run: () => void store.worktreeRemove(worktree.path, !worktree.clean || !worktree.merged, true).then(async removed => {
        if (!removed) return
        try { await props.unregisterDeletedWorktree?.(worktree.path) }
        catch { store.showFailure('git-failed', t('worktrees.unregisterFailed')) }
      }),
    })
  }

  /**
   * Check out a branch, confirming first when the tree is dirty.
   *
   * @param name - the local branch to switch to (a remote pick's local twin).
   * @param remote - the remote-tracking ref to branch from, when there is one.
   * @param label - what the confirmation names.
   */
  const switchBranch = (name: string, remote: string | undefined, label: string): void => {
    const dirty = state !== null && (state.changes.staged.length > 0 || state.changes.unstaged.length > 0 || state.changes.untracked.length > 0)
    const run = (): void => void store.branchSwitch(name, remote)
    if (!dirty) {
      run()
      return
    }
    setConfirmation({
      title: 'confirm.switchBranch',
      body: 'confirm.switchBranchBody',
      params: { branch: label },
      danger: false,
      run,
    })
  }

  /**
   * Check out one picked ref.
   *
   * The picker's rules match git's: a tag cannot be a branch, so it detaches;
   * a remote-tracking pick checks out the local twin git would create, and
   * when that twin already exists the twin is switched to instead — asking
   * git to create a branch that exists would only fail.
   */
  const onPickRef = (option: RefOption): void => {
    setBranchPicker('closed')
    if (option.kind === 'tag') {
      onDetachedAt(option)
      return
    }
    const twin = option.kind === 'remote' ? state?.branches.find((branch) => !branch.remote && branch.name === option.localName) : undefined
    if (twin !== undefined) {
      switchBranch(twin.name, undefined, twin.name)
      return
    }
    switchBranch(option.localName, option.kind === 'remote' ? option.name : undefined, option.name)
  }

  /** Detach HEAD at one ref, naming the ref rather than a bare hash. */
  const onDetachedAt = (option: RefOption): void => {
    setConfirmation({
      title: 'confirm.checkoutCommit',
      body: 'confirm.checkoutCommitBody',
      params: { hash: option.kind === 'tag' ? option.name : option.oid.slice(0, 7) },
      danger: false,
      run: () => void store.checkoutCommit(option.oid),
    })
  }

  /**
   * Create a branch from `from` and check it out.
   *
   * The card reports the host's refusal in place instead of closing and
   * surfacing a banner, so a taken or invalid name is fixed where it was
   * typed. A created branch is always at HEAD or an ancestor, so the checkout
   * cannot be refused for a dirty tree.
   *
   * @returns the failure text to show, or null once the branch is live.
   */
  const onCreateBranch = async (name: string, from: string | null): Promise<string | null> => {
    try {
      await store.api.call<PanelState>('branchCreate', { sessionId, name, ...(from === null ? {} : { from }) })
    } catch (cause) {
      return t(failureTitleKey(asApiError(cause).code))
    }
    await store.refresh()
    await store.branchSwitch(name)
    return null
  }

  const onCheckout = (commit: CommitSummary): void => {
    setConfirmation({
      title: 'confirm.checkoutCommit',
      body: 'confirm.checkoutCommitBody',
      params: { hash: commit.short },
      danger: false,
      run: () => void store.checkoutCommit(commit.hash),
    })
  }

  // "Open file" hands off to the stock text viewer through its resource
  // address; the repository root and the session workspace need not coincide,
  // so the path is rebased first. The tab hook itself is read in the button,
  // not here, so a throw from it cannot take the panel down.
  const fileAddress = (path: string): string | null =>
    state === null ? null : targetFileAddress(sessionId, workspacePathFor(state.cwd, state.root, path))

  // One command, one modal: Inspect and Compare read, the six actions write.
  const historyModalNode = historyModal === null ? null
    : historyModal.kind === 'inspect'
      ? <CommitDetailsModal sessionId={sessionId} commits={historyModal.commits} t={t} api={store.api} onClose={closeHistoryModal} />
      : historyModal.kind === 'compare'
        ? <CompareModal sessionId={sessionId} commits={historyModal.commits} t={t} api={store.api} onClose={closeHistoryModal} />
        : <HistoryActionModal sessionId={sessionId} action={historyModal.action} commits={historyModal.commits}
          t={t} api={store.api} agentSessions={props.agentSessions} root={state?.root} cwd={state?.cwd}
          onClose={closeHistoryModal} onChanged={() => store.refresh()} />

  return (
    <div className={classes.root} data-dsh-git="panel">
      <PanelHeader
        snapshot={snapshot}
        t={t}
        store={store}
        branchPickerOpen={branchPicker === 'browse'}
        onOpenBranchPicker={() => setBranchPicker('browse')}
        toolsOpen={toolsOpen}
        setToolsOpen={setToolsOpen}
        busy={busy}
        onRefresh={() => void store.refresh()}
        onRepository={command => {
          if (command === 'worktree-create' || command === 'worktree-manage') {
            if (snapshot.collapsed.worktrees) store.toggleSection('worktrees')
            if (command === 'worktree-create') setTimeout(() => document.getElementById('dsh-git-worktree-name')?.focus(), 0)
          } else if (command === 'checkout') setBranchPicker('detach')
          else setRepositoryAction(command)
        }}
        onNewWorktree={() => {
          // The sections ship collapsed; the verb has to reveal its field.
          if (snapshot.collapsed.worktrees) store.toggleSection('worktrees')
          setTimeout(() => document.getElementById('dsh-git-worktree-name')?.focus(), 0)
        }}
        onAgentVerb={
          props.agentSessions === undefined ? undefined : askAgent
        }
      />
      {props.useTabInfo === undefined ? null : (
        <PanelBoundary renderFallback={() => null} resetKey={sessionId}>
          <TabActionsSink useTabInfo={props.useTabInfo} sink={tabActions} />
        </PanelBoundary>
      )}
      <div className={classes.body} data-dsh-git="body">
        <Notices
          snapshot={snapshot}
          t={t}
          store={store}
          onSkip={(kind) => setConfirmation({
            title: 'confirm.skipStep',
            body: 'confirm.skipStepBody',
            params: { kind: t(`operation.${kind}` as MessageKey) },
            confirmLabel: 'operation.skip',
            danger: true,
            run: () => void store.operationSkip(),
          })}
        />
        {taskResults !== undefined && props.agentSessions !== undefined && state !== null ? <AgentResults key={JSON.stringify([sessionId, state.root])} results={taskResults} sessions={props.agentSessions} store={store} t={t} /> : null}
        {(state?.changes.conflicts.length ?? 0) > 0 ? <div className={classes.banner}>
          <Button variant="primary" data-dsh-git="resolve-conflicts" onClick={() => setConflictPath(state!.changes.conflicts[0]!.path)}>{t('conflict.title')}</Button>
        </div> : null}
        {snapshot.view.kind === 'diff' ? (
          <DiffPane
            snapshot={snapshot}
            t={t}
            sessionId={sessionId}
            store={store}
            onBack={() => store.closeDiff()}
            addressFor={fileAddress}
            {...(props.useTabInfo === undefined ? {} : { useTabInfo: props.useTabInfo })}
          />
        ) : (
          <>
            {state === null ? (
              // A read that never settled stays visible as a read in flight.
              // Rendering nothing here reads as a broken panel.
              snapshot.phase === 'loading' ? (
                <div className={classes.empty} data-dsh-git="loading">
                  <span className={classes.emptyHint}>{t('state.loading')}</span>
                </div>
              ) : null
            ) : (
              <>
                <ChangesSection
                  state={state}
                  snapshot={snapshot}
                  t={t}
                  busy={busy}
                  collapsed={snapshot.collapsed.changes}
                  onToggle={() => store.toggleSection('changes')}
                  onOpen={(path, side, oldPath) => {
                    if (state.changes.conflicts.some((entry) => entry.path === path)) {
                      setConflictPath(path)
                      return
                    }
                    // The change view is its own tab; the in-panel diff stays
                    // for what a tab cannot host (no tab action on this host,
                    // or a record the shell has not committed yet), and it is
                    // still where per-hunk staging lives.
                    if (openChangeTab(sessionId, path, side)) return
                    void store.openDiff(path, side, oldPath)
                  }}
                  onDiscard={onDiscard}
                  store={store}
                />
                <WorktreesSection
                  state={state}
                  t={t}
                  busy={busy}
                  store={store}
                  collapsed={snapshot.collapsed.worktrees}
                  onToggle={() => store.toggleSection('worktrees')}
                  onDelete={onWorktreeDelete}
                  onMerge={onWorktreeMerge}
                  onUpdate={onWorktreeUpdate}
                  {...(props.openWorktreeSession === undefined
                    ? {}
                    : { openWorktreeSession: props.openWorktreeSession })}
                  registerCreatedWorktree={props.registerCreatedWorktree}
                />
                <HistorySectionView snapshot={snapshot} t={t}
                  onRefresh={() => void store.loadHistory()} onLoadMore={() => void store.loadMoreHistory()}
                  onToggle={() => store.toggleSection('history')} onCheckout={onCheckout}
                  onInspect={(commits) => setHistoryModal({ kind: 'inspect', commits })}
                  onCompare={(commits) => setHistoryModal({ kind: 'compare', commits })}
                  onAction={(action, commits) => setHistoryModal({ kind: 'action', action, commits })} />
              </>
            )}
          </>
        )}
      </div>
      {branchPicker === 'closed' || state === null ? null : (
        <BranchPicker
          state={state}
          t={t}
          startAt={branchPicker}
          onSwitch={onPickRef}
          onDetached={option => { setBranchPicker('closed'); onDetachedAt(option) }}
          onCreate={onCreateBranch}
          onClose={() => setBranchPicker('closed')}
        />
      )}
      {repositoryAction !== null && state !== null ? <RepositoryActionDialog key={repositoryAction} command={repositoryAction} sessionId={sessionId} state={state} api={store.api} t={t} onClose={() => setRepositoryAction(null)} onChanged={() => store.refresh()} /> : null}
      {historyModalNode}
      {conflictPath === null || state === null ? null : (
        <ConflictWorkspaceView sessionId={sessionId} initialPath={conflictPath}
          paths={state.changes.conflicts.map((entry) => entry.path)} t={t} api={store.api}
          onClose={() => setConflictPath(null)} onChanged={() => store.refresh()}
          {...(props.agentSessions === undefined ? {} : { onAskAgent: (request: AgentActionRequest) => { setConflictPath(null); setAgentRequest(request) } })} />
      )}
      {agentRequest === null || props.agentSessions === undefined ? null : (
        <AgentActionDialog request={agentRequest} store={store} sessions={props.agentSessions} t={t} onClose={() => setAgentRequest(null)} />
      )}
      {confirmation === null ? null : (
        <Modal
          open
          onClose={() => setConfirmation(null)}
          title={t(confirmation.title)}
          closeLabel={t('confirm.cancel')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmation(null)}>
                {t('confirm.cancel')}
              </Button>
              <Button
                variant={confirmation.danger ? 'outline' : 'primary'}
                className={confirmation.danger ? classes.dangerButton : undefined}
                data-dsh-git="confirm-proceed"
                onClick={() => {
                  confirmation.run()
                  setConfirmation(null)
                }}
              >
                {confirmation.confirmLabel !== undefined
                  ? t(confirmation.confirmLabel)
                  : confirmation.title === 'confirm.discard'
                    ? t('changes.discard')
                    : confirmation.danger ? t('confirm.force') : t('confirm.proceed')}
              </Button>
            </>
          }
        >
          <p className={classes.bannerBody}>{t(confirmation.body, confirmation.params)}</p>
          {confirmation.detail === undefined ? null : (
            <pre className={classes.hookOutput} data-dsh-git="confirm-detail">{confirmation.detail}</pre>
          )}
        </Modal>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- the store */

/** Stores are shared between the body and the live chip title. */
const stores = new Map<string, { store: PanelStore; refs: number; release: (() => void) | null }>()

/**
 * Registry revision, and who listens to it.
 *
 * The chip title is a separate seat from the body, and the strip usually
 * renders before the body does, so the chip's first render has no store to
 * read and would keep the type label until something else re-rendered it. The
 * body announces the store joining (and leaving) the registry, and the chip
 * re-reads it.
 */
let registryVersion = 0
const registryListeners = new Set<() => void>()

/** The registry's current revision. */
export function storesVersion(): number {
  return registryVersion
}

/** Subscribe to stores joining and leaving the registry. */
export function subscribeStores(listener: () => void): () => void {
  registryListeners.add(listener)
  return () => {
    registryListeners.delete(listener)
  }
}

/** Publish one registry membership change. */
function announceStores(): void {
  registryVersion += 1
  for (const listener of registryListeners) listener()
}

/** The API factory the panel uses; overridden in tests through `setPanelApi`. */
let apiFactory: () => GitApiLike = () => createDefaultApi()

/** Injectable API factory (tests). */
export function setPanelApi(factory: () => GitApiLike): void {
  apiFactory = factory
}

/** Structural API face the panel needs. */
export type GitApiLike = {
  call<T>(method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T>
}

function createDefaultApi(): GitApiLike {
  // Imported lazily to keep this module's top level free of fetch wiring.
  return createApiRef()
}

let createApiRef: () => GitApiLike = () => {
  throw new Error('git api not configured')
}

/** Wire the default API factory (called once by the client entry). */
export function configurePanelApi(factory: () => GitApiLike): void {
  createApiRef = factory
}

/** Acquire (creating on first use) the store for one session. */
export function usePanelStore(sessionId: string): PanelStore {
  return React.useMemo(() => {
    const existing = stores.get(sessionId)
    if (existing !== undefined) {
      existing.refs += 1
      return existing.store
    }
    const store = new PanelStore(apiFactory(), sessionId)
    stores.set(sessionId, { store, refs: 1, release: null })
    return store
  }, [sessionId])
}

/** Release one reference; the last release disposes the store. */
export function releaseStore(sessionId: string): void {
  const entry = stores.get(sessionId)
  if (entry === undefined) return
  entry.refs -= 1
  if (entry.refs > 0) return
  stores.delete(sessionId)
  entry.store.dispose()
}

/** The store for a session, when the body has created it (the chip title path). */
export function peekStore(sessionId: string | undefined): PanelStore | undefined {
  return sessionId === undefined ? undefined : stores.get(sessionId)?.store
}

/** The window-like trigger target; `undefined` under jsdom without a window. */
function getWindow(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window
}

/* ------------------------------------------------------------------ header */

interface HeaderProps {
  readonly snapshot: PanelSnapshot
  readonly t: Translate
  readonly store: PanelStore
  readonly busy: boolean
  /** Whether the ref picker the chip opens is showing. */
  readonly branchPickerOpen: boolean
  readonly onOpenBranchPicker: () => void
  readonly toolsOpen: boolean
  readonly setToolsOpen: (open: boolean) => void
  readonly onRefresh: () => void
  readonly onNewWorktree: () => void
  readonly onRepository: (action: RepositoryMenuCommand) => void
  readonly onAgentVerb?: ((verb: AgentVerb, prompt: string) => void) | undefined
}

function PanelHeader(props: HeaderProps): React.ReactElement {
  const { snapshot, t, store, busy, toolsOpen, setToolsOpen } = props
  const state = snapshot.state
  const head = state?.head
  // With no state yet the header must not claim the checkout is not a
  // repository: a read in flight, and a session the host has not loaded, are
  // both temporary and named as such.
  const label = head === undefined || head === null
    ? snapshot.phase === 'loading' ? t('state.loading')
      : snapshot.failure?.code === 'session-not-ready' ? t('failure.sessionNotReady')
        : t('state.noRepository')
    : head.unborn
      ? t('header.unborn')
      : head.branch ?? t('header.detached')

  const toolItems: MenuEntry[] = [
    { id: 'agent-review', label: t('agent.review') },
    { id: 'agent-explain', label: t('agent.explain') },
    { id: 'agent-draft', label: t('agent.draft') },
    { id: 'agent-resolve', label: t('agent.resolve'), disabled: (state?.changes.conflicts.length ?? 0) === 0 },
  ]

  return (
    <header className={classes.header}>
      <div className={classes.headerMain}>
        <button type="button" className={classes.iconButton} aria-label={t('commands.sync')} title={t('commands.sync')}
          data-dsh-git="sync" disabled={busy || state === null} onClick={() => props.onRepository('sync')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M5 13V3m-3 3 3-3 3 3M11 3v10m-3-3 3 3 3-3" />
          </svg>
        </button>
        <button
          type="button"
          className={classes.branchButton}
          onClick={() => props.onOpenBranchPicker()}
          data-dsh-git="branch-button"
          aria-haspopup="dialog"
          aria-expanded={props.branchPickerOpen}
          aria-label={t('header.branchMenu')}
          title={t('header.branchMenu')}
        >
          <IconBranchOutlineRegular size={14} className={classes.branchGlyph} />
          <span className={classes.branchName} title={label}>
            {label}
          </span>
          <IconChevronDownOutlineRegular size={12} className={classes.branchGlyph} />
        </button>
        {head !== null && head !== undefined && (head.ahead > 0 || head.behind > 0) ? (
          <span className={classes.counts}>
            {head.ahead > 0 ? t('header.ahead', { count: head.ahead }) : null}
            {head.behind > 0 ? t('header.behind', { count: head.behind }) : null}
          </span>
        ) : null}
        {head !== null && head !== undefined && head.upstream !== null && head.behind > 0 ? (
          <button
            type="button"
            className={classes.iconButton}
            title={t('header.updateTitle')}
            aria-label={t('header.update')}
            data-dsh-git="update"
            disabled={busy}
            onClick={() => void store.updateFromBranch()}
          >
            <IconRefreshOutlineRegular size={14} />
          </button>
        ) : null}
      </div>
      <button type="button" className={classes.iconButton} aria-label={t('header.newWorktree')} title={t('header.newWorktree')} data-dsh-git="new-worktree" disabled={busy || state === null} onClick={props.onNewWorktree}><IconPlusOutlineRegular size={16} /></button>
      {props.onAgentVerb !== undefined ? (
        <Menu
          open={toolsOpen}
          anchor={
            <button
              type="button"
              className={classes.iconButton}
              aria-label={t('agent.title')}
              title={t('agent.title')}
              data-dsh-git="agent-menu"
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              <IconSparkleRegular size={16} />
            </button>
          }
          items={toolItems}
          onSelect={(id) => {
            setToolsOpen(false)
            const verb = id.replace('agent-', '') as AgentVerb
            props.onAgentVerb?.(verb, '')
          }}
          onClose={() => setToolsOpen(false)}
          align="end"
          portal
        />
      ) : null}
      <button
        type="button"
        className={classes.iconButton}
        aria-label={t('header.refresh')}
        title={t('header.refreshTitle')}
        data-dsh-git="refresh"
        disabled={busy}
        onClick={props.onRefresh}
      >
        <IconRefreshOutlineRegular size={16} className={snapshot.reason === 'manual' && busy ? classes.spinning : undefined} />
      </button>
      {/* The catch-all menu closes the row: everything else is a one-click
          shortcut, and the three dots are where a command you cannot see lives. */}
      <RepositoryMenu t={t} disabled={busy || state === null} {...(state ? { state } : {})} onAction={props.onRepository} />
    </header>
  )
}

/* ----------------------------------------------------------------- notices */

function Notices(props: {
  snapshot: PanelSnapshot
  t: Translate
  store: PanelStore
  /** Ask for the danger confirmation that precedes a skipped step. */
  onSkip: (kind: OperationKind) => void
}): React.ReactElement | null {
  const { snapshot, t, store } = props
  const blocks: React.ReactElement[] = []

  if (snapshot.phase === 'degraded' && snapshot.degraded !== null) {
    const degraded = snapshot.degraded
    blocks.push(
      <div className={classes.banner} key="degraded" data-dsh-git="degraded">
        <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
          <IconWarningOutlineRegular size={16} />
          <span>{degradedTitle(degraded.code, degraded, t)}</span>
        </div>
        <div className={classes.bannerBody}>{degradedFix(degraded.code, degraded, t)}</div>
      </div>,
    )
  } else if (snapshot.failure !== null) {
    blocks.push(
      <div className={classes.banner} key="failure" data-dsh-git="failure">
        <div className={`${classes.bannerTitle} ${classes.bannerError}`}>
          <IconWarningOutlineRegular size={16} />
          <span>{t(failureTitleKey(snapshot.failure.code))}</span>
        </div>
        <div className={classes.bannerBody}>{failureFix(snapshot.failure.code, t)}</div>
        {snapshot.failure.detail === '' ? null : (
          <div className={classes.bannerBody}>{snapshot.failure.detail}</div>
        )}
      </div>,
    )
  }

  const operation = snapshot.state?.operation ?? null
  if (operation !== null && operation.kind !== null) {
    // Captured so the narrowing survives into the button callbacks below.
    const kind = operation.kind
    blocks.push(
      <div className={classes.banner} key="operation" data-dsh-git="operation">
        <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
          <StateDot state="warning" />
          <span>{t(`operation.${kind}` as MessageKey)}</span>
          {operation.step === null ? null : (
            <span className={classes.caption}>{t('operation.step', { step: operation.step })}</span>
          )}
        </div>
        {operation.conflicts.length === 0 ? null : (
          <div className={classes.bannerBody}>
            {t('operation.conflicts', { count: operation.conflicts.length })}
          </div>
        )}
        <div className={classes.bannerActions}>
          <Button size="sm" variant="primary" disabled={snapshot.busy !== null || operation.conflicts.length > 0} onClick={() => void store.operationContinue()}>
            {t('operation.continue')}
          </Button>
          {kind === 'merge' ? null : (
            <Button
              size="sm"
              variant="ghost"
              disabled={snapshot.busy !== null}
              data-dsh-git="operation-skip"
              onClick={() => props.onSkip(kind)}
            >
              {t('operation.skip')}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={snapshot.busy !== null} onClick={() => void store.operationAbort()}>
            {t('operation.abort')}
          </Button>
        </div>
      </div>,
    )
  }

  if (snapshot.busy === 'busy.commit') {
    blocks.push(
      <div className={classes.banner} key="commit-progress" data-dsh-git="commit-progress">
        <span>{t('busy.commit')}</span>
        <Button size="sm" variant="ghost" onClick={() => void store.cancelCommit()}>{t('hook.cancel')}</Button>
      </div>,
    )
  }

  if (snapshot.hook !== null) {
    blocks.push(
      <div className={classes.banner} key="hook" data-dsh-git="hook">
        <div className={`${classes.bannerTitle} ${classes.bannerError}`}>
          <IconWarningOutlineRegular size={16} />
          <span>{t('hook.title', { hook: snapshot.hook.hook })}</span>
          <span className={classes.caption}>{t('hook.exitCode', { code: snapshot.hook.exitCode })}</span>
        </div>
        <pre className={classes.hookOutput}>{snapshot.hook.output === '' ? t('hook.note') : snapshot.hook.output}</pre>
        <div className={classes.bannerActions}>
          <Button size="sm" variant="primary" onClick={() => void store.retryCommit()}>
            {t('hook.retry')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void store.cancelCommit()}>
            {t('hook.cancel')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => store.dismissHook()}>
            {t('hook.dismiss')}
          </Button>
        </div>
      </div>,
    )
  }

  if (snapshot.setup !== null) {
    blocks.push(
      <div className={classes.banner} key="setup" data-dsh-git="setup">
        <div className={classes.bannerTitle}>
          <span>
            {snapshot.setup.report.failed
              ? t('worktrees.setupFailed', { count: snapshot.setup.report.ran })
              : t('worktrees.setupRan', { count: snapshot.setup.report.ran })}
          </span>
        </div>
        {snapshot.setup.report.output === '' ? null : (
          <>
            <div className={classes.caption}>{t('worktrees.setupOutput')}</div>
            <pre className={classes.hookOutput}>{snapshot.setup.report.output}</pre>
          </>
        )}
      </div>,
    )
  }

  const identity = snapshot.state?.identity
  if (identity !== undefined && (identity.name === null || identity.email === null)) {
    blocks.push(
      <div className={classes.banner} key="identity" data-dsh-git="identity">
        <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
          <IconWarningOutlineRegular size={16} />
          <span>{t('header.identityMissing')}</span>
        </div>
        <div className={classes.bannerBody}>{t('header.identityFix')}</div>
      </div>,
    )
  }

  if (snapshot.notice !== null) {
    blocks.push(
      <div className={classes.banner} key="notice" data-dsh-git="notice">
        <div className={classes.bannerTitle}>
          <span>{t(snapshot.notice as MessageKey)}</span>
          <span className={classes.sectionSpacer} />
          <Button size="sm" variant="ghost" onClick={() => store.dismissNotice()}>
            {t('notice.dismiss')}
          </Button>
        </div>
      </div>,
    )
  }

  if (blocks.length === 0) return null
  return <>{blocks}</>
}

/** The dictionary key naming a failure code. */
export function failureTitleKey(code: GitFailureCode): MessageKey {
  const map: Record<GitFailureCode, MessageKey> = {
    'git-unavailable': 'failure.gitUnavailable',
    'git-too-old': 'failure.gitTooOld',
    'not-a-repository': 'failure.notARepository',
    'session-not-ready': 'failure.sessionNotReady',
    'host-outdated': 'failure.hostOutdated',
    'bare-repository': 'failure.bareRepository',
    'permission-denied': 'failure.permissionDenied',
    'identity-missing': 'failure.identityMissing',
    'index-locked': 'failure.indexLocked',
    'operation-in-progress': 'failure.operationInProgress',
    'dirty-tree': 'failure.dirtyTree',
    'not-merged': 'failure.notMerged',
    'detached-head': 'failure.detachedHead',
    'current-branch': 'failure.currentBranch',
    'worktree-primary': 'failure.worktreePrimary',
    'worktree-current': 'failure.worktreeCurrent',
    'branch-exists': 'failure.branchExists',
    'worktree-exists': 'failure.worktreeExists',
    'invalid-name': 'failure.invalidName',
    'setup-stale': 'failure.setupStale',
    'no-upstream': 'failure.noUpstream',
    'nothing-to-commit': 'failure.nothingToCommit',
    'path-missing': 'failure.pathMissing',
    'hook-failed': 'failure.hookFailed',
    'hook-cancelled': 'failure.hookCancelled',
    cancelled: 'failure.cancelled',
    timeout: 'failure.timeout',
    'git-failed': 'failure.gitFailed',
  }
  return map[code]
}

/** The fix key for a failure code, when one exists. */
export function failureFix(code: GitFailureCode, t: Translate): string {
  const fixes: Partial<Record<GitFailureCode, MessageKey>> = {
    'index-locked': 'failure.fix.indexLocked',
    'operation-in-progress': 'failure.fix.operationInProgress',
    'dirty-tree': 'failure.fix.dirtyTree',
    'session-not-ready': 'failure.fix.sessionNotReady',
    'host-outdated': 'failure.fix.hostOutdated',
    'not-merged': 'failure.fix.notMerged',
    'detached-head': 'failure.fix.detachedHead',
    'identity-missing': 'failure.fix.identityMissing',
    'no-upstream': 'failure.fix.noUpstream',
    'path-missing': 'failure.fix.pathMissing',
    'worktree-primary': 'failure.fix.worktreePrimary',
    'worktree-current': 'failure.fix.worktreeCurrent',
    'setup-stale': 'failure.fix.setupStale',
    'git-failed': 'failure.fix.gitFailed',
  }
  const key = fixes[code]
  return key === undefined ? t('failure.fix.gitFailed') : t(key)
}

function degradedTitle(
  code: string,
  degraded: { installedVersion: string | null },
  t: Translate,
): string {
  if (code === 'git-too-old') {
    return t('state.tooOld', { installed: degraded.installedVersion ?? '?' })
  }
  const map: Record<string, MessageKey> = {
    'git-unavailable': 'state.noGit',
    'not-a-repository': 'state.noRepository',
    'bare-repository': 'state.bare',
    'permission-denied': 'state.permission',
  }
  return t(map[code] ?? 'state.noRepository')
}

function degradedFix(
  code: string,
  degraded: { requiredVersion: string | null },
  t: Translate,
): string {
  const map: Record<string, MessageKey> = {
    'git-unavailable': 'state.noGitFix',
    'git-too-old': 'state.tooOldFix',
    'not-a-repository': 'state.noRepositoryFix',
    'bare-repository': 'state.bareFix',
    'permission-denied': 'state.permissionFix',
  }
  const key = map[code] ?? 'state.noRepositoryFix'
  return t(key, { required: degraded.requiredVersion ?? '' })
}

/* ---------------------------------------------------------------- sections */

/**
 * One collapsible section: an accordion header (chevron, title, count, and the
 * section's own actions) over its body. The header is a real button, so the
 * sections answer the keyboard and expose `aria-expanded`; the actions sit
 * beside it rather than inside, because a button cannot nest in a button.
 */
function Section(props: {
  id: PanelSection
  title: string
  count?: number | null
  collapsed: boolean
  onToggle: () => void
  actions?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  const { id, title, count, collapsed, onToggle, actions, children } = props
  const bodyId = `dsh-git-section-${id}`
  return (
    <section className={classes.section} data-dsh-git={id}>
      <div className={classes.sectionHeader} onClick={event => {
        if (!(event.target as Element).closest('button')) onToggle()
      }}>
        <button
          type="button"
          className={classes.sectionToggle}
          data-dsh-git="section-toggle"
          data-section={id}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <IconChevronDownOutlineRegular
            size={12}
            className={collapsed ? classes.sectionChevronCollapsed : classes.sectionChevron}
          />
          <span className={classes.sectionTitle}>{title}</span>
        </button>
        <span className={classes.sectionSpacer} />
        {actions}
        {count === undefined || count === null ? null : (
          <span className={classes.sectionCount} data-dsh-git="section-count">
            {count}
          </span>
        )}
      </div>
      {collapsed ? null : (
        <div id={bodyId} data-dsh-git="section-body" data-section={id}>
          {children}
        </div>
      )}
    </section>
  )
}

/* ----------------------------------------------------------------- changes */

function ChangesSection(props: {
  state: PanelState
  snapshot: PanelSnapshot
  t: Translate
  busy: boolean
  store: PanelStore
  collapsed: boolean
  onToggle: () => void
  onOpen: (path: string, side: DiffSide, oldPath?: string) => void
  onDiscard: (paths: readonly string[]) => void
}): React.ReactElement {
  const { state, t, busy, store, onOpen, onDiscard } = props
  const changes = state.changes
  // A conflicted path is listed once, under Conflicts: staging or discarding
  // it is not what resolves it.
  const changeable = {
    staged: changes.staged.filter((entry) => entry.unmerged === undefined),
    unstaged: changes.unstaged.filter((entry) => entry.unmerged === undefined),
  }
  // Discard covers everything the panel can restore or delete; a conflicted
  // path is resolved, not discarded.
  const discardable = [...changeable.unstaged, ...changes.untracked]
  const total = new Set([...changes.staged, ...changes.unstaged, ...changes.untracked].map((entry) => entry.path)).size

  return (
    <Section
      id="changes"
      title={t('changes.title')}
      count={total}
      collapsed={props.collapsed}
      onToggle={props.onToggle}
      actions={
        <>
          <CommitActions snapshot={props.snapshot} t={t} store={store} />
          {changeable.unstaged.length + changes.untracked.length > 0 ? (
            <button
              type="button"
              className={classes.iconButton}
              aria-label={t('changes.stageAll')}
              title={t('changes.stageAll')}
              data-dsh-git="stage-all"
              disabled={busy}
              onClick={() =>
                void store.stage([...changeable.unstaged, ...changes.untracked].map((entry) => entry.path))
              }
            >
              <IconPlusOutlineRegular size={14} />
            </button>
          ) : null}
          {changeable.staged.length > 0 ? (
            <button
              type="button"
              className={classes.iconButton}
              aria-label={t('changes.unstageAll')}
              title={t('changes.unstageAll')}
              data-dsh-git="unstage-all"
              disabled={busy}
              onClick={() => void store.unstage(changeable.staged.map((entry) => entry.path))}
            >
              <MinusGlyph size={14} />
            </button>
          ) : null}
          {discardable.length > 0 ? (
            <button
              type="button"
              className={classes.iconButton}
              aria-label={t('changes.discardAll')}
              title={t('changes.discardAll')}
              data-dsh-git="discard-all"
              disabled={busy}
              onClick={() => onDiscard(discardable.map((entry) => entry.path))}
            >
              <IconTrashOutlineRegular size={14} />
            </button>
          ) : null}
        </>
      }
    >
      {total === 0 ? (
        <div className={classes.empty}>
          <span className={classes.emptyTitle}>{t('changes.none')}</span>
          <span className={classes.emptyHint}>{t('state.emptyHint')}</span>
        </div>
      ) : null}

      {changes.conflicts.length > 0 ? (
        <Group
          label={t('changes.conflicts')}
          entries={changes.conflicts}
          t={t}
          busy={busy}
          store={store}
          side="unstaged"
          onOpen={onOpen}
          onDiscard={onDiscard}
          readonly
        />
      ) : null}
      {changes.staged.filter((entry) => entry.unmerged === undefined).length > 0 ? (
        <Group
          label={t('changes.staged')}
          entries={changes.staged.filter((entry) => entry.unmerged === undefined)}
          t={t}
          busy={busy}
          store={store}
          side="staged"
          onOpen={onOpen}
          onDiscard={onDiscard}
        />
      ) : null}
      {changes.unstaged.filter((entry) => entry.unmerged === undefined).length > 0 ? (
        <Group
          label={t('changes.unstaged')}
          entries={changes.unstaged.filter((entry) => entry.unmerged === undefined)}
          t={t}
          busy={busy}
          store={store}
          side="unstaged"
          onOpen={onOpen}
          onDiscard={onDiscard}
        />
      ) : null}
      {changes.untracked.length > 0 ? (
        <Group
          label={t('changes.untracked')}
          entries={changes.untracked}
          t={t}
          busy={busy}
          store={store}
          side="unstaged"
          onOpen={onOpen}
          onDiscard={onDiscard}
        />
      ) : null}
      {changes.ignoredCount > 0 ? (
        <div className={classes.caption} data-dsh-git="ignored">
          {t('changes.ignored', { count: changes.ignoredCount })}
        </div>
      ) : null}
    </Section>
  )
}

function Group(props: {
  label: string
  entries: readonly StatusEntry[]
  t: Translate
  busy: boolean
  store: PanelStore
  side: DiffSide
  readonly?: boolean
  onOpen: (path: string, side: DiffSide, oldPath?: string) => void
  onDiscard: (paths: readonly string[]) => void
}): React.ReactElement {
  const { label, entries, t, busy, store, side, onOpen, onDiscard } = props
  return (
    <div data-dsh-git="group">
      <div className={classes.groupHeader}>
        <span className={classes.groupTitle}>{label}</span>
        <span className={classes.groupCount}>{entries.length}</span>
      </div>
      {entries.map((entry) => (
        <div
          key={`${entry.path}:${entry.xy}`}
          className={classes.row}
          data-dsh-git="row"
          data-path={entry.path}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(entry.path, side, entry.oldPath)}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              onOpen(entry.path, side, entry.oldPath)
            }
          }}
        >
          <FileTypeIcon path={entry.path} size={14} className={classes.fileIcon} />
          <span
            className={classes.fileName}
            title={entry.oldPath === undefined ? entry.path : `${entry.oldPath} -> ${entry.path}`}
          >
            {baseName(entry.path)}
          </span>
          {entry.oldPath === undefined ? null : (
            <span className={classes.fileFrom}>{`<- ${baseName(entry.oldPath)}`}</span>
          )}
          {dirName(entry.path) === '' ? null : <span className={classes.fileDir}>{dirName(entry.path)}</span>}
          <span className={classes.rowSpacer} />
          <span
            className={`${classes.statusLetter} ${statusClass(entry)}`}
            data-dsh-git="status"
            aria-hidden
          >
            {statusLetter(entry)}
          </span>
          <div className={`${classes.rowActions} ${classes.rowActionsOverlay}`}>
            {props.readonly === true ? null : side === 'staged' ? (
              <HoverCard
                anchor={
                  <button
                    type="button"
                    className={classes.iconButton}
                    aria-label={t('changes.unstage')}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation()
                      void store.unstage([entry.path])
                    }}
                  >
                    <MinusGlyph size={14} />
                  </button>
                }
                content={t('changes.unstage')}
                copyLabel={t('changes.unstage')}
                copiedLabel={t('diff.copied')}
              />
            ) : (
              <HoverCard
                anchor={
                  <button
                    type="button"
                    className={classes.iconButton}
                    aria-label={t('changes.stage')}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation()
                      void store.stage([entry.path])
                    }}
                  >
                    <IconPlusOutlineRegular size={14} />
                  </button>
                }
                content={t('changes.stage')}
                copyLabel={t('changes.stage')}
                copiedLabel={t('diff.copied')}
              />
            )}
            {props.readonly === true || side === 'staged' ? null : <button
              type="button"
              className={classes.iconButton}
              aria-label={t('changes.discard')}
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation()
                onDiscard([entry.path])
              }}
            >
              <IconTrashOutlineRegular size={14} />
            </button>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ commit */

/** The commit chord's modifier name for this platform. */
export function commitModifier(): string {
  const platform = typeof navigator === 'undefined' ? '' : (navigator.platform ?? '')
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '\u2318' : 'Ctrl'
}

/**
 * The two working-tree writes, each behind its own dialog.
 *
 * They sit in the Changes section header beside the staging actions, so the
 * header's own buttons say what can be done to the index right now. Both act
 * on the index, so both need staged work, and a conflicted index is neither
 * committable nor stashable. The disabled tooltip carries that reason, which is
 * why no separate hint line is needed.
 */
function CommitActions(props: {
  snapshot: PanelSnapshot
  t: Translate
  store: PanelStore
}): React.ReactElement | null {
  const { snapshot, t, store } = props
  const state = snapshot.state
  const [dialog, setDialog] = React.useState<'commit' | 'stash' | null>(null)
  if (state === null) return null
  const busy = snapshot.busy !== null
  const staged = state.changes.staged.filter((entry) => entry.unmerged === undefined).length
  const unstaged = state.changes.unstaged.filter((entry) => entry.unmerged === undefined).length
  const untracked = state.changes.untracked.length
  const ready = staged > 0 && !busy && state.changes.conflicts.length === 0
  const why = busy ? t('history.reason.busy')
    : staged === 0 ? (unstaged + untracked > 0 ? t('commit.nothingStagedButChanges') : t('commit.nothingStaged'))
      : t('commit.conflicts')

  return (
    <>
      <span className={classes.commitAction} data-dsh-git="commit">
        <Button
          size="sm"
          variant="ghost"
          disabled={!ready}
          title={ready ? t('commit.button') : why}
          data-dsh-git="commit-open"
          onClick={() => setDialog('commit')}
        >
          {t('commit.button')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!ready}
          title={ready ? t('stash.button') : why}
          data-dsh-git="stash-open"
          onClick={() => setDialog('stash')}
        >
          {t('stash.button')}
        </Button>
      </span>
      {dialog === 'commit' ? <CommitDialog snapshot={snapshot} t={t} store={store} onClose={() => setDialog(null)} /> : null}
      {dialog === 'stash' ? <StashDialog t={t} store={store} onClose={() => setDialog(null)} /> : null}
    </>
  )
}

function CommitDialog(props: {
  snapshot: PanelSnapshot
  t: Translate
  store: PanelStore
  onClose(): void
}): React.ReactElement {
  const { snapshot, t, store, onClose } = props
  const [applying, setApplying] = React.useState(false)
  const body = React.useRef<HTMLDivElement>(null)
  const messageId = React.useId()
  useDialogFocus(body)
  const state = snapshot.state
  const summary = snapshot.message.split('\n', 1)[0] ?? ''
  const busy = snapshot.busy !== null
  const unresolved = (state?.changes.conflicts.length ?? 0) > 0
  const staged = (state?.changes.staged ?? []).filter((entry) => entry.unmerged === undefined).length
  const canCommit = summary.trim() !== '' && staged > 0 && !busy && !unresolved
  const branch = state?.head.branch ?? 'HEAD'

  const submit = async (): Promise<void> => {
    if (!canCommit || applying) return
    setApplying(true)
    try {
      if (await store.commit(snapshot.message)) onClose()
    } finally {
      setApplying(false)
    }
  }

  return <Modal open title={t('commit.button')} closeLabel={t('confirm.cancel')} onClose={onClose}
    footer={<>
      <Button variant="ghost" disabled={applying} onClick={onClose}>{t('confirm.cancel')}</Button>
      <Button variant="primary" disabled={!canCommit || applying} data-dsh-git="commit-submit" onClick={() => { void submit() }}>
        {applying ? t('busy.commit') : t('commit.button')}
      </Button>
    </>}>
    <div ref={body} className={classes.dialogBody} data-dsh-git="commit-dialog">
      <label className={classes.fieldLabel} htmlFor={messageId}>{t('commit.message')}</label>
      <div className={classes.messageEditor}>
        <textarea id={messageId} className={`${classes.fieldInput} ${classes.fieldBody}`} data-dsh-git="commit-message"
          rows={7} value={snapshot.message} placeholder={t('commit.messagePlaceholder')} autoFocus
          onChange={event => store.setMessage(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }} />
        <InlineMessageDraft scope={JSON.stringify([store.sessionId, state?.root, state?.cwd, state?.head.oid])} t={t}
          disabled={busy || applying || unresolved || staged === 0} generate={signal => store.draftInput(signal)}
          onMessage={message => store.setMessage(message)} />
      </div>
      <p className={classes.hint}>{t('commit.chord', { mod: commitModifier(), branch })}</p>
    </div>
  </Modal>
}

function StashDialog(props: { t: Translate; store: PanelStore; onClose(): void }): React.ReactElement {
  const { t, store, onClose } = props
  const [name, setName] = React.useState('')
  const [applying, setApplying] = React.useState(false)
  const body = React.useRef<HTMLDivElement>(null)
  const nameId = React.useId()
  useDialogFocus(body)

  const submit = async (): Promise<void> => {
    if (applying) return
    setApplying(true)
    try {
      if (await store.stashSave(name)) onClose()
    } finally {
      setApplying(false)
    }
  }

  return <Modal open title={t('stash.button')} closeLabel={t('confirm.cancel')} onClose={onClose}
    footer={<>
      <Button variant="ghost" disabled={applying} onClick={onClose}>{t('confirm.cancel')}</Button>
      <Button variant="primary" disabled={applying} data-dsh-git="stash-submit" onClick={() => { void submit() }}>
        {applying ? t('busy.stash') : t('stash.button')}
      </Button>
    </>}>
    <div ref={body} className={classes.dialogBody} data-dsh-git="stash-dialog">
      <label className={classes.fieldLabel} htmlFor={nameId}>{t('stash.name')}</label>
      <input id={nameId} className={classes.fieldInput} data-dsh-git="stash-name" value={name}
        placeholder={t('stash.namePlaceholder')} autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }} />
      <p className={classes.hint}>{t('stash.hint')}</p>
    </div>
  </Modal>
}

/* --------------------------------------------------------------- worktrees */

/** Where a new worktree starts: a fresh branch, or an existing ref. */
type WorktreeSource =
  | { readonly mode: 'new' }
  | { readonly mode: 'ref'; readonly ref: string; readonly refKind: 'branch' | 'remote' | 'tag' }

function WorktreesSection(props: {
  state: PanelState
  t: Translate
  busy: boolean
  store: PanelStore
  collapsed: boolean
  onToggle: () => void
  onDelete: (worktree: WorktreeInfo) => void
  onMerge: (worktree: WorktreeInfo) => void
  onUpdate: (worktree: WorktreeInfo, base?: string) => void
  openWorktreeSession?: ((path: string) => Promise<void>) | undefined
  registerCreatedWorktree?: ((path: string) => Promise<void>) | undefined
}): React.ReactElement {
  const { state, t, busy, store, onDelete } = props
  const [name, setName] = React.useState('')
  const [issue, setIssue] = React.useState<string | null>(null)
  const [source, setSource] = React.useState<WorktreeSource>({ mode: 'new' })
  const [sourceOpen, setSourceOpen] = React.useState(false)
  const [sourceQuery, setSourceQuery] = React.useState('')
  const [baseOpen, setBaseOpen] = React.useState(false)
  const [confirm, setConfirm] = React.useState<{ request: WorktreeCreateRequest; preview: WorktreeSetupPreview } | null>(null)
  const base = state.worktreeBase
  const baseRef = base.name
  const current = state.head.branch ?? 'HEAD'
  const prunable = state.worktrees.filter((worktree) => worktree.prunable).length

  // One create path for the button and the field's Enter key: a new branch is
  // slugged and validated here, a picked ref is checked out as it is. The host
  // is always asked what the repository declares before anything runs, so a
  // project that ships setup work gets an explicit decision and a project that
  // ships none creates in the same click.
  const finishCreate = async (created: boolean, path: string): Promise<void> => {
    if (!created) return
    setSource({ mode: 'new' })
    setName('')
    try { await props.registerCreatedWorktree?.(path) }
    catch { setIssue(t('worktrees.registerFailed')) }
  }
  const startCreate = (request: WorktreeCreateRequest): void => {
    setIssue(null)
    void store.worktreeSetup(request).then((preview) => {
      if (preview === null) return
      if (!setupHasEffects(preview)) {
        void store
          .worktreeAdd({ ...request, expectedSetupVersion: preview.version })
          .then(created => finishCreate(created, preview.path))
        return
      }
      setConfirm({ request, preview })
    })
  }
  const create = (): void => {
    if (source.mode === 'ref') {
      startCreate({ mode: 'ref', ref: source.ref, refKind: source.refKind })
      return
    }
    const verdict = validateSlug(normalizeSlug(name))
    if (!verdict.ok) {
      setIssue(t(`issue.slug.${verdict.issue}` as MessageKey))
      return
    }
    startCreate({ mode: 'new', name: verdict.slug, ...(baseRef === null ? {} : { base: baseRef }) })
  }

  // The start point: a fresh branch from the comparison base, or any existing
  // local branch, remote branch or tag (a tag checks out detached). It is the
  // same picker the header's chip opens, so a branch reads the same here.
  const sourceGroups = partitionRefs(filterRefs(refOptions(state.branches, state.tags), sourceQuery))

  // The comparison base: every row's ahead/behind/merged column is measured
  // against it, so the choice is visible next to the list it changes.
  const baseItems: MenuEntry[] = [
    {
      id: 'default',
      label: t('worktrees.baseDefault'),
      ...(base.source === 'default-branch' ? { icon: <IconCheckOutlineRegular size={14} /> } : {}),
    },
    ...base.candidates.map((candidate): MenuEntry => ({
      id: candidate,
      label: candidate,
      ...(base.name === candidate ? { icon: <IconCheckOutlineRegular size={14} /> } : {}),
    })),
  ]

  /** Action row: start from a fresh branch off the comparison base. */
  const startFromNew = (): void => {
    setSourceOpen(false)
    setSourceQuery('')
    setIssue(null)
    setSource({ mode: 'new' })
  }

  /** Picked ref: check the worktree out at that branch, remote branch or tag. */
  const pickSource = (option: RefOption): void => {
    setSourceOpen(false)
    setSourceQuery('')
    setIssue(null)
    setSource({ mode: 'ref', ref: option.name, refKind: option.kind })
  }

  const pickBase = (id: string): void => {
    setBaseOpen(false)
    void store.setWorktreeBase(id === 'default' ? null : id)
  }

  return (
    <Section
      id="worktrees"
      title={t('worktrees.title')}
      count={state.worktrees.length}
      collapsed={props.collapsed}
      onToggle={props.onToggle}
    >
      {/* The create row owns the seat under the band: it is the section's one
          write, and it stays visible however long the list grows. */}
      <div className={`${classes.formRow} ${classes.formRowTop}`}>
        <input
          id="dsh-git-worktree-name"
          className={classes.input}
          placeholder={source.mode === 'new' ? t('worktrees.namePlaceholder') : t('worktrees.sourcePick')}
          aria-label={t('worktrees.namePlaceholder')}
          value={source.mode === 'new' ? name : source.ref}
          disabled={source.mode === 'ref'}
          data-dsh-git="worktree-name"
          onChange={(event) => {
            setName(event.target.value)
            setIssue(null)
          }}
          onKeyDown={(event) => {
            // Enter creates, unless it is confirming an IME composition.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) create()
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || (source.mode === 'new' && name.trim() === '')}
          onClick={() => create()}
        >
          {t('worktrees.create')}
        </Button>
      </div>
      {/* Where a new worktree starts, and what every row is measured against:
          both change what the list means, so both sit in the open. */}
      <div className={classes.contextRow}>
        <button
          type="button"
          className={classes.contextButton}
          data-dsh-git="worktree-source"
          aria-label={t('worktrees.source')}
          aria-haspopup="dialog"
          aria-expanded={sourceOpen}
          disabled={busy}
          onClick={() => setSourceOpen(true)}
        >
          <span className={classes.contextButtonLabel}>
            {source.mode === 'new' ? t('worktrees.sourceNewShort') : source.ref}
          </span>
          <IconChevronDownOutlineRegular size={12} />
        </button>
        {sourceOpen ? (
          <RefQuickPick
            marker="ref-picker"
            title={t('worktrees.source')}
            placeholder={t('worktrees.sourcePick')}
            groups={sourceGroups}
            actions={[{
              id: 'new',
              label: t('worktrees.sourceNew', { branch: baseRef ?? t('worktrees.baseNone') }),
              icon: source.mode === 'new' ? <IconCheckOutlineRegular size={14} /> : <IconPlusOutlineRegular size={14} />,
            }]}
            query={sourceQuery}
            onQuery={setSourceQuery}
            selectedId={source.mode === 'ref' ? `${source.refKind}:${source.ref}` : null}
            emptyLabel={t('picker.empty')}
            t={t}
            onClose={() => { setSourceOpen(false); setSourceQuery('') }}
            onAction={startFromNew}
            onPick={pickSource}
          />
        ) : null}
        {base.name === null ? null : (
          <Menu
            open={baseOpen}
            anchor={
              <button
                type="button"
                className={classes.contextButton}
                data-dsh-git="worktree-base"
                aria-label={t('worktrees.base')}
                disabled={busy}
                onClick={() => setBaseOpen(!baseOpen)}
              >
                <span className={classes.contextButtonLabel}>
                  {t('worktrees.baseLabel', { branch: base.name })}
                </span>
                <IconChevronDownOutlineRegular size={12} />
              </button>
            }
            items={baseItems}
            onSelect={pickBase}
            onClose={() => setBaseOpen(false)}
            align="start"
            portal
          />
        )}
        {prunable === 0 ? null : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void store.worktreePrune()}>
            {t('worktrees.prune')}
          </Button>
        )}
      </div>
      {issue === null ? null : <div className={classes.issue}>{issue}</div>}
      <div className={classes.caption} data-dsh-git="worktrees-hint">
        {t('worktrees.openHint')}
      </div>
      {state.worktrees.length === 0 ? (
        <div className={classes.empty}>
          <span className={classes.emptyTitle}>{t('worktrees.empty')}</span>
          <span className={classes.emptyHint}>{t('worktrees.emptyHint')}</span>
        </div>
      ) : null}
      {state.worktrees.map((worktree) => {
        // The branch is the identity; the slug only names the folder.
        const label = worktree.branch ?? worktree.slug ?? t('worktrees.detached')
        const baseLabel = baseRef ?? current
        const meta = [
          worktree.clean ? t('worktrees.clean') : t('worktrees.dirty'),
          worktree.ahead > 0 ? t('worktrees.ahead', { count: worktree.ahead }) : null,
          worktree.behind > 0 ? t('worktrees.behind', { count: worktree.behind }) : null,
          worktree.merged && baseRef !== null ? t('worktrees.mergedInto', { branch: baseRef }) : null,
          worktree.locked
            ? worktree.lockedReason === null
              ? t('worktrees.locked')
              : t('worktrees.lockedReason', { reason: worktree.lockedReason })
            : null,
          worktree.prunable ? t('worktrees.prunable') : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')
        const canMerge = worktree.branch !== null && worktree.branch !== current
        return (
          <div key={worktree.path} className={`${classes.row} ${classes.rowStatic}`} data-dsh-git="worktree">
            <div className={classes.rowMain}>
              <span className={classes.rowPath}>
                {label}
                {worktree.primary ? (
                  <Tag tone="neutral" className={classes.badge}>
                    {t('worktrees.primary')}
                  </Tag>
                ) : null}
              </span>
              <span className={classes.worktreePath} title={worktree.path}>
                {/* The primary checkout is the repository itself, so it shows the
                    folder name; linked worktrees show their path inside it. */}
                {worktree.primary
                  ? baseName(state.root)
                  : worktree.path.startsWith(`${state.root}/`)
                    ? worktree.path.slice(state.root.length + 1)
                    : worktree.path}
              </span>
              <span className={classes.rowMeta} data-dsh-git="worktree-meta">
                {meta}
              </span>
            </div>
            <div className={classes.rowActions}>
              {worktree.primary ? null : (
                <>
                  {props.openWorktreeSession === undefined ? null : (
                    <button
                      type="button"
                      className={classes.iconButton}
                      aria-label={t('worktrees.openSession')}
                      title={t('worktrees.openSession')}
                      data-dsh-git="worktree-open-session"
                      disabled={busy}
                      onClick={() => {
                        setIssue(null)
                        void props.openWorktreeSession?.(worktree.path).catch(() => {
                          setIssue(t('worktrees.openFailed'))
                        })
                      }}
                    >
                      <IconFolderOpenRegular size={14} />
                    </button>
                  )}
                  <HoverCard
                    anchor={
                      <button
                        type="button"
                        className={classes.iconButton}
                        aria-label={t('worktrees.update', { branch: baseLabel })}
                        disabled={busy}
                        onClick={() => props.onUpdate(worktree, baseRef ?? undefined)}
                      >
                        <IconRefreshOutlineRegular size={14} />
                      </button>
                    }
                    content={t('worktrees.update', { branch: baseLabel })}
                    copyLabel={t('worktrees.update', { branch: baseLabel })}
                    copiedLabel={t('diff.copied')}
                  />
                  {canMerge ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => props.onMerge(worktree)}
                    >
                      {t('worktrees.merge', { branch: current })}
                    </Button>
                  ) : null}
                  {worktree.locked ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void store.worktreeUnlock(worktree.path)}
                    >
                      {t('worktrees.unlock')}
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    className={classes.iconButton}
                    aria-label={t('worktrees.delete')}
                    disabled={busy}
                    onClick={() => onDelete(worktree)}
                  >
                    <IconTrashOutlineRegular size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
      {confirm === null ? null : (
        <WorktreeSetupDialog
          preview={confirm.preview}
          t={t}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={(approval) => {
            const pending = confirm
            setConfirm(null)
            void store
              .worktreeAdd({
                ...pending.request,
                setupApproved: approval.setupApproved,
                copyApproved: approval.copyApproved,
                expectedSetupVersion: pending.preview.version,
              })
              .then(created => finishCreate(created, pending.preview.path))
          }}
        />
      )}
    </Section>
  )
}


/* -------------------------------------------------------------------- diff */

/**
 * The diff header's "open in the viewer" control.
 *
 * This is the panel's only read of the enclosing tab's framework hook, and
 * that hook throws while the tab record is not committed — a state the shell
 * passes through during a session switch or a layout restore. Keeping the read
 * in its own component, under a null-fallback guard, means such a throw costs
 * one button instead of the whole panel, and never retires the tab's
 * registration.
 */
function OpenFileButton(props: {
  t: Translate
  useTabInfo: () => GitTabInfo
  address: string
}): React.ReactElement {
  const { t, useTabInfo, address } = props
  const tabInfo = useTabInfo()
  return (
    <button
      type="button"
      className={classes.iconButton}
      aria-label={t('changes.open')}
      title={t('changes.open')}
      data-dsh-git="diff-open-file"
      onClick={() => tabInfo.tab.actions.openResource(address)}
    >
      <IconFolderOpenRegular size={14} />
    </button>
  )
}

/**
 * Publish the enclosing tab's actions to the panel.
 *
 * The framework's tab hook is a real hook — it may only run during render —
 * while a row click is an event handler, so the two cannot meet directly. This
 * seat reads the hook where the rules allow and writes the actions into the
 * panel's ref; the boundary around it keeps an uncommitted record from costing
 * the panel its own registration.
 */
function TabActionsSink(props: {
  useTabInfo: () => GitTabInfo
  sink: React.MutableRefObject<GitTabInfo['tab']['actions'] | null>
}): null {
  const tabInfo = props.useTabInfo()
  props.sink.current = tabInfo.tab.actions
  return null
}

function DiffPane(props: {
  sessionId: string
  store: PanelStore
  snapshot: PanelSnapshot
  t: Translate
  onBack: () => void
  /** Resource address of one changed path, or null while there is no state. */
  addressFor: (path: string) => string | null
  useTabInfo?: (() => GitTabInfo) | undefined
}): React.ReactElement {
  const { snapshot, t, onBack, addressFor } = props
  const view = snapshot.view
  const path = view.kind === 'diff' ? view.path : ''
  const [copied, setCopied] = React.useState(false)
  const file = snapshot.diff?.file ?? null
  const readTabInfo = props.useTabInfo
  const openAddress = readTabInfo === undefined ? null : addressFor(path)

  React.useEffect(() => {
    setCopied(false)
  }, [path])

  return (
    <div data-dsh-git="diff">
      <div className={classes.diffHeader} data-dsh-git="diff-header">
        <button
          type="button"
          className={classes.iconButton}
          aria-label={t('diff.back')}
          title={t('diff.back')}
          data-dsh-git="diff-back"
          onClick={onBack}
        >
          <IconChevronLeftOutlineRegular size={14} />
        </button>
        <span className={classes.diffTitle} title={file?.displayPath ?? path}>
          {baseName(file?.displayPath ?? path)}
        </span>
        {openAddress === null || readTabInfo === undefined ? null : (
          <PanelBoundary renderFallback={() => null} resetKey={openAddress}>
            <OpenFileButton t={t} useTabInfo={readTabInfo} address={openAddress} />
          </PanelBoundary>
        )}
        <button
          type="button"
          className={classes.iconButton}
          aria-label={copied ? t('diff.copied') : t('diff.copyPatch')}
          title={copied ? t('diff.copied') : t('diff.copyPatch')}
          disabled={file === null}
          onClick={() => {
            if (file === null) return
            void writeClipboard(file.patch).then(() => setCopied(true))
          }}
        >
          {copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
        </button>
      </div>
      {view.kind === 'diff' ? <HunkControls sessionId={props.sessionId} path={view.path} side={view.side} api={props.store.api} t={t} onChanged={() => props.store.refresh()} onWholeFile={() => view.side === 'staged' ? props.store.unstage([view.path]) : props.store.stage([view.path])} /> : null}
      <div className={classes.diffBody} data-dsh-git="diff-body">
        {snapshot.diffLoading ? <div className={classes.caption}>{t('diff.loading')}</div> : null}
        {!snapshot.diffLoading && file === null ? (
          <div className={classes.caption}>{t('diff.empty')}</div>
        ) : null}
        {file === null ? null : <FileDiff file={file} t={t} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- title */

/**
 * The live chip title: branch name, or the changed-file count.
 *
 * The chip is never blank. With neither a branch nor a count to show — no
 * store yet, a store mid-read, an empty branch name — the type label speaks,
 * read fresh so a language change reaches it. The label is the last resort
 * rather than the title recorded when the tab opened, which would freeze the
 * copy in the language of that moment.
 */
export function GitTitle(props: { t: Translate; sessionId?: string }): React.ReactElement {
  const { t } = props
  // The body registers this session's store a beat after the strip paints.
  React.useSyncExternalStore(subscribeStores, storesVersion, storesVersion)
  const store = peekStore(props.sessionId)
  const snapshot = React.useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => null),
    store?.getSnapshot ?? (() => null),
  )
  const state = snapshot?.state ?? null
  const head = state?.head ?? null
  const branch = head?.branch ?? null
  const label = branch !== null && branch !== ''
    ? branch
    : head?.detached === true
      ? t('header.detached')
      : null
  const count = state === null
    ? 0
    : state.changes.staged.length + state.changes.unstaged.length + state.changes.untracked.length
  return (
    <React.Fragment>
      <IconBranchOutlineRegular size={14} className={classes.branchGlyph} />
      <span data-dsh-git="chip-title">{label ?? (count > 0 ? `${t('type.label')} (${count})` : t('type.label'))}</span>
    </React.Fragment>
  )
}

/**
 * The change view's chip title: the branch glyph, then the file name.
 *
 * The glyph is the point: several tabs can be open on the same file name from
 * different surfaces, and the branch marks this one as Source control's own
 * view of a change rather than a plain file preview. The name comes from the
 * address the tab was opened with, so it stays right without the panel store.
 */
export function ChangeFileTitle(props: { t: Translate; address: string }): React.ReactElement {
  const title = changeFileTitle(props.address)
  return (
    <React.Fragment>
      <IconBranchOutlineRegular size={14} className={classes.branchGlyph} />
      <span data-dsh-git="change-file-chip">{title === '' ? props.t('type.label') : title}</span>
    </React.Fragment>
  )
}

/** Build a confirmation for a preflight verdict the host refused. */
export function confirmationFromPreflight(
  decision: PreflightDecision,
  t: Translate,
): { readonly title: string; readonly body: string } | null {
  if (decision.verdict === 'allow') return null
  return { title: t(failureTitleKey(decision.code)), body: decision.detail }
}
