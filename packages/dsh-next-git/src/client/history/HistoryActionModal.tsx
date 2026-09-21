import * as React from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, IconChevronDownOutline14, IconChevronUpOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  defaultHistoryOrder,
  type HistoryAction,
  type HistoryPreview,
  type HistoryRecovery,
  type HistoryRequest,
  type HistoryStatus,
} from '../../core/history-plan.ts'
import type { CommitDetails } from '../../core/history-view.ts'
import type { CommitSummary } from '../../core/types.ts'
import { asApiError, type GitApi } from '../api.ts'
import type { Translate } from '../GitPanel.tsx'
import type { AgentSessionControls } from '../ai/action-dialog.tsx'
import { HistoryMessageAI } from './HistoryMessageAI.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './commit-details.module.css'

/** Message edits wait this long before they ask the host for a fresh preview. */
const MESSAGE_SETTLE_MS = 250

export interface HistoryActionModalProps {
  sessionId: string
  action: HistoryAction
  /** Chronological, oldest first, exactly the commits the user selected. */
  commits: readonly CommitSummary[]
  t: Translate
  api: GitApi
  agentSessions?: AgentSessionControls
  root?: string
  cwd?: string
  onClose(): void
  onChanged(): Promise<void> | void
}

/** One operation, one modal: its own order, its own message, its own approval. */
export function HistoryActionModal(props: HistoryActionModalProps): React.ReactElement {
  return <Action key={JSON.stringify([props.sessionId, props.action, props.commits.map(commit => commit.hash)])} {...props} />
}

