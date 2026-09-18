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
  DiffBlock,
  HoverCard,
  IconBranchOutline16,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconCopyOutline16,
  IconEllipsisOutline16,
  FileTypeIcon,
  IconFolderOpen16,
  IconLoadingOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSparkle16,
  IconTrashOutline16,
  IconWarningOutline16,
  Menu,
  Modal,
  StateDot,
  Tag,
  Tooltip,
  writeClipboard,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { targetFileAddress, workspacePathFor } from '../core/address.ts'
import type { AgentVerb } from '../core/agent-verbs.ts'
import { toDiffHunks } from '../core/diff.ts'
import { graphWidth } from '../core/log.ts'
import type {
  BranchInfo,
  CommitSummary,
  DiffSide,
  GitFailureCode,
  PanelState,
  PreflightDecision,
  StatusEntry,
  WorktreeInfo,
} from '../core/types.ts'
import { normalizeSlug, validateSlug } from '../core/worktree.ts'
import { PanelStore, type PanelSection, type PanelSnapshot } from './controller.ts'
import type { MessageKey } from './dictionaries.ts'
import classes from './panel.module.css'

/** The translator the slot framework injects for this package's namespace. */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/** Props the panel body needs beyond the framework's own shares. */
export interface GitPanelProps {
  readonly sessionId: string
  readonly useTabInfo: () => {
    readonly tab: {
      readonly title: string
      readonly actions: { openResource(address: string, options?: unknown): void }
    }
  }
  readonly t: Translate
  /**
   * Queue a prompt into the current session; the client entry wires this to
   * the session face. Without it the agent verbs are hidden rather than
   * silently doing nothing.
   */
  readonly sendPrompt?: ((prompt: string) => void | Promise<void>) | undefined
}

/* ------------------------------------------------------------------ glyphs */

/** The branch glyph used in the chip and at the guide capsule. */
export function BranchGlyph({ size = 16 }: { size?: number }): React.ReactElement {
  return <IconBranchOutline16 size={size} />
}

/* --------------------------------------------------------------- confirm UI */

/** One pending danger confirmation, derived from a preflight verdict. */
interface Confirmation {
  readonly title: TranslateKey
  readonly body: TranslateKey
  readonly params: Record<string, string | number>
  readonly danger: boolean
  readonly run: () => void
}

type TranslateKey = MessageKey

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

/* ------------------------------------------------------------------- panel */

