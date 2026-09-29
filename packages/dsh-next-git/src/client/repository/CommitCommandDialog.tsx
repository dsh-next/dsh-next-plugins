import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PanelState } from '../../core/types.ts'
import type { CommitDetails } from '../../core/history-view.ts'
import { asApiError, type GitApi, type GitApiError } from '../api.ts'
import { failureTitleKey } from '../panel/failure-copy.ts'
import type { Translate } from '../dictionaries.ts'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './repository.module.css'

export interface CommitCommandDialogProps {
  sessionId: string
  state: PanelState
  api: GitApi
  t: Translate
  mode: 'staged' | 'all'
  amend: boolean
  signoff: boolean
  onClose(): void
  onChanged(): Promise<void> | void
}

/** A session, checkout or command change starts a fresh draft and request lifetime. */
export function CommitCommandDialog(props: CommitCommandDialogProps): React.ReactElement {
  return <Dialog key={JSON.stringify([props.sessionId, props.state.root, props.mode, props.amend, props.signoff])} {...props} />
}

function Dialog({ sessionId, state, api, t, mode, amend, signoff, onClose, onChanged }: CommitCommandDialogProps): React.ReactElement {
  const [amendHead] = React.useState(state.head.oid)
  const [summary, setSummary] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [loading, setLoading] = React.useState(amend)
  const [busy, setBusy] = React.useState(false)
  const [committed, setCommitted] = React.useState(false)
  const [error, setError] = React.useState<GitApiError | null>(null)
  const body = React.useRef<HTMLDivElement>(null)
  const active = React.useRef(true)
  const pending = React.useRef(false)
  const request = React.useRef<string | null>(null)
  useDialogFocus(body)
  React.useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  React.useEffect(() => {
    if (!amend) return
    const abort = new AbortController()
    setLoading(true)
    if (amendHead === null) { setLoading(false); return }
    void api.call<CommitDetails>('getCommitDetails', { sessionId, hash: amendHead }, abort.signal).then(details => {
      if (abort.signal.aborted) return
      const newline = details.message.indexOf('\n')
      setSummary(newline < 0 ? details.message : details.message.slice(0, newline))
      setDescription(newline < 0 ? '' : details.message.slice(newline + 1).replace(/^\n/, '').trimEnd())
    }).catch(cause => { if (!abort.signal.aborted) setError(asApiError(cause)) })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [api, sessionId, amend, amendHead])
  const hasChanges = state.changes.staged.length > 0 || mode === 'all' && (state.changes.unstaged.length > 0 || state.changes.untracked.length > 0)
  const blocked = state.operation.kind !== null || state.changes.conflicts.length > 0
  const staleAmend = amend && state.head.oid !== amendHead
  const valid = !blocked && !staleAmend && (hasChanges || amend && !state.head.unborn) && (!amend || acknowledged && !state.head.unborn) && summary.trim() !== ''
  const submit = async (): Promise<void> => {
    if (pending.current || committed || busy || loading || !valid) return
    pending.current = true
    setBusy(true); setError(null)
    const requestId = crypto.randomUUID()
    request.current = requestId
    try {
      await api.call<PanelState>(mode === 'all' ? 'commitAll' : 'commit', {
        sessionId, message: summary.trim() + (description.trim() ? '\n\n' + description.trim() : ''), amend, signoff, requestId,
        ...(amend && amendHead ? { expectedHead: amendHead } : {}),
      })
      // A failed refresh must never allow the already successful commit to repeat.
      if (active.current) setCommitted(true)
      await onChanged()
      if (active.current) onClose()
    } catch (cause) { if (active.current) setError(asApiError(cause)) }
    finally { pending.current = false; request.current = null; if (active.current) setBusy(false) }
  }
  const close = (): void => {
    active.current = false
    if (request.current !== null) void api.call('cancelCommit', { sessionId, requestId: request.current }).catch(() => {})
    onClose()
  }
  const title = amend ? (mode === 'all' ? 'commands.commitAllAmend' : 'commands.commitStagedAmend')
    : signoff ? (mode === 'all' ? 'commands.commitAllSignoff' : 'commands.commitStagedSignoff')
      : mode === 'all' ? 'commands.commitAll' : 'commands.commitStaged'
  return <Modal open title={t(title)} className={classes.card} closeLabel={t('repository.close')} onClose={close}>
    <div ref={body} className={classes.body} data-dsh-git="commit-command-dialog">
      <form onSubmit={event => { event.preventDefault(); void submit() }}>
        <fieldset className={classes.form} disabled={busy || loading || committed}>
          <label>{t('commit.summary')}<input value={summary} onChange={event => setSummary(event.target.value)} /></label>
          <label>{t('commit.description')}<textarea rows={4} value={description} onChange={event => setDescription(event.target.value)} /></label>
          {amend && <label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />{t('commands.amendWarning')}</label>}
          <Button type="submit" variant="primary" disabled={!valid}>{t('commit.button')}</Button>
        </fieldset>
      </form>
      {staleAmend && !committed && <p role="alert" className={classes.error}>{t('commands.amendStale')}</p>}
      {blocked && <p className={classes.hint}>{t('failure.operationInProgress')}</p>}
      {!hasChanges && !amend && <p className={classes.hint}>{t('commit.nothingStaged')}</p>}
      {loading && <p role="status" className={classes.hint}>{t('diff.loading')}</p>}
      {busy && <p role="status" className={classes.hint}>{t('diff.loading')}</p>}
      {error && <div role="alert" className={classes.error}><p>{t(failureTitleKey(error.code))}</p>{error.failure.detail && <p>{error.failure.detail.slice(-4000)}</p>}</div>}
    </div>
  </Modal>
}
