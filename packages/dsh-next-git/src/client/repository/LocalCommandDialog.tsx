import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RepositoryCommandDialogProps } from './RepositoryCommandDialog.tsx'
import type { PanelState } from '../../core/types.ts'
import { asApiError } from '../api.ts'
import { failureTitleKey } from '../GitPanel.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import { commandLabels } from './commands.ts'
import classes from './repository.module.css'

/**
 * The index and abort operations that need one confirmation.
 *
 * A checkout is not here: the panel routes it to the ref picker, so naming a
 * ref happens in the same list as the header's branch chip.
 */
export function LocalCommandDialog(props: RepositoryCommandDialogProps): React.ReactElement {
  return <LocalCommand key={JSON.stringify([props.command, props.sessionId, props.state.root])} {...props} />
}
function LocalCommand({ command, state, sessionId, api, t, onClose, onChanged }: RepositoryCommandDialogProps): React.ReactElement {
  const [paths] = React.useState(() => [...new Set((command === 'unstage-all' ? state.changes.staged : [...state.changes.unstaged, ...state.changes.untracked]).filter(entry => entry.unmerged === undefined).map(entry => entry.path))])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const alive = React.useRef(true), pending = React.useRef(false), body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const abort = command === 'abort-rebase'
  const destructive = command === 'discard-all' || abort
  const fileMethod = command === 'stage-all' ? 'stage' : command === 'unstage-all' ? 'unstage' : command === 'discard-all' ? 'discard' : null
  const valid = abort ? state.operation.kind === 'rebase' : fileMethod !== null && paths.length > 0
  const run = async (): Promise<void> => {
    if (pending.current || !valid || done) return
    pending.current = true; setBusy(true); setError(null)
    try {
      if (abort) await api.call<PanelState>('operationAbort', { sessionId, expectedKind: 'rebase' })
      else if (fileMethod !== null) await api.call<PanelState>(fileMethod, { sessionId, paths })
      else return
      if (!alive.current) return
      setDone(true)
      await onChanged()
      if (alive.current) onClose()
    } catch (cause) { if (alive.current) setError(t(failureTitleKey(asApiError(cause).code))) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  return <Modal open title={t(commandLabels[command])} closeLabel={t('repository.close')} className={classes.card} onClose={() => { if (!pending.current) onClose() }}>
    <div ref={body} className={classes.body} data-dsh-git="local-command" data-command={command}>
      <fieldset className={classes.form} disabled={busy || done}>
        {abort ? <p>{t('commands.abortWarning')}</p>
          : command === 'discard-all' ? <p>{t('commands.discardWarning', { count: paths.length })}</p>
            : <p>{t('commands.fileCount', { count: paths.length })}</p>}
        <Button variant={destructive ? 'outline' : 'primary'} className={destructive ? classes.danger : undefined} disabled={!valid} onClick={() => void run()}>{t(commandLabels[command])}</Button>
      </fieldset>
      {error && <p role="alert" className={classes.error}>{error}</p>}
      {busy && <p role="status">{t('repository.working')}</p>}
    </div>
  </Modal>
}