export function GitPanel(props: GitPanelProps): React.ReactElement {
  const { sessionId, useTabInfo, t } = props
  const store = usePanelStore(sessionId)
  const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(null)
  const [branchOpen, setBranchOpen] = React.useState(false)
  const [toolsOpen, setToolsOpen] = React.useState(false)
  const tabInfo = useTabInfo()

  // The live chip title reads the same store; the body keeps it alive.
  React.useEffect(() => {
    void store.start(getWindow())
    return () => {
      releaseStore(sessionId)
    }
  }, [store, sessionId])

  const state = snapshot.state
  const busy = snapshot.busy !== null

  const onDiscard = (paths: readonly string[]): void => {
    setConfirmation({
      title: 'confirm.discard',
      body: 'confirm.discardBody',
      params: { count: paths.length },
      danger: true,
      run: () => void store.discard(paths),
    })
  }

  const onWorktreeDelete = (worktree: WorktreeInfo): void => {
    setConfirmation({
      title: 'confirm.deleteWorktree',
      body: worktree.merged ? 'confirm.deleteWorktreeBody' : 'confirm.deleteWorktreeUnmerged',
      params: { path: worktree.path },
      danger: true,
      run: () => void store.worktreeRemove(worktree.path, !worktree.clean || !worktree.merged, true),
    })
  }

  const onBranchSwitch = (branch: BranchInfo): void => {
    if (branch.current) return
    const dirty = state !== null && (state.changes.unstaged.length > 0 || state.changes.untracked.length > 0)
    const run = (): void => void store.branchSwitch(branch.name)
    if (!dirty) {
      run()
      return
    }
    setConfirmation({
      title: 'confirm.switchBranch',
      body: 'confirm.switchBranchBody',
      params: { branch: branch.name },
      danger: false,
      run,
    })
  }

  const onBranchDelete = (branch: BranchInfo): void => {
    setConfirmation({
      title: 'confirm.deleteBranch',
      body: 'confirm.deleteBranchUnmerged',
      params: { branch: branch.name },
      danger: true,
      run: () => void store.branchDelete(branch.name, true),
    })
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
  // so the path is rebased first.
  const openFile = (path: string): void => {
    if (state === null) return
    const target = workspacePathFor(state.cwd, state.root, path)
    tabInfo.tab.actions.openResource(targetFileAddress(sessionId, target))
  }

  return (
    <div className={classes.root} data-dsh-git="panel">
      <PanelHeader
        snapshot={snapshot}
        t={t}
        store={store}
        branchOpen={branchOpen}
        setBranchOpen={setBranchOpen}
        toolsOpen={toolsOpen}
        setToolsOpen={setToolsOpen}
        busy={busy}
        onRefresh={() => void store.refresh()}
        onSwitch={onBranchSwitch}
        onDeleteBranch={onBranchDelete}
        onNewWorktree={() => {
          const form = document.getElementById('dsh-git-worktree-name')
          form?.focus()
        }}
        onAgentVerb={
          props.sendPrompt === undefined
            ? undefined
            : (verb) => void store.runAgentVerb(verb, props.sendPrompt!)
        }
      />
      <div className={classes.body} data-dsh-git="body">
        <Notices snapshot={snapshot} t={t} store={store} />
        {snapshot.view.kind === 'diff' ? (
          <DiffPane
            snapshot={snapshot}
            t={t}
            onBack={() => store.closeDiff()}
            onOpenFile={openFile}
          />
        ) : (
          <>
            {state === null ? null : (
              <>
                <CommitBox snapshot={snapshot} t={t} store={store} />
                <ChangesSection
                  state={state}
                  t={t}
                  busy={busy}
                  collapsed={snapshot.collapsed.changes}
                  onToggle={() => store.toggleSection('changes')}
                  onOpen={(path, side, oldPath) => void store.openDiff(path, side, oldPath)}
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
                />
                <HistorySection
                  snapshot={snapshot}
                  t={t}
                  store={store}
                  collapsed={snapshot.collapsed.history}
                  onToggle={() => store.toggleSection('history')}
                  onCheckout={onCheckout}
                />
              </>
            )}
          </>
        )}
      </div>
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
                onClick={() => {
                  confirmation.run()
                  setConfirmation(null)
                }}
              >
                {confirmation.danger ? t('confirm.force') : t('confirm.proceed')}
              </Button>
            </>
          }
        >
          <p className={classes.bannerBody}>{t(confirmation.body, confirmation.params)}</p>
        </Modal>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- the store */

/** Stores are shared between the body and the live chip title. */
const stores = new Map<string, { store: PanelStore; refs: number; release: (() => void) | null }>()

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
  readonly branchOpen: boolean
  readonly setBranchOpen: (open: boolean) => void
  readonly toolsOpen: boolean
  readonly setToolsOpen: (open: boolean) => void
  readonly onRefresh: () => void
  readonly onSwitch: (branch: BranchInfo) => void
  readonly onDeleteBranch: (branch: BranchInfo) => void
  readonly onNewWorktree: () => void
  readonly onAgentVerb?: ((verb: AgentVerb, prompt: string) => void) | undefined
}

function PanelHeader(props: HeaderProps): React.ReactElement {
  const { snapshot, t, store, busy, branchOpen, setBranchOpen, toolsOpen, setToolsOpen } = props
  const state = snapshot.state
  const head = state?.head
  const label = head === undefined || head === null
    ? t('state.noRepository')
    : head.unborn
      ? t('header.unborn')
      : head.branch ?? t('header.detached')

  const branchItems: MenuEntry[] = (state?.branches ?? []).map((branch) => ({
    id: branch.name,
    label: branch.remote ? `${branch.name} (${t('branches.remote')})` : branch.name,
    ...(branch.current ? { icon: <IconCheckOutline16 size={14} /> } : {}),
  }))

  const toolItems: MenuEntry[] = [
    { id: 'agent-review', label: t('agent.review') },
    { id: 'agent-explain', label: t('agent.explain') },
    { id: 'agent-draft', label: t('agent.draft') },
    { id: 'agent-resolve', label: t('agent.resolve') },
  ]

  return (
    <header className={classes.header}>
      <div className={classes.headerMain}>
        <Menu
          open={branchOpen}
          anchor={
            <button
              type="button"
              className={classes.branchButton}
              onClick={() => setBranchOpen(!branchOpen)}
              data-dsh-git="branch-button"
              aria-label={t('header.branchMenu')}
            >
              <IconBranchOutline16 size={14} className={classes.branchGlyph} />
              <span className={classes.branchName} title={label}>
                {label}
              </span>
              <IconChevronDownOutline14 size={12} className={classes.branchGlyph} />
            </button>
          }
          items={branchItems}
          selectedId={head?.branch ?? undefined}
          onSelect={(id) => {
            setBranchOpen(false)
            const branch = state?.branches.find((candidate) => candidate.name === id)
            if (branch !== undefined) props.onSwitch(branch)
          }}
          onClose={() => setBranchOpen(false)}
          align="start"
          portal
        />
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
            <IconRefreshOutline16 size={14} />
          </button>
        ) : null}
      </div>
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
              <IconSparkle16 size={16} />
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
        <IconRefreshOutline16 size={16} className={snapshot.reason === 'manual' && busy ? classes.spinning : undefined} />
      </button>
    </header>
  )
}

