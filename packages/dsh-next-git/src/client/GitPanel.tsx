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
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { changeFileAddress, targetFileAddress, workspacePathFor } from '../core/address.ts'
import type { AgentVerb } from '../core/agent-verbs.ts'
import type { RefOption } from '../core/refs.ts'
import { asApiError } from './api.ts'
import { BranchPicker } from './branches/BranchPicker.tsx'
import { ChangesSection } from './changes/ChangesSection.tsx'
import { WorktreesSection } from './worktrees/WorktreesSection.tsx'
import { DiffPane, TabActionsSink, type GitTabInfo } from './ui/DiffPane.tsx'
export type { GitTabInfo } from './ui/DiffPane.tsx'
export { MinusGlyph, commitModifier } from './changes/ChangesSection.tsx'
export { BranchGlyph, ChangeFileTitle, GitTitle } from './panel/GitTitle.tsx'
import type {
  CommitSummary,
  DiffSide,
  PanelState,
  PreflightAction,
  WorktreeInfo,
} from '../core/types.ts'
import { PanelStore, type PanelSnapshot } from './controller.ts'
import type { MessageKey, Translate } from './dictionaries.ts'
export type { Translate } from './dictionaries.ts'
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
import { PanelHeader } from './panel/PanelHeader.tsx'
import { Notices } from './panel/Notices.tsx'
import { failureTitleKey } from './panel/failure-copy.ts'
import { usePanelStore } from './panel/store-registry.ts'
import { PanelBoundary, PanelCrashed } from './panel/PanelBoundary.tsx'
export { GitPanelUnavailable, PanelBoundary, PanelCrashed } from './panel/PanelBoundary.tsx'
export { failureTitleKey, failureFix, confirmationFromPreflight } from './panel/failure-copy.ts'
export { configurePanelApi, peekStore, releaseStore, setPanelApi, storesVersion, subscribeStores, usePanelStore, type GitApiLike } from './panel/store-registry.ts'

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

/** One pending danger confirmation, derived from a preflight verdict. */
interface Confirmation {
  readonly title: MessageKey
  readonly body: MessageKey
  readonly params: Record<string, string | number>
  /** Host-reported paths and reason, shown verbatim under the body. */
  readonly detail?: string
  /** Label for the proceed button; the danger default is not always apt. */
  readonly confirmLabel?: MessageKey
  readonly danger: boolean
  readonly run: () => void
}

/**
 * One History command waiting for its own modal. Inspect and Compare read; the
 * six action kinds are the only commits the host will be asked to rewrite.
 */
type HistoryModalRequest =
  | { readonly kind: 'inspect'; readonly commits: readonly CommitSummary[] }
  | { readonly kind: 'compare'; readonly commits: readonly CommitSummary[] }
  | { readonly kind: 'action'; readonly action: HistoryAction; readonly commits: readonly CommitSummary[] }

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

function GitPanelBody(props: GitPanelProps): React.ReactElement | null {
  const store = usePanelStore(props.sessionId)
  return store === null ? null : <GitPanelContent {...props} store={store} />
}

function GitPanelContent(props: GitPanelProps & { store: PanelStore }): React.ReactElement {
  const { sessionId, t, store } = props
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
    let scope: AgentActionRequest['scope']
    if (verb === 'draft') {
      scope = { side: 'staged' }
    } else if (view.kind === 'diff' && (
      verb !== 'resolve' || snapshot.state?.changes.conflicts.some((entry) => entry.path === view.path)
    )) {
      scope = { paths: [view.path], side: view.side }
    }
    setAgentRequest({ verb, ...(scope === undefined ? {} : { scope }) })
  }
  React.useEffect(() => props.agentSessions?.subscribeRefresh(() => store.agentTurnEnded()), [props.agentSessions, store])

  // The registry owns the committed store lifetime; this view starts its read.
  React.useEffect(() => {
    void store.start(getWindow())
  }, [store])

  const state = snapshot.state
  const busy = snapshot.busy !== null
  // The child reads the framework hook during render and publishes the actions
  // after commit; a missing hook also clears previously committed actions.
  const tabActions = React.useRef<GitTabInfo['tab']['actions'] | null>(null)
  React.useLayoutEffect(() => {
    if (props.useTabInfo === undefined) tabActions.current = null
  }, [props.useTabInfo])
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
  const renderHistoryModal = (): React.ReactNode => {
    if (historyModal === null) return null
    if (historyModal.kind === 'inspect') {
      return <CommitDetailsModal sessionId={sessionId} commits={historyModal.commits} t={t} api={store.api} onClose={closeHistoryModal} />
    }
    if (historyModal.kind === 'compare') {
      return <CompareModal sessionId={sessionId} commits={historyModal.commits} t={t} api={store.api} onClose={closeHistoryModal} />
    }
    return <HistoryActionModal sessionId={sessionId} action={historyModal.action} commits={historyModal.commits}
      t={t} api={store.api} agentSessions={props.agentSessions} root={state?.root} cwd={state?.cwd}
      onClose={closeHistoryModal} onChanged={() => store.refresh()} />
  }

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
      {renderHistoryModal()}
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

/** The window-like trigger target; `undefined` under jsdom without a window. */
function getWindow(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window
}
