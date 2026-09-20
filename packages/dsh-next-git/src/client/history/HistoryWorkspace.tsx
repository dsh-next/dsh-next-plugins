import * as React from 'react'
import { Button, Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { defaultHistoryOrder, type HistoryAction, type HistoryPreview, type HistoryRecovery, type HistoryRequest, type HistoryStatus } from '../../core/history-plan.ts'
import type { CommitComparison, CommitDetails, CommitFile } from '../../core/history-view.ts'
import type { CommitSummary, DiffResult, StatePayload } from '../../core/types.ts'
import { asApiError, type GitApi } from '../api.ts'
import type { Translate } from '../GitPanel.tsx'
import type { AgentActionRequest } from '../ai/action-dialog.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './history-workspace.module.css'

export interface HistoryWorkspaceViewProps {
  sessionId: string
  /** Chronological, oldest first, supplied by HistorySectionView. */
  selection: readonly CommitSummary[]
  initialAction?: HistoryAction
  t: Translate
  api: GitApi
  onClose(): void
  onChanged(): Promise<void> | void
  onAskAgent?(request: AgentActionRequest): void
}

const actions = ['squash', 'fixup', 'reorder', 'reword', 'cherry-pick', 'revert'] as const
const memory = new Map<string, string>()
const storageKey = (session: string, checkout: string): string => 'dsh-next-git:history:' + JSON.stringify([session, checkout])
type DestructiveRecovery = 'skip' | 'abort' | 'restore'

/** A new session or selection owns a new request lifetime. */
export function HistoryWorkspaceView(props: HistoryWorkspaceViewProps): React.ReactElement {
  return <Workspace key={JSON.stringify([props.sessionId, props.selection.map(commit => commit.hash), props.initialAction])} {...props} />
}

function Workspace({ sessionId, selection, initialAction, t, api, onClose, onChanged, onAskAgent }: HistoryWorkspaceViewProps): React.ReactElement {
  const ids = selection.map(commit => commit.hash)
  const [action, setAction] = React.useState<HistoryAction>(initialAction ?? 'cherry-pick')
  const [mode, setMode] = React.useState<'inspect' | 'compare' | 'plan'>(initialAction ? 'plan' : selection.length === 2 ? 'compare' : 'inspect')
  const [order, setOrder] = React.useState(() => defaultHistoryOrder(initialAction ?? 'cherry-pick', ids))
  const [message, setMessage] = React.useState(selection.map(commit => commit.subject).join('\n\n'))
  const [hash, setHash] = React.useState(ids[0] ?? '')
  const [from, setFrom] = React.useState(ids[0] ?? '')
  const [to, setTo] = React.useState(ids.at(-1) ?? '')
  const [details, setDetails] = React.useState<CommitDetails | null>(null)
  const [file, setFile] = React.useState<CommitFile | null>(null)
  const [diff, setDiff] = React.useState<DiffResult | null>(null)
  const [comparison, setComparison] = React.useState<CommitComparison | null>(null)
  const [preview, setPreview] = React.useState<HistoryPreview | null>(null)
  const [status, setStatus] = React.useState<HistoryStatus | null>(null)
  const [ack, setAck] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [resuming, setResuming] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [readError, setReadError] = React.useState(false)
  const [storageWarning, setStorageWarning] = React.useState(false)
  const [uncertain, setUncertain] = React.useState(false)
  const [confirmation, setConfirmation] = React.useState<DestructiveRecovery | null>(null)
  const [readVersion, setReadVersion] = React.useState(0)
  const body = React.useRef<HTMLDivElement>(null)
  const recoveryTrigger = React.useRef<HTMLElement | null>(null)
  const alive = React.useRef(true)
  const writing = React.useRef(false)
  const checkout = React.useRef<string | null>(null)
  const operationId = React.useRef<string | null>(null)
  const generation = React.useRef(0)
  useDialogFocus(body)
  React.useEffect(() => {
    if (confirmation) body.current?.querySelector<HTMLButtonElement>('button')?.focus()
    else if (recoveryTrigger.current?.isConnected) { recoveryTrigger.current.focus(); recoveryTrigger.current = null }
  }, [confirmation])
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; ++generation.current } }, [])

  function remember(value: HistoryPreview): void {
    operationId.current = value.operationId
    checkout.current = value.binding.checkout
    const key = storageKey(sessionId, value.binding.checkout)
    memory.set(key, value.operationId)
    try { sessionStorage.setItem(key, value.operationId) } catch { setStorageWarning(true) }
  }
  function forget(): void {
    const root = checkout.current
    if (root) {
      const key = storageKey(sessionId, root)
      memory.delete(key)
      try { sessionStorage.removeItem(key) } catch { setStorageWarning(true) }
    }
    operationId.current = null
  }
  function install(value: HistoryStatus): void {
    remember(value.preview)
    setPreview(value.preview); setStatus(value); setAck(false); setUncertain(false)
    setAction(value.preview.plan.action); setOrder([...value.preview.plan.ordered]); setMessage(value.preview.plan.message ?? '')
  }
  function failure(cause: unknown): void {
    const code = asApiError(cause).code
    setError(code === 'dirty-tree' || code === 'operation-in-progress' ? t('historyPlan.stale') : t('historyPlan.failed'))
  }

  // Props intentionally carry no checkout path. Read the authoritative session checkout
  // before looking up a saved operation; never restore another checkout's operation.
  React.useEffect(() => {
    const abort = new AbortController()
    void (async () => {
      try {
        const value = await api.call<StatePayload>('getState', { sessionId }, abort.signal)
        if (!alive.current || abort.signal.aborted) return
        checkout.current = value.state.root
        const key = storageKey(sessionId, value.state.root)
        let saved: string | null
        try { saved = sessionStorage.getItem(key) ?? memory.get(key) ?? null } catch { saved = memory.get(key) ?? null; setStorageWarning(true) }
        if (!saved) return
        operationId.current = saved
        setUncertain(true)
        const resumed = await api.call<HistoryStatus>('historyOperationStatus', { sessionId, operationId: saved }, abort.signal)
        if (!alive.current || abort.signal.aborted) return
        if (resumed.preview.binding.checkout !== value.state.root) { setError(t('historyPlan.stale')); return }
        install(resumed); setMode('plan')
      } catch (cause) { if (alive.current && !abort.signal.aborted) failure(cause) }
      finally { if (alive.current && !abort.signal.aborted) setResuming(false) }
    })()
    return () => abort.abort()
  }, [api, sessionId])

  React.useEffect(() => {
    const abort = new AbortController()
    setDetails(null); setFile(null); setDiff(null); setComparison(null); setReadError(false)
    if (mode === 'plan' || !hash) { setLoading(false); return () => abort.abort() }
    setLoading(true)
    void (async () => {
      try {
        if (mode === 'inspect') {
          const result = await api.call<CommitDetails>('getCommitDetails', { sessionId, hash }, abort.signal)
          if (abort.signal.aborted) return
          setDetails(result); setFile(result.files[0] ?? null)
        } else if (from && to && from !== to) {
          const result = await api.call<CommitComparison>('compareCommits', { sessionId, from, to }, abort.signal)
          if (!abort.signal.aborted) setComparison(result)
        }
      } catch { if (!abort.signal.aborted) setReadError(true) }
      finally { if (!abort.signal.aborted) setLoading(false) }
    })()
    return () => abort.abort()
  }, [api, sessionId, mode, hash, from, to, readVersion])

  React.useEffect(() => {
    const abort = new AbortController()
    setDiff(null)
    if (!file || mode !== 'inspect') return () => abort.abort()
    void api.call<DiffResult>('getCommitDiff', { sessionId, hash, path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }) }, abort.signal)
      .then(value => { if (!abort.signal.aborted) setDiff(value) })
      .catch(() => { if (!abort.signal.aborted) setReadError(true) })
    return () => abort.abort()
  }, [api, sessionId, hash, file, mode])

  const activeOperation = status !== null && !['preview', 'completed', 'aborted', 'cancelled', 'recovered'].includes(status.phase)
  const locked = busy || resuming || uncertain || activeOperation
  const needsMessage = action === 'squash' || action === 'reword'
  const invalid = ids.length === 0 || ids.length > 100 || (needsMessage && (!message.trim() || message.includes('\0') || message.length > 65536))
    || (action === 'reword' && ids.length !== 1) || (['squash', 'fixup', 'reorder'].includes(action) && ids.length < 2)
    || selection.some(commit => commit.parents.length !== 1)
  const editable = !locked && (!status || status.phase === 'preview')
  function invalidate(): void {
    ++generation.current; setPreview(null); setStatus(null); setAck(false); setError(null); forget()
  }
  function chooseAction(value: HistoryAction): void {
    invalidate(); setAction(value); setOrder(defaultHistoryOrder(value, ids))
  }
  function move(index: number, delta: number): void {
    const next = [...order]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    invalidate(); setOrder(next)
  }
  async function changed(): Promise<boolean> {
    try { await onChanged(); return true } catch {
      if (alive.current) setError(t('historyPlan.refreshFailed'))
      return false
    }
  }
  async function makePreview(): Promise<void> {
    if (writing.current || !editable || invalid) return
    writing.current = true; setBusy(true); setError(null); setAck(false); setPreview(null); setStatus(null)
    const ticket = ++generation.current
    const request: HistoryRequest = { action, commits: action === 'cherry-pick' || action === 'revert' ? order : ids,
      ...(action === 'reorder' ? { order } : {}), ...(needsMessage ? { message } : {}) }
    try {
      const value = await api.call<HistoryPreview>('previewHistory', { sessionId, ...request })
      if (!alive.current || ticket !== generation.current) return
      if (checkout.current && value.binding.checkout !== checkout.current) { setError(t('historyPlan.stale')); return }
      remember(value); setPreview(value); setStatus(null)
    } catch (cause) { if (alive.current && ticket === generation.current) { setPreview(null); failure(cause) } }
    finally { writing.current = false; if (alive.current) setBusy(false) }
  }
  async function updateOperation(kind: 'execute' | 'status' | HistoryRecovery): Promise<void> {
    const id = operationId.current
    if (!id || writing.current || resuming) return
    if (kind === 'execute' && (!preview || uncertain || (status && status.phase !== 'preview') || (preview.requiresPublishedAcknowledgment && !ack))) return
    writing.current = true; setBusy(true); setError(null)
    // A lost execute response is not permission to repeat it. Only a status read
    // can establish whether the host accepted the operation.
    if (kind !== 'status') setUncertain(true)
    try {
      const method = kind === 'execute' ? 'executeHistory' : kind === 'status' ? 'historyOperationStatus' : 'recoverHistory'
      const extra = kind === 'execute' ? { approved: true, acknowledgePublishedHistory: ack } : kind === 'status' ? {} : kind
      const value = await api.call<HistoryStatus>(method, { sessionId, operationId: id, ...extra })
      if (alive.current) {
        if (checkout.current && value.preview.binding.checkout !== checkout.current) { setError(t('historyPlan.stale')); setUncertain(true) }
        else install(value)
      }
    } catch (cause) { if (alive.current) { failure(cause); setAck(false); setUncertain(true) } }
    finally { if (kind !== 'status') await changed(); writing.current = false; if (alive.current) setBusy(false) }
  }
  function confirmRecovery(value: DestructiveRecovery): void {
    recoveryTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirmation(value)
  }
  function recover(value: DestructiveRecovery): void {
    setConfirmation(null)
    void updateOperation(value === 'abort' ? { action: value, discardResolutionEdits: true } : value === 'restore' ? { action: value, approved: true } : { action: value })
  }
  function close(): void { ++generation.current; onClose() }
  function ask(verb: 'explain' | 'review' | 'draft'): void {
    onAskAgent?.({ verb, scope: { commits: [...ids], historyAction: action } })
  }
  const canRecover = status?.native.owned === true && status.native.kind !== null && ['stopped', 'failed', 'interrupted'].includes(status.phase)
  const phase = status?.phase ?? (preview ? 'preview' : null)
  return <Modal open title={t('historyPlan.title')} className={classes.card} contentClassName={classes.scroll} closeLabel={t('historyPlan.close')} onClose={close}>
    <div ref={body} className={classes.body} data-dsh-git="history-workspace">
      {confirmation ? <div role="alert" className={classes.confirmation}>
        <p className={classes.warning}>{t('historyPlan.confirm.' + confirmation as Parameters<Translate>[0])}</p>
        <div className={classes.actions}>
          <Button variant="ghost" onClick={() => setConfirmation(null)}>{t('historyPlan.keep')}</Button>
          <Button variant="ghost" className={classes.danger} onClick={() => recover(confirmation)}>{t('historyPlan.confirmRecovery')}</Button>
        </div>
      </div> : <>
        <nav className={classes.actions} aria-label={t('historyPlan.views')}>
          {(['inspect', 'compare', 'plan'] as const).map(tab => <Button key={tab} variant="ghost" aria-pressed={mode === tab} disabled={busy || (tab === 'compare' && selection.length < 2)} onClick={() => setMode(tab)}>{t('historyPlan.tab.' + tab as Parameters<Translate>[0])}</Button>)}
        </nav>
        {storageWarning && <p className={classes.warning}>{t('historyPlan.storageWarning')}</p>}
        {resuming && <p role="status">{t('historyPlan.resuming')}</p>}
        {error && <p role="alert" className={classes.error}>{error}</p>}
        {uncertain && <p className={classes.warning}>{t('historyPlan.uncertain')}</p>}
        {operationId.current && <Button variant="ghost" disabled={busy || resuming} onClick={() => { void updateOperation('status') }}>{t('historyPlan.refreshStatus')}</Button>}
        {readError && <div role="alert" className={classes.error}>{t('historyPlan.readFailed')}<Button variant="ghost" onClick={() => setReadVersion(value => value + 1)}>{t('history.refresh')}</Button></div>}
        {loading && <p role="status">{t('history.loading')}</p>}
        {mode === 'inspect' && <>
          <label>{t('historyPlan.commit')}<select value={hash} onChange={event => setHash(event.target.value)}>{selection.map(commit => <option key={commit.hash} value={commit.hash}>{commit.short} {commit.subject}</option>)}</select></label>
          {details && <>
            <h3>{details.commit.subject}</h3><p className={classes.hint}>{details.commit.hash} · {details.commit.author} · {new Date(details.commit.timestamp * 1000).toLocaleString()}</p>
            <Button variant="ghost" onClick={() => { void writeClipboard(details.commit.hash).catch(() => setError(t('historyPlan.readFailed'))) }}>{t('history.copyHash')}</Button>
            <pre className={classes.patch} tabIndex={0}>{details.message}</pre>
            <p className={classes.hint}>{t('historyPlan.parent', { hash: details.parent ?? t('historyPlan.emptyTree') })}</p>
            <nav className={classes.files} aria-label={t('history.openFiles')}>{details.files.map(item => <button type="button" key={item.path} aria-current={file?.path === item.path ? 'true' : undefined} onClick={() => { setReadError(false); setFile(item) }}>{item.status} {item.oldPath ? item.oldPath + ' → ' : ''}{item.path}</button>)}</nav>
            {details.files.length === 0 && <p>{t('diff.empty')}</p>}
          </>}
          {file && !diff && !readError && <p role="status">{t('diff.loading')}</p>}
          {diff && (diff.empty || !diff.file ? <p>{t('diff.empty')}</p> : <>
            {diff.file.binary && <p>{t('diff.binary')}</p>}
            {diff.file.tooLarge && <p className={classes.warning}>{t('diff.tooLarge', { added: diff.file.added, removed: diff.file.removed })}</p>}
            <pre className={classes.patch} tabIndex={0} aria-label={t('historyPlan.patch')}>{diff.file.patch}</pre>
          </>)}
        </>}
        {mode === 'compare' && <>
          <div className={classes.endpoints}>{(['from', 'to'] as const).map(endpoint => <label key={endpoint}>{t('historyPlan.' + endpoint as Parameters<Translate>[0])}<select value={endpoint === 'from' ? from : to} onChange={event => (endpoint === 'from' ? setFrom : setTo)(event.target.value)}>{selection.map(commit => <option key={commit.hash} value={commit.hash}>{commit.short} {commit.subject}</option>)}</select></label>)}</div>
          {from === to && <p className={classes.hint}>{t('historyPlan.distinctEndpoints')}</p>}
          {comparison && <><pre className={classes.patch}>{comparison.summary}</pre>{comparison.truncated && <p className={classes.warning}>{t('historyPlan.truncated')}</p>}<pre className={classes.patch} tabIndex={0} aria-label={t('historyPlan.patch')}>{comparison.patch}</pre></>}
        </>}
        {mode === 'plan' && <>
          <label>{t('historyPlan.action')}<select disabled={!editable} value={action} onChange={event => chooseAction(event.target.value as HistoryAction)}>{actions.map(value => <option key={value} value={value}>{t('historyPlan.action.' + value as Parameters<Translate>[0])}</option>)}</select></label>
          <p className={classes.hint}>{t('historyPlan.orderHint')}</p>
          <ol className={classes.order}>{order.map((id, index) => <li key={id}><span>{selection.find(commit => commit.hash === id)?.subject ?? id}<code>{id}</code></span>{['reorder', 'cherry-pick', 'revert'].includes(action) && <div className={classes.actions}><Button variant="ghost" disabled={!editable || index === 0} aria-label={t('historyPlan.moveUp', { hash: id.slice(0, 7) })} onClick={() => move(index, -1)}>{t('historyPlan.up')}</Button><Button variant="ghost" disabled={!editable || index === order.length - 1} aria-label={t('historyPlan.moveDown', { hash: id.slice(0, 7) })} onClick={() => move(index, 1)}>{t('historyPlan.down')}</Button></div>}</li>)}</ol>
          {needsMessage && <label>{t('historyPlan.message')}<textarea disabled={!editable} value={message} onChange={event => { invalidate(); setMessage(event.target.value) }} /></label>}
          {invalid && <p className={classes.warning}>{t('historyPlan.invalid')}</p>}
          <div className={classes.actions}><Button variant="ghost" disabled={!editable || invalid} onClick={() => { void makePreview() }}>{t('historyPlan.preview')}</Button></div>
          {preview && <section className={classes.preview} aria-label={t('historyPlan.preview')}>
            <p className={classes.hint}>{t('historyPlan.operationId', { id: preview.operationId })}</p>
            <h3>{t('historyPlan.target')}</h3><p>{preview.binding.checkout}</p><p className={classes.hint}>{preview.binding.headRef ?? t('historyPlan.detached')} · {preview.binding.head}</p>
            <p>{t('historyPlan.affected', { count: preview.plan.affected.length })}</p><pre className={classes.patch}>{preview.plan.affected.join('\n')}</pre>
            <p>{t('historyPlan.descendants', { count: preview.plan.descendants.length })}</p>{preview.plan.descendants.length > 0 && <pre className={classes.patch}>{preview.plan.descendants.join('\n')}</pre>}
            <p>{t('historyPlan.backup', { ref: preview.backupRef })}</p><p className={classes.hint}>{t('historyPlan.noPush')}</p>
            <p className={classes.warning}>{t(preview.publication.state === 'reachable' ? 'historyPlan.published' : 'historyPlan.publicationUnknown')}</p><p>{preview.publication.refs.join(', ')}</p>
            {preview.publication.warning && <p className={classes.warning}>{preview.publication.warning}</p>}
            {preview.warnings.map((warning, index) => <p key={index} className={classes.warning}>{warning}</p>)}
            {preview.otherCheckouts.length > 0 && <><h3>{t('historyPlan.otherCheckouts')}</h3>{preview.otherCheckouts.map(item => <p key={item.checkout}>{item.checkout} · {item.headRef}</p>)}</>}
            <p className={classes.hint}>{preview.diffMeaning}</p><pre className={classes.patch}>{preview.diffSummary}</pre>
            {preview.requiresPublishedAcknowledgment && <label className={classes.check}><input type="checkbox" checked={ack} disabled={busy || uncertain || (!!status && status.phase !== 'preview')} onChange={event => setAck(event.target.checked)} />{t('historyPlan.ack')}</label>}
            <div className={classes.actions}>
              <Button variant="primary" disabled={busy || resuming || uncertain || (!!status && status.phase !== 'preview') || (preview.requiresPublishedAcknowledgment && !ack)} onClick={() => { void updateOperation('execute') }}>{t('historyPlan.apply')}</Button>
              {(!status || status.phase === 'preview') && <Button variant="ghost" disabled={busy || uncertain} onClick={() => { void updateOperation({ action: 'cancel' }) }}>{t('historyPlan.cancel')}</Button>}
            </div>
          </section>}
          {phase && <p role="status">{t('historyPlan.phase.' + phase as Parameters<Translate>[0])}</p>}
          {status && <>
            <p>{status.nextStep}</p>{status.error && <p className={classes.error}>{status.error}</p>}
            {(status.phase === 'interrupted' || (activeOperation && !status.native.owned)) && <p className={classes.warning}>{t('historyPlan.manualRecovery')}</p>}
            {status.native.conflicts.length > 0 && <><p>{t('historyPlan.conflicts')}</p><pre className={classes.patch}>{status.native.conflicts.join('\n')}</pre><Button variant="ghost" disabled={busy} onClick={() => { void changed().then(refreshed => { if (refreshed) close() }) }}>{t('historyPlan.openConflicts')}</Button></>}
            <div className={classes.actions}>
              {canRecover && <><Button variant="ghost" disabled={busy || uncertain || status.native.conflicts.length > 0} onClick={() => { void updateOperation({ action: 'continue' }) }}>{t('historyPlan.continue')}</Button><Button variant="ghost" disabled={busy || uncertain} onClick={() => confirmRecovery('skip')}>{t('historyPlan.skip')}</Button><Button variant="ghost" disabled={busy || uncertain} onClick={() => confirmRecovery('abort')}>{t('historyPlan.abort')}</Button></>}
              {status.canRestore && <Button variant="ghost" disabled={busy || uncertain} onClick={() => confirmRecovery('restore')}>{t('historyPlan.restore')}</Button>}
              {!activeOperation && status.phase !== 'preview' && <Button variant="ghost" disabled={busy || uncertain} onClick={() => { invalidate(); setOrder(defaultHistoryOrder(action, ids)); setMessage(selection.map(commit => commit.subject).join('\n\n')) }}>{t('historyPlan.newPlan')}</Button>}
            </div>
          </>}
        </>}
        {busy && <p role="status">{t('historyPlan.working')}</p>}
        {onAskAgent && <div className={classes.actions}>
          <Button variant="ghost" disabled={busy || ids.length === 0} onClick={() => ask('explain')}>{t('historyPlan.explain')}</Button>
          <Button variant="ghost" disabled={busy || ids.length === 0} onClick={() => ask('draft')}>{t('historyPlan.propose')}</Button>
          <Button variant="ghost" disabled={busy || ids.length === 0} onClick={() => ask('review')}>{t('historyPlan.review')}</Button>
        </div>}
        <p className={classes.hint}>{t('historyPlan.approvalHint')}</p>
      </>}
    </div>
  </Modal>
}