/* ----------------------------------------------------------------- notices */

function Notices(props: {
  snapshot: PanelSnapshot
  t: Translate
  store: PanelStore
}): React.ReactElement | null {
  const { snapshot, t, store } = props
  const blocks: React.ReactElement[] = []

  if (snapshot.phase === 'degraded' && snapshot.degraded !== null) {
    const degraded = snapshot.degraded
    blocks.push(
      <div className={classes.banner} key="degraded" data-dsh-git="degraded">
        <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
          <IconWarningOutline16 size={16} />
          <span>{degradedTitle(degraded.code, degraded, t)}</span>
        </div>
        <div className={classes.bannerBody}>{degradedFix(degraded.code, degraded, t)}</div>
      </div>,
    )
  } else if (snapshot.failure !== null) {
    blocks.push(
      <div className={classes.banner} key="failure" data-dsh-git="failure">
        <div className={`${classes.bannerTitle} ${classes.bannerError}`}>
          <IconWarningOutline16 size={16} />
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
    blocks.push(
      <div className={classes.banner} key="operation" data-dsh-git="operation">
        <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
          <StateDot state="warning" />
          <span>{t(`operation.${operation.kind}` as MessageKey)}</span>
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
          <Button size="sm" variant="primary" disabled={snapshot.busy !== null} onClick={() => void store.operationContinue()}>
            {t('operation.continue')}
          </Button>
          <Button size="sm" variant="ghost" disabled={snapshot.busy !== null} onClick={() => void store.operationAbort()}>
            {t('operation.abort')}
          </Button>
        </div>
      </div>,
    )
  }

  if (snapshot.hook !== null) {
    blocks.push(
      <div className={classes.banner} key="hook" data-dsh-git="hook">
        <div className={`${classes.bannerTitle} ${classes.bannerError}`}>
          <IconWarningOutline16 size={16} />
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
          <IconWarningOutline16 size={16} />
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
    'bare-repository': 'failure.bareRepository',
    'permission-denied': 'failure.permissionDenied',
    'identity-missing': 'failure.identityMissing',
    'index-locked': 'failure.indexLocked',
    'operation-in-progress': 'failure.operationInProgress',
    'dirty-tree': 'failure.dirtyTree',
    'not-merged': 'failure.notMerged',
    'detached-head': 'failure.detachedHead',
    'current-branch': 'failure.currentBranch',
    'branch-exists': 'failure.branchExists',
    'worktree-exists': 'failure.worktreeExists',
    'invalid-name': 'failure.invalidName',
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
function failureFix(code: GitFailureCode, t: Translate): string {
  const fixes: Partial<Record<GitFailureCode, MessageKey>> = {
    'index-locked': 'failure.fix.indexLocked',
    'operation-in-progress': 'failure.fix.operationInProgress',
    'dirty-tree': 'failure.fix.dirtyTree',
    'not-merged': 'failure.fix.notMerged',
    'detached-head': 'failure.fix.detachedHead',
    'identity-missing': 'failure.fix.identityMissing',
    'no-upstream': 'failure.fix.noUpstream',
    'path-missing': 'failure.fix.pathMissing',
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
      <div className={classes.sectionHeader}>
        <button
          type="button"
          className={classes.sectionToggle}
          data-dsh-git="section-toggle"
          data-section={id}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <IconChevronDownOutline14
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
  const total = changes.staged.length + changes.unstaged.length + changes.untracked.length

  return (
    <Section
      id="changes"
      title={t('changes.title')}
      count={total}
      collapsed={props.collapsed}
      onToggle={props.onToggle}
      actions={
        <>
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
              <IconPlusOutline16 size={14} />
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
              <IconChevronLeftOutline14 size={14} />
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
              <IconTrashOutline16 size={14} />
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
            if (event.key === 'Enter' || event.key === ' ') {
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
                    <IconChevronLeftOutline14 size={14} />
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
                    <IconPlusOutline16 size={14} />
                  </button>
                }
                content={t('changes.stage')}
                copyLabel={t('changes.stage')}
                copiedLabel={t('diff.copied')}
              />
            )}
            <button
              type="button"
              className={classes.iconButton}
              aria-label={t('changes.discard')}
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation()
                onDiscard([entry.path])
              }}
            >
              <IconTrashOutline16 size={14} />
            </button>
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

function CommitBox(props: {
  snapshot: PanelSnapshot
  t: Translate
  store: PanelStore
}): React.ReactElement | null {
  const { snapshot, t, store } = props
  const state = snapshot.state
  const [menuOpen, setMenuOpen] = React.useState(false)
  if (state === null) return null
  const branch = state.head.branch ?? 'HEAD'
  const placeholder = t('commit.placeholder', { mod: commitModifier(), branch })
  const message = snapshot.message.trim()
  const busy = snapshot.busy !== null
  const staged = state.changes.staged.filter((entry) => entry.unmerged === undefined).length
  const unstaged = state.changes.unstaged.filter((entry) => entry.unmerged === undefined).length
  const untracked = state.changes.untracked.length
  const canCommit = staged > 0 && !busy && message !== ''
  const canCommitAll = staged + unstaged + untracked > 0 && !busy && message !== ''

  // The commit button's menu: the same verbs VS Code puts behind its chevron,
  // minus the ones this panel cannot honestly do (it never pushes).
  const items: MenuEntry[] = [
    { id: 'commit', label: t('commit.button'), disabled: !canCommit },
    { id: 'amend', label: t('commit.amend'), disabled: !canCommit },
    { id: 'all', label: t('commit.all'), disabled: !canCommitAll },
  ]

  const submit = (): void => {
    if (!canCommit) return
    void store.commit(snapshot.message, false)
  }

  return (
    <div className={classes.commit} data-dsh-git="commit">
      <div className={classes.messageWrap}>
        <textarea
          className={classes.textarea}
          placeholder={placeholder}
          aria-label={t('commit.placeholder', { mod: '', branch })}
          value={snapshot.message}
          onChange={(event) => store.setMessage(event.target.value)}
          // VS Code's own chord: the message commits without reaching the mouse.
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
          data-dsh-git="commit-message"
        />
        <Tooltip label={t('commit.draft')} side="bottom">
          <button
            type="button"
            className={classes.messageAction}
            aria-label={t('commit.draft')}
            data-dsh-git="draft-message"
            disabled={busy}
            onClick={() => void store.draftMessage()}
          >
            <IconSparkle16 size={14} />
          </button>
        </Tooltip>
      </div>
      <div className={classes.commitSplit}>
        <Button
          className={classes.commitPrimary}
          size="sm"
          variant="primary"
          disabled={!canCommit}
          onClick={submit}
        >
          {t('commit.button')}
        </Button>
        <Menu
          open={menuOpen}
          className={classes.commitMenuAnchor}
          anchor={
            <Button
              className={classes.commitDropdown}
              size="sm"
              variant="primary"
              aria-label={t('commit.more')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-dsh-git="commit-menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <IconChevronDownOutline14 size={12} />
            </Button>
          }
          items={items}
          onSelect={(id) => {
            setMenuOpen(false)
            if (id === 'commit') void store.commit(snapshot.message, false)
            if (id === 'amend') void store.commit(snapshot.message, true)
            if (id === 'all') void store.commitAll(snapshot.message)
          }}
          onClose={() => setMenuOpen(false)}
          align="end"
          portal
        />
      </div>
      {staged === 0 ? (
        <span className={classes.commitHint}>
          {unstaged + untracked > 0 ? t('commit.nothingStagedButChanges') : t('commit.nothingStaged')}
        </span>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------- worktrees */

function WorktreesSection(props: {
  state: PanelState
  t: Translate
  busy: boolean
  store: PanelStore
  collapsed: boolean
  onToggle: () => void
  onDelete: (worktree: WorktreeInfo) => void
}): React.ReactElement {
  const { state, t, busy, store, onDelete } = props
  const [name, setName] = React.useState('')
  const [issue, setIssue] = React.useState<string | null>(null)
  const current = state.head.branch ?? 'HEAD'

  // One create path for the button and the field's Enter key: the slug is
  // folded and validated before the host is asked to do anything.
  const create = (): void => {
    const verdict = validateSlug(normalizeSlug(name))
    if (!verdict.ok) {
      setIssue(t(`issue.slug.${verdict.issue}` as MessageKey))
      return
    }
    setIssue(null)
    void store.worktreeAdd(verdict.slug).then(() => setName(''))
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
          placeholder={t('worktrees.namePlaceholder')}
          aria-label={t('worktrees.namePlaceholder')}
          value={name}
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
          disabled={busy || name.trim() === ''}
          onClick={() => create()}
        >
          {t('worktrees.create')}
        </Button>
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
      {state.worktrees.map((worktree) => (
        <div key={worktree.path} className={`${classes.row} ${classes.rowStatic}`} data-dsh-git="worktree">
          <div className={classes.rowMain}>
            <span className={classes.rowPath}>
              {worktree.slug ?? worktree.branch ?? t('worktrees.detached')}
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
            <span className={classes.rowMeta}>
              {worktree.clean ? t('worktrees.clean') : t('worktrees.dirty')}
              {worktree.ahead > 0 ? ` · ${t('worktrees.ahead', { count: worktree.ahead })}` : ''}
              {worktree.merged ? ` · ${t('worktrees.merged')}` : ''}
            </span>
          </div>
          <div className={classes.rowActions}>
            {worktree.primary ? null : (
              <>
                <HoverCard
                  anchor={
                    <button
                      type="button"
                      className={classes.iconButton}
                      aria-label={t('worktrees.update', { branch: current })}
                      disabled={busy}
                      onClick={() => void store.worktreeUpdate(worktree.path)}
                    >
                      <IconRefreshOutline16 size={14} />
                    </button>
                  }
                  content={t('worktrees.update', { branch: current })}
                  copyLabel={t('worktrees.update', { branch: current })}
                  copiedLabel={t('diff.copied')}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void store.worktreeMerge(worktree.path)}
                >
                  {t('worktrees.merge', { branch: current })}
                </Button>
                <button
                  type="button"
                  className={classes.iconButton}
                  aria-label={t('worktrees.delete')}
                  disabled={busy}
                  onClick={() => onDelete(worktree)}
                >
                  <IconTrashOutline16 size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </Section>
  )
}

/* ----------------------------------------------------------------- history */

function HistorySection(props: {
  snapshot: PanelSnapshot
  t: Translate
  store: PanelStore
  collapsed: boolean
  onToggle: () => void
  onCheckout: (commit: CommitSummary) => void
}): React.ReactElement {
  const { snapshot, t, store, onCheckout } = props
  const history = snapshot.history
  const [menuFor, setMenuFor] = React.useState<string | null>(null)
  const loaded = React.useRef(false)
  const width = history === null ? 0 : graphWidth(history.lanes)

  // A collapsed History section does not read the log: the first expansion is
  // what loads it.
  React.useEffect(() => {
    if (props.collapsed || loaded.current) return
    loaded.current = true
    void store.loadHistory()
  }, [store, props.collapsed])

  return (
    <Section
      id="history"
      title={t('history.title')}
      count={history === null ? null : history.commits.length}
      collapsed={props.collapsed}
      onToggle={props.onToggle}
      actions={
        <button
          type="button"
          className={classes.iconButton}
          aria-label={t('header.refresh')}
          title={t('header.refreshTitle')}
          onClick={() => void store.loadHistory()}
        >
          <IconRefreshOutline16 size={14} className={snapshot.historyLoading ? classes.spinning : undefined} />
        </button>
      }
    >
      {snapshot.historyLoading && history === null ? (
        <div className={classes.caption}>
          <IconLoadingOutline16 size={14} /> {t('history.loading')}
        </div>
      ) : null}
      {history !== null && history.commits.length === 0 ? (
        <div className={classes.empty}>
          <span className={classes.emptyTitle}>{t('history.empty')}</span>
        </div>
      ) : null}
      {history?.commits.map((commit, index) => {
        const lane = history.lanes[index]
        const items: MenuEntry[] = [
          { id: 'copy', label: t('history.copyHash'), icon: <IconCopyOutline16 size={14} /> },
          { id: 'checkout', label: t('history.checkout') },
          { id: 'revert', label: t('history.revert') },
          { id: 'cherry-pick', label: t('history.cherryPick') },
        ]
        return (
          <div
            key={commit.hash}
            className={`${classes.row} ${classes.commitRow}`}
            data-dsh-git="commit-row"
            data-hash={commit.hash}
          >
            <CommitGraph lane={lane?.lane ?? 0} width={width} />
            <div className={classes.rowMain}>
              <span className={classes.commitSubject} title={commit.subject}>
                {commit.subject}
              </span>
              <span className={classes.commitMeta}>
                <span className={classes.commitHash}>{commit.short}</span>
                <span>{commit.author}</span>
                {commit.refs.length === 0 ? null : <Tag tone="outline">{commit.refs[0]}</Tag>}
              </span>
            </div>
            <Menu
              open={menuFor === commit.hash}
              anchor={
                <button
                  type="button"
                  className={classes.iconButton}
                  aria-label={t('changes.actions')}
                  onClick={() => setMenuFor(menuFor === commit.hash ? null : commit.hash)}
                >
                  <IconEllipsisOutline16 size={14} />
                </button>
              }
              items={items}
              onSelect={(id) => {
                setMenuFor(null)
                if (id === 'copy') void writeClipboard(commit.hash)
                if (id === 'checkout') onCheckout(commit)
                if (id === 'revert') void store.revert(commit.hash)
                if (id === 'cherry-pick') void store.cherryPick(commit.hash)
              }}
              onClose={() => setMenuFor(null)}
              align="end"
              portal
            />
          </div>
        )
      })}
      {history !== null && history.hasMore ? (
        <div className={classes.formRow}>
          <Button size="sm" variant="ghost" onClick={() => void store.loadHistory(history.commits.length + 30)}>
            {t('history.loadMore')}
          </Button>
        </div>
      ) : null}
    </Section>
  )
}

/** The one-column graph mark for a commit row. */
function CommitGraph(props: { lane: number; width: number }): React.ReactElement {
  const indent = Math.min(props.lane, 8) * 8
  return (
    <span className={classes.graph} style={{ paddingLeft: `${indent}px` }} aria-hidden>
      <svg width="10" height="10" viewBox="0 0 10 10">
        <circle cx="5" cy="5" r="3" fill="currentColor" />
      </svg>
    </span>
  )
}

/* -------------------------------------------------------------------- diff */

function DiffPane(props: {
  snapshot: PanelSnapshot
  t: Translate
  onBack: () => void
  onOpenFile: (path: string) => void
}): React.ReactElement {
  const { snapshot, t, onBack, onOpenFile } = props
  const view = snapshot.view
  const path = view.kind === 'diff' ? view.path : ''
  const [copied, setCopied] = React.useState(false)
  const file = snapshot.diff?.file ?? null

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
          <IconChevronLeftOutline14 size={14} />
        </button>
        <span className={classes.diffTitle} title={file?.displayPath ?? path}>
          {baseName(file?.displayPath ?? path)}
        </span>
        <button
          type="button"
          className={classes.iconButton}
          aria-label={t('changes.open')}
          title={t('changes.open')}
          data-dsh-git="diff-open-file"
          onClick={() => onOpenFile(path)}
        >
          <IconFolderOpen16 size={14} />
        </button>
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
          {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
        </button>
      </div>
      <div className={classes.diffBody} data-dsh-git="diff-body">
        {snapshot.diffLoading ? <div className={classes.caption}>{t('diff.loading')}</div> : null}
        {!snapshot.diffLoading && file === null ? (
          <div className={classes.caption}>{t('diff.empty')}</div>
        ) : null}
        {file === null ? null : (
          <>
            <div className={classes.diffMeta}>
              <span className={classes.added}>{t('diff.added', { count: file.added })}</span>
              <span className={classes.removed}>{t('diff.removed', { count: file.removed })}</span>
            </div>
            {file.binary ? <div className={classes.caption}>{t('diff.binary')}</div> : null}
            {file.tooLarge ? (
              <>
                <div className={classes.caption}>
                  {t('diff.tooLarge', { added: file.added, removed: file.removed })}
                </div>
                <pre className={classes.patchBlock}>{file.patch}</pre>
              </>
            ) : null}
            {!file.binary && !file.tooLarge && file.hunks.length > 0 ? (
              <DiffBlock
                diffs={toDiffHunks(file)}
                maxLines={400}
                labels={{
                  copy: t('diffBlock.copy'),
                  copied: t('diffBlock.copied'),
                  collapseAria: t('diffBlock.collapseAria'),
                  expandAria: (hidden: number) => t('diffBlock.expandAria', { count: hidden }),
                  collapse: t('diffBlock.collapse'),
                  expand: (hidden: number) => t('diffBlock.expand', { count: hidden }),
                  files: (count: number) => t('diffBlock.files', { count }),
                }}
              />
            ) : null}
            {!file.binary && !file.tooLarge && file.hunks.length === 0 ? (
              <pre className={classes.patchBlock}>{file.patch}</pre>
            ) : null}
          </>
        )}
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
      <IconBranchOutline16 size={14} className={classes.branchGlyph} />
      <span data-dsh-git="chip-title">{label ?? (count > 0 ? `${t('type.label')} (${count})` : t('type.label'))}</span>
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