function Action({ sessionId, action, commits, t, api, root, cwd, onClose, onChanged }: HistoryActionModalProps): React.ReactElement {
  const ids = commits.map(commit => commit.hash)
  const needsMessage = action === 'squash' || action === 'reword'
  const reorderable = action === 'reorder'
  const label = t(('history.action.' + action) as Parameters<Translate>[0])
  const [order, setOrder] = React.useState(() => defaultHistoryOrder(action, ids))
  const [message, setMessage] = React.useState(() => commits.map(commit => commit.subject).join('\n\n'))
  const [loadingMessage, setLoadingMessage] = React.useState(needsMessage)
  const [messageFailed, setMessageFailed] = React.useState(false)
  const summaryId = React.useId()
  const descriptionId = React.useId()
  const newline = message.indexOf('\n')
  const summary = newline < 0 ? message : message.slice(0, newline)
  const description = newline < 0 ? '' : message.slice(newline + 1).replace(/^\n/, '')
  const [preview, setPreview] = React.useState<HistoryPreview | null>(null)
  const [status, setStatus] = React.useState<HistoryStatus | null>(null)
  const [ack, setAck] = React.useState(false)
  const [preparing, setPreparing] = React.useState(true)
  const [applying, setApplying] = React.useState(false)
  const [error, setError] = React.useState<{ message: string; detail: string } | null>(null)
  const [uncertain, setUncertain] = React.useState(false)
  const [confirmation, setConfirmation] = React.useState<'skip' | 'abort' | 'restore' | null>(null)
  const body = React.useRef<HTMLDivElement>(null)
  const alive = React.useRef(true)
  const operationId = React.useRef<string | null>(null)
  const previewed = React.useRef<{ shape: string } | null>(null)
  const writing = React.useRef(false)
  useDialogFocus(body)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  /**
   * Name the refusal and keep the plan's own sentence under it. The engine
   * rejects a plan for reasons a user can act on (a dirty checkout, an active
   * Git operation, a selection it cannot replay), so a generic "request failed"
   * would hide the one thing they need to change.
   */
  const failure = (cause: unknown): { message: string; detail: string } => {
    const api = asApiError(cause)
    const message = api.code === 'dirty-tree' ? t('history.error.dirty')
      : api.code === 'operation-in-progress' ? t('history.error.operation')
        : api.code === 'invalid-name' ? t('history.invalid')
          : t('history.failed')
    return { message, detail: api.failure.detail === api.code ? '' : api.failure.detail }
  }
  const request = (): HistoryRequest => ({
    action,
    commits: action === 'cherry-pick' || action === 'revert' || reorderable ? order : ids,
    ...(reorderable ? { order } : {}),
    ...(needsMessage ? { message } : {}),
  })

  // Preserve full messages, including bodies, rather than rebuilding them from subjects.
  React.useEffect(() => {
    if (!needsMessage) return
    const abort = new AbortController()
    setLoadingMessage(true); setMessageFailed(false)
    void Promise.all(commits.map(commit => api.call<CommitDetails>('getCommitDetails', { sessionId, hash: commit.hash }, abort.signal)))
      .then(values => {
        if (!abort.signal.aborted && alive.current) setMessage(values.map(value => value.message.trimEnd()).join('\n\n'))
      })
      .catch(() => { if (!abort.signal.aborted && alive.current) setMessageFailed(true) })
      .finally(() => { if (!abort.signal.aborted && alive.current) setLoadingMessage(false) })
    return () => abort.abort()
  }, [api, sessionId, action])

  /**
   * Show what the button would do before it can be pressed. The plan is asked
   * for again whenever the order changes, and once a typed message settles, so
   * the approval always belongs to the request on screen.
   */
  React.useEffect(() => {
    const abort = new AbortController()
    if (loadingMessage || messageFailed || needsMessage && summary.trim() === '') {
      setPreparing(false); setPreview(null)
      return () => abort.abort()
    }
    const shape = JSON.stringify([action, order])
    // Only a message edit can be deferred: order and action change the plan itself.
    const deferred = previewed.current !== null && previewed.current.shape === shape
    let timer: number | undefined
    const run = (): void => {
      setPreparing(true); setError(null); setAck(false); setPreview(null); setStatus(null); setUncertain(false)
      void api.call<HistoryPreview>('previewHistory', { sessionId, ...request() }, abort.signal)
        .then(value => {
          if (abort.signal.aborted || !alive.current) return
          operationId.current = value.operationId
          previewed.current = { shape }
          setPreview(value)
        })
        .catch(cause => { if (alive.current && !abort.signal.aborted) setError(failure(cause)) })
        .finally(() => { if (alive.current && !abort.signal.aborted) setPreparing(false) })
    }
    if (deferred) timer = window.setTimeout(run, MESSAGE_SETTLE_MS)
    else run()
    return () => { abort.abort(); if (timer !== undefined) window.clearTimeout(timer) }
  }, [api, sessionId, action, JSON.stringify(order), needsMessage ? message : '', loadingMessage, messageFailed])

  const active = status !== null && !['preview', 'completed', 'aborted', 'cancelled', 'recovered'].includes(status.phase)
  const editable = !applying && !uncertain && !loadingMessage && !messageFailed && (!status || status.phase === 'preview')
  const changeMessage = (value: string): void => {
    setPreview(null); setAck(false); setError(null); setMessage(value)
  }

  async function update(kind: 'execute' | 'status' | HistoryRecovery): Promise<void> {
    const id = operationId.current
    if (id === null || writing.current) return
    if (kind === 'execute' && (preview === null || uncertain || preview.requiresPublishedAcknowledgment && !ack)) return
    writing.current = true; setApplying(true); setError(null)
    // A lost execute reply is not permission to repeat it; only a status read says.
    if (kind !== 'status') setUncertain(true)
    try {
      const method = kind === 'execute' ? 'executeHistory' : kind === 'status' ? 'historyOperationStatus' : 'recoverHistory'
      const extra = kind === 'execute' ? { approved: true, acknowledgePublishedHistory: ack } : kind === 'status' ? {} : kind
      const value = await api.call<HistoryStatus>(method, { sessionId, operationId: id, ...extra })
      if (alive.current) {
        setStatus(value.phase === 'preview' ? null : value)
        setPreview(value.preview)
        setUncertain(false)
      }
    } catch (cause) { if (alive.current) setError(failure(cause)) }
    finally {
      try { if (kind !== 'status') await onChanged() }
      finally {
        writing.current = false
        if (alive.current) setApplying(false)
      }
    }
  }
  const recover = (kind: 'skip' | 'abort' | 'restore'): void => {
    setConfirmation(null)
    void update(kind === 'abort' ? { action: 'abort', discardResolutionEdits: true } : kind === 'restore' ? { action: 'restore', approved: true } : { action: kind })
  }
  const move = (index: number, delta: number): void => {
    const next = [...order]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setPreview(null); setAck(false); setOrder(next)
  }
  const canRecover = status?.native.owned === true && status.native.kind !== null && ['stopped', 'failed', 'interrupted'].includes(status.phase)
  const applyingDisabled = !editable || preparing || preview === null || (preview.requiresPublishedAcknowledgment && !ack)
  const title = action === 'reword' ? label : t(('history.command.' + action) as Parameters<Translate>[0], { count: commits.length })

  return <Modal open title={title} className={classes.cardNarrow} contentClassName={classes.scroll} closeLabel={t('historyAction.close')} onClose={() => { if (!writing.current) onClose() }}>
    <div ref={body} className={classes.body} data-dsh-git="history-action-modal" data-action={action}>
      {confirmation !== null ? <div role="alert" className={classes.confirm}>
        <p className={classes.warning}>{t(('history.confirm.' + confirmation) as Parameters<Translate>[0])}</p>
        <div className={classes.row}>
          <Button variant="ghost" onClick={() => setConfirmation(null)}>{t('history.keep')}</Button>
          <Button variant="ghost" className={classes.danger} onClick={() => recover(confirmation)}>{t('history.confirmRecovery')}</Button>
        </div>
      </div> : <>
        {!needsMessage && <ol className={classes.order} data-dsh-git="action-order">
          {order.map((id, index) => {
            const commit = commits.find(item => item.hash === id)
            return <li key={id}>
              <span className={classes.orderSubject} title={id}>{commit?.subject ?? id.slice(0, 7)}</span>
              {reorderable && <span className={classes.row}>
                <button type="button" className={classes.orderMove} disabled={!editable || index === 0} aria-label={t('history.moveUp', { hash: id.slice(0, 7) })} title={t('history.moveUp', { hash: id.slice(0, 7) })} onClick={() => move(index, -1)}><IconChevronUpOutline14 size={14} /></button>
                <button type="button" className={classes.orderMove} disabled={!editable || index === order.length - 1} aria-label={t('history.moveDown', { hash: id.slice(0, 7) })} title={t('history.moveDown', { hash: id.slice(0, 7) })} onClick={() => move(index, 1)}><IconChevronDownOutline14 size={14} /></button>
              </span>}
            </li>
          })}
        </ol>}
        {needsMessage && <>
          <div className={classes.messageHeading}>
            <label htmlFor={summaryId}>{t('history.summary')}</label>
            {root !== undefined && cwd !== undefined && <HistoryMessageAI
              sessionId={sessionId as SessionId} action={action} commits={commits} message={message} onMessage={changeMessage}
              root={root} cwd={cwd} api={api} t={t} disabled={!editable} />}
          </div>
          <input id={summaryId} className={classes.messageInput} data-dsh-git="history-summary" value={summary} disabled={!editable}
            onChange={event => changeMessage(event.target.value + (description === '' ? '' : '\n\n' + description))} />
          <label className={classes.messageLabel} htmlFor={descriptionId}>{t('history.description')}</label>
          <textarea id={descriptionId} className={classes.messageInput} data-dsh-git="history-description" value={description} disabled={!editable}
            onChange={event => changeMessage(summary + (event.target.value === '' ? '' : '\n\n' + event.target.value))} />
        </>}
        {messageFailed && <div role="alert" className={classes.error}>
          <p>{t('historyDetails.readFailed')}</p>
        </div>}
        {error !== null && <div role="alert" className={classes.error}>
          <p>{error.message}</p>
          {error.detail !== '' && <p className={classes.detail}>{error.detail}</p>}
        </div>}
        {preview !== null && status === null && preview.requiresPublishedAcknowledgment && <label className={classes.check}>
          <input type="checkbox" checked={ack} disabled={!editable} onChange={event => setAck(event.target.checked)} />{t('history.ack')}
        </label>}
        {status === null && <Button className={classes.primary} variant="primary" disabled={applyingDisabled} onClick={() => { void update('execute') }}>
          {applying ? t('history.working') : loadingMessage || preparing ? t('history.reading') : title}
        </Button>}
        {uncertain && !applying && <div className={classes.facts}>
          <p className={classes.warning}>{t('history.uncertain')}</p>
          <Button variant="ghost" onClick={() => { void update('status') }}>{t('history.refreshStatus')}</Button>
        </div>}
        {status !== null && <>
          {status.error || status.phase === 'failed' ? <div role="alert" className={classes.error}>
            <p>{t(('history.phase.' + status.phase) as Parameters<Translate>[0])}</p>
            {status.error && <p className={classes.detail}>{status.error}</p>}
          </div> : <p role="status" className={classes.hint}>{t(('history.phase.' + status.phase) as Parameters<Translate>[0])}</p>}
          {status.native.conflicts.length > 0 && <><p className={classes.warning}>{t('history.fact.conflicts', { count: status.native.conflicts.length })}</p><pre className={classes.summary}>{status.native.conflicts.join('\n')}</pre></>}
          {status.phase === 'interrupted' && <p className={classes.warning}>{t('history.manualRecovery')}</p>}
          <div className={classes.row}>
            {canRecover && <>
              <Button variant="ghost" disabled={applying || status.native.conflicts.length > 0} onClick={() => { void update({ action: 'continue' }) }}>{t('history.continue')}</Button>
              <Button variant="ghost" disabled={applying} onClick={() => setConfirmation('skip')}>{t('history.skip')}</Button>
              <Button variant="ghost" disabled={applying} onClick={() => setConfirmation('abort')}>{t('history.abort')}</Button>
            </>}
            {status.canRestore && <Button variant="ghost" disabled={applying} onClick={() => setConfirmation('restore')}>{t('history.restore')}</Button>}
            {!active && !uncertain && <Button variant="ghost" onClick={onClose}>{t('historyAction.close')}</Button>}
          </div>
        </>}
      </>}
      {applying && <p role="status" className={classes.hint}>{t('history.working')}</p>}
    </div>
  </Modal>
}
