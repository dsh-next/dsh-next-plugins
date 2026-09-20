import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PanelState } from '../../core/types.ts'
import type { RepositoryActionPreview, RepositoryActionRequest, RepositoryActionResult, RepositoryInventory } from '../../core/repository-actions.ts'
import { asApiError, type GitApi } from '../api.ts'
import type { Translate } from '../GitPanel.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './repository.module.css'

export interface RepositoryWorkspaceViewProps {
  sessionId: string; state: PanelState; api: GitApi; t: Translate
  onClose(): void
  onChanged(): Promise<void> | void
}
type Mode = 'fetch' | 'push' | 'stash-save' | 'stash-apply' | 'branches'
interface BranchConfirmation { method: 'branchCreate' | 'branchRename' | 'branchDelete'; name: string; to: string; from: string; oid: string }

export function RepositoryWorkspaceView(props: RepositoryWorkspaceViewProps): React.ReactElement {
  return <Workspace key={JSON.stringify([props.sessionId, props.state.root])} {...props} />
}

function Workspace({ sessionId, state, api, t, onClose, onChanged }: RepositoryWorkspaceViewProps): React.ReactElement {
  const [inventory, setInventory] = React.useState<RepositoryInventory>({ remotes: [], stashes: [] })
  const [mode, setMode] = React.useState<Mode>('fetch')
  const [remote, setRemote] = React.useState('')
  const [branch, setBranch] = React.useState(state.head.branch ?? '')
  const [prune, setPrune] = React.useState(false)
  const [includeUntracked, setIncludeUntracked] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [stash, setStash] = React.useState('')
  const [preview, setPreview] = React.useState<RepositoryActionPreview | null>(null)
  const [result, setResult] = React.useState<RepositoryActionResult | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [branchName, setBranchName] = React.useState('')
  const [selectedBranch, setSelectedBranch] = React.useState(state.head.branch ?? '')
  const [newName, setNewName] = React.useState('')
  const [base, setBase] = React.useState(state.head.branch ?? '')
  const [confirmation, setConfirmation] = React.useState<BranchConfirmation | null>(null)
  const [forceNeeded, setForceNeeded] = React.useState(false)
  const [force, setForce] = React.useState(false)
  const body = React.useRef<HTMLDivElement>(null), active = React.useRef(true), pending = React.useRef(false), revision = React.useRef(0)
  useDialogFocus(body)
  React.useEffect(() => { active.current = true; return () => { active.current = false; ++revision.current } }, [])
  const invalidate = (): void => { ++revision.current; setPreview(null); setResult(null); setError(null) }
  const load = async (): Promise<void> => {
    const value = await api.call<RepositoryInventory>('repositoryInventory', { sessionId })
    if (!active.current) return
    setInventory(value)
    setRemote(old => value.remotes.some(item => item.name === old) ? old : value.remotes[0]?.name ?? '')
    setStash(old => value.stashes.some(item => item.oid === old) ? old : value.stashes[0]?.oid ?? '')
  }
  React.useEffect(() => { void load().catch(() => { if (active.current) setError(t('repository.readFailed')) }) }, [api, sessionId])
  const request = (): RepositoryActionRequest | null => mode === 'fetch' ? { action: mode, remote, prune }
    : mode === 'push' ? { action: mode, remote, branch }
      : mode === 'stash-save' ? { action: mode, includeUntracked, message }
        : mode === 'stash-apply' ? { action: mode, stashOid: stash } : null
  const valid = mode === 'fetch' ? remote !== '' : mode === 'push' ? remote !== '' && branch.trim() !== '' : mode === 'stash-apply' ? stash !== '' : mode === 'stash-save'
  const prepare = async (): Promise<void> => {
    if (pending.current || !valid) return
    const value = request(), ticket = revision.current
    pending.current = true; setBusy(true); setError(null); setPreview(null)
    try {
      const next = await api.call<RepositoryActionPreview>('previewRepositoryAction', { sessionId, request: value })
      if (active.current && revision.current === ticket) setPreview(next)
    } catch { if (active.current) setError(t('repository.previewFailed')) }
    finally { pending.current = false; if (active.current) setBusy(false) }
  }
  const execute = async (): Promise<void> => {
    if (!preview || pending.current || JSON.stringify(preview.request) !== JSON.stringify(request())) return
    pending.current = true; setBusy(true); setError(null)
    const approved = preview
    setPreview(null)
    try {
      const next = await api.call<RepositoryActionResult>('executeRepositoryAction', { sessionId, request: approved.request, version: approved.version, approved: true })
      if (!active.current) return
      setResult(next)
      if (next.refresh) await onChanged()
      await load()
    } catch { if (active.current) setError(t('repository.unconfirmed')) }
    finally { pending.current = false; if (active.current) setBusy(false) }
  }
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
  return <Modal open title={t('repository.title')} className={classes.card} closeLabel={t('confirm.cancel')} onClose={close}>
    <div ref={body} className={classes.body} data-dsh-git="repository-workspace">
      <p className={classes.path}>{state.root}</p>
      <div className={classes.tabs} role="tablist" aria-label={t('repository.title')}>
        {(['fetch', 'push', 'stash-save', 'stash-apply', 'branches'] as const).map(item => <button key={item} type="button" role="tab" aria-selected={mode === item} disabled={busy || confirmation !== null} onClick={() => { invalidate(); setMode(item) }}>{t('repository.' + item as Parameters<Translate>[0])}</button>)}
      </div>
      {confirmation ? <>
        <p>{t('repository.branchConfirm', { name: confirmation.name, target: confirmation.to || confirmation.from || state.head.branch || 'HEAD' })}</p>
        {confirmation.oid && <code>{confirmation.oid}</code>}
        {forceNeeded && <label><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} />{t('repository.forceBranch')}</label>}
        <div className={classes.actions}><Button variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>{t('confirm.cancel')}</Button><Button variant={confirmation.method === 'branchDelete' ? 'outline' : 'primary'} disabled={busy || forceNeeded && !force} onClick={() => void applyBranch()}>{t('confirm.proceed')}</Button></div>
      </> : <fieldset disabled={busy} className={classes.form}>
        {(mode === 'fetch' || mode === 'push') && <>
          <label>{t('repository.remote')}<select value={remote} onChange={event => { invalidate(); setRemote(event.target.value) }}>{inventory.remotes.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
          {inventory.remotes.length === 0 && <p>{t('repository.noRemote')}</p>}
          <p className={classes.hint}>{inventory.remotes.find(item => item.name === remote)?.[mode === 'push' ? 'pushUrls' : 'fetchUrls'].join('\n')}</p>
        </>}
        {mode === 'fetch' && <label><input type="checkbox" checked={prune} onChange={event => { invalidate(); setPrune(event.target.checked) }} />{t('repository.prune')}</label>}
        {mode === 'push' && <><label>{t('repository.branch')}<input value={branch} onChange={event => { invalidate(); setBranch(event.target.value) }} /></label><p className={classes.hint}>{t('repository.noForce')}</p></>}
        {mode === 'stash-save' && <><label>{t('repository.message')}<input value={message} onChange={event => { invalidate(); setMessage(event.target.value) }} /></label><label><input type="checkbox" checked={includeUntracked} onChange={event => { invalidate(); setIncludeUntracked(event.target.checked) }} />{t('repository.includeUntracked')}</label></>}
        {mode === 'stash-apply' && <><label>{t('repository.stash')}<select value={stash} onChange={event => { invalidate(); setStash(event.target.value) }}>{inventory.stashes.map(item => <option key={item.oid} value={item.oid}>{item.label}</option>)}</select></label><p className={classes.hint}>{t('repository.keepStash')}</p></>}
        {mode === 'branches' && <>
          <label>{t('branches.createPlaceholder')}<input value={branchName} onChange={event => setBranchName(event.target.value)} /></label>
          <label>{t('repository.startPoint')}<select value={base} onChange={event => setBase(event.target.value)}>{state.branches.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
          <Button variant="ghost" disabled={!branchName.trim() || state.head.unborn || state.operation.kind !== null} onClick={() => branchConfirm('branchCreate')}>{t('branches.create')}</Button>
          <label>{t('repository.branch')}<select value={selectedBranch} onChange={event => setSelectedBranch(event.target.value)}>{state.branches.filter(item => !item.remote).map(item => <option key={item.name}>{item.name}</option>)}</select></label>
          <label>{t('branches.renamePlaceholder')}<input value={newName} onChange={event => setNewName(event.target.value)} /></label>
          <div className={classes.actions}><Button variant="ghost" disabled={!chosen || !newName.trim() || state.operation.kind !== null} onClick={() => branchConfirm('branchRename')}>{t('branches.rename')}</Button><Button variant="ghost" disabled={!chosen || chosen.current || checkedOut || state.operation.kind !== null} onClick={() => branchConfirm('branchDelete')}>{t('branches.delete')}</Button></div>
          {checkedOut && <p className={classes.hint}>{t('repository.checkedOut')}</p>}
        </>}
        {mode !== 'branches' && <Button variant="ghost" disabled={!valid} onClick={() => void prepare()}>{t('repository.preview')}</Button>}
      </fieldset>}
      {preview && <section><p>{preview.summary}</p><code>{preview.head}</code><ul>{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul><Button variant="primary" disabled={busy} onClick={() => void execute()}>{t('repository.apply')}</Button></section>}
      {result && <div role="status"><p>{t('repository.status.' + result.status as Parameters<Translate>[0])}</p>{result.message && <p>{result.message}</p>}</div>}
      {error && <p role="alert" className={classes.error}>{error}</p>}
      {busy && <p role="status">{t('repository.working')}</p>}
      <div className={classes.actions}><Button variant="ghost" disabled={busy} onClick={() => { invalidate(); void Promise.all([load(), onChanged()]).catch(() => setError(t('repository.readFailed'))) }}>{t('header.refresh')}</Button><Button variant="ghost" disabled={busy} onClick={close}>{t('confirm.cancel')}</Button></div>
    </div>
  </Modal>
}
