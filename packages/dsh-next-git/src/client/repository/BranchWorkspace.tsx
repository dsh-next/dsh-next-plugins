import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PanelState } from '../../core/types.ts'
import { asApiError } from '../api.ts'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import { repositoryActionLabel, type RepositoryWorkspaceViewProps } from './workspace-types.ts'
import classes from './repository.module.css'

interface BranchConfirmation {
  method: 'branchCreate' | 'branchRename' | 'branchDelete'
  name: string
  to: string
  from: string
  oid: string
}

/** Branch writes keep their own form and confirmation state, not inventory state. */
export function BranchWorkspace({ sessionId, state, api, t, action: mode, flexibleStartPoint = false, onClose, onChanged }: RepositoryWorkspaceViewProps): React.ReactElement {
  const refsId = React.useId()
  const [branchName, setBranchName] = React.useState('')
  const [selectedBranch, setSelectedBranch] = React.useState(state.head.branch ?? '')
  const [newName, setNewName] = React.useState('')
  const [base, setBase] = React.useState(state.head.branch ?? '')
  const [confirmation, setConfirmation] = React.useState<BranchConfirmation | null>(null)
  const [forceNeeded, setForceNeeded] = React.useState(false)
  const [force, setForce] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const body = React.useRef<HTMLDivElement>(null)
  const active = React.useRef(true)
  const pending = React.useRef(false)
  useDialogFocus(body)
  React.useEffect(() => { active.current = true; return () => { active.current = false } }, [])

  const chosen = state.branches.find(item => item.name === selectedBranch && !item.remote)
  const checkedOut = state.worktrees.some(item => item.branch === selectedBranch)
  const branchConfirm = (method: BranchConfirmation['method']): void => {
    setForce(false); setForceNeeded(false); setError(null)
    setConfirmation({ method, name: method === 'branchCreate' ? branchName : selectedBranch, to: newName, from: base, oid: chosen?.oid ?? '' })
  }
  const applyBranch = async (): Promise<void> => {
    if (!confirmation || pending.current || forceNeeded && !force) return
    pending.current = true; setBusy(true); setError(null)
    const value = confirmation
    try {
      await api.call<PanelState>(value.method, { sessionId,
        ...(value.method === 'branchCreate' ? { name: value.name, ...(value.from ? { from: value.from } : {}) }
          : value.method === 'branchRename' ? { from: value.name, to: value.to, expectedOid: value.oid }
            : { name: value.name, expectedOid: value.oid, force }),
      })
      if (!active.current) return
      setConfirmation(null); setBranchName(''); setNewName('')
      await onChanged()
    } catch (cause) {
      if (!active.current) return
      if (asApiError(cause).code === 'not-merged' && value.method === 'branchDelete') setForceNeeded(true)
      setError(t('repository.branchFailed'))
    } finally { pending.current = false; if (active.current) setBusy(false) }
  }
  const close = (): void => { if (!pending.current) onClose() }

  return <Modal open title={t(repositoryActionLabel(mode))} className={classes.card} closeLabel={t('confirm.cancel')} onClose={close}>
    <div ref={body} className={classes.body} data-dsh-git="repository-workspace" data-action={mode}>
      {confirmation ? <>
        <p>{t('repository.branchConfirm', { name: confirmation.name, target: confirmation.to || confirmation.from || state.head.branch || 'HEAD' })}</p>
        {confirmation.oid && <code>{confirmation.oid}</code>}
        {forceNeeded && <label><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} />{t('repository.forceBranch')}</label>}
        <div className={classes.actions}><Button variant={confirmation.method === 'branchDelete' ? 'outline' : 'primary'} className={confirmation.method === 'branchDelete' ? classes.danger : undefined} disabled={busy || forceNeeded && !force} onClick={() => void applyBranch()}>{t('confirm.proceed')}</Button></div>
      </> : <fieldset disabled={busy} className={classes.form}>
        {mode === 'branch-create' && <>
          <label>{t('branches.createPlaceholder')}<input value={branchName} onChange={event => setBranchName(event.target.value)} /></label>
          {flexibleStartPoint ? <><label>{t('commands.ref')}<input list={refsId} value={base} onChange={event => setBase(event.target.value)} /></label><datalist id={refsId}>{[...state.branches.map(item => item.name), ...state.tags.map(tag => 'refs/tags/' + tag.name)].map(ref => <option key={ref} value={ref} />)}</datalist></>
            : <label>{t('repository.startPoint')}<select value={base} onChange={event => setBase(event.target.value)}>{state.branches.map(item => <option key={item.name}>{item.name}</option>)}</select></label>}
          <Button variant="primary" disabled={!branchName.trim() || state.head.unborn || state.operation.kind !== null} onClick={() => branchConfirm('branchCreate')}>{t('branches.create')}</Button>
        </>}
        {(mode === 'branch-rename' || mode === 'branch-delete') && <>
          <label>{t('repository.branch')}<select value={selectedBranch} onChange={event => setSelectedBranch(event.target.value)}>{state.branches.filter(item => !item.remote).map(item => <option key={item.name}>{item.name}</option>)}</select></label>
          {mode === 'branch-rename' ? <>
            <label>{t('branches.renamePlaceholder')}<input value={newName} onChange={event => setNewName(event.target.value)} /></label>
            <Button variant="primary" disabled={!chosen || !newName.trim() || state.operation.kind !== null} onClick={() => branchConfirm('branchRename')}>{t('branches.rename')}</Button>
          </> : <>
            <Button variant="ghost" disabled={!chosen || chosen.current || checkedOut || state.operation.kind !== null} onClick={() => branchConfirm('branchDelete')}>{t('branches.delete')}</Button>
            {checkedOut && <p className={classes.hint}>{t('repository.checkedOut')}</p>}
          </>}
        </>}
      </fieldset>}
      {error && <p role="alert" className={classes.error}>{error}</p>}
      {busy && <p role="status">{t('repository.working')}</p>}
    </div>
  </Modal>
}
