import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RepositoryActionPreview, RepositoryActionRequest, RepositoryActionResult, RepositoryInventory } from '../../core/repository-actions.ts'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import { repositoryActionLabel, type RepositoryWorkspaceViewProps } from './workspace-types.ts'
import classes from './repository.module.css'

/** Fetch, push and stash share a version-bound preview/approval protocol. */
export function TransferWorkspace({ sessionId, state, api, t, action: mode, initialPrune = false, initialIncludeUntracked = false, latestStash = false, onClose, onChanged }: RepositoryWorkspaceViewProps): React.ReactElement {
  const [inventory, setInventory] = React.useState<RepositoryInventory>({ remotes: [], stashes: [] })
  const [remote, setRemote] = React.useState('')
  const [branch, setBranch] = React.useState(state.head.branch ?? '')
  const [prune, setPrune] = React.useState(initialPrune)
  const [includeUntracked, setIncludeUntracked] = React.useState(initialIncludeUntracked)
  const [message, setMessage] = React.useState('')
  const [stash, setStash] = React.useState('')
  const [preview, setPreview] = React.useState<RepositoryActionPreview | null>(null)
  const [result, setResult] = React.useState<RepositoryActionResult | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const body = React.useRef<HTMLDivElement>(null)
  const active = React.useRef(true)
  const pending = React.useRef(false)
  const revision = React.useRef(0)
  const inventoryRevision = React.useRef(0)
  useDialogFocus(body)
  React.useEffect(() => { active.current = true; return () => { active.current = false; ++revision.current; ++inventoryRevision.current } }, [])

  const invalidate = (): void => { ++revision.current; setPreview(null); setResult(null); setError(null) }
  const load = async (): Promise<void> => {
    const ticket = ++inventoryRevision.current
    try {
      const value = await api.call<RepositoryInventory>('repositoryInventory', { sessionId })
      if (!active.current || ticket !== inventoryRevision.current) return
      setInventory(value)
      setRemote(old => value.remotes.some(item => item.name === old) ? old : value.remotes[0]?.name ?? '')
      setStash(old => value.stashes.some(item => item.oid === old) ? old : value.stashes[0]?.oid ?? '')
    } catch (cause) {
      if (active.current && ticket === inventoryRevision.current) throw cause
    }
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
      if (active.current && revision.current === ticket) {
        if (next.checkout !== state.root || JSON.stringify(next.request) !== JSON.stringify(value)) {
          setError(t('repository.previewMismatch'))
        } else setPreview(next)
      }
    } catch { if (active.current && revision.current === ticket) setError(t('repository.previewFailed')) }
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
  const close = (): void => { if (!pending.current) onClose() }

  return <Modal open title={t(repositoryActionLabel(mode))} className={classes.card} closeLabel={t('confirm.cancel')} onClose={close}>
    <div ref={body} className={classes.body} data-dsh-git="repository-workspace" data-action={mode}>
      <fieldset disabled={busy} className={classes.form}>
        {(mode === 'fetch' || mode === 'push') && <>
          <label>{t('repository.remote')}<select value={remote} onChange={event => { invalidate(); setRemote(event.target.value) }}>{inventory.remotes.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
          {inventory.remotes.length === 0 && <p>{t('repository.noRemote')}</p>}
          <p className={classes.hint}>{inventory.remotes.find(item => item.name === remote)?.[mode === 'push' ? 'pushUrls' : 'fetchUrls'].join('\n')}</p>
        </>}
        {mode === 'fetch' && <label><input type="checkbox" checked={prune} onChange={event => { invalidate(); setPrune(event.target.checked) }} />{t('repository.prune')}</label>}
        {mode === 'push' && <><label>{t('repository.branch')}<input value={branch} onChange={event => { invalidate(); setBranch(event.target.value) }} /></label><p className={classes.hint}>{t('repository.noForce')}</p></>}
        {mode === 'stash-save' && <><label>{t('repository.message')}<input value={message} onChange={event => { invalidate(); setMessage(event.target.value) }} /></label><label><input type="checkbox" checked={includeUntracked} onChange={event => { invalidate(); setIncludeUntracked(event.target.checked) }} />{t('repository.includeUntracked')}</label></>}
        {mode === 'stash-apply' && <>{latestStash ? <p>{inventory.stashes[0]?.label ?? t('commands.noStashes')}</p> : <label>{t('repository.stash')}<select value={stash} onChange={event => { invalidate(); setStash(event.target.value) }}>{inventory.stashes.map(item => <option key={item.oid} value={item.oid}>{item.label}</option>)}</select></label>}<p className={classes.hint}>{t('repository.keepStash')}</p></>}
        {!preview && !result && <Button variant="primary" disabled={!valid} onClick={() => void prepare()}>{t('repository.preview')}</Button>}
      </fieldset>
      {preview && <section><p>{preview.summary}</p><code>{preview.head}</code><ul>{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul><Button variant="primary" disabled={busy} onClick={() => void execute()}>{t('repository.apply')}</Button></section>}
      {result && <div role="status"><p>{t('repository.status.' + result.status as Parameters<typeof t>[0])}</p>{result.message && <p>{result.message}</p>}</div>}
      {error && <p role="alert" className={classes.error}>{error}</p>}
      {busy && <p role="status">{t('repository.working')}</p>}
    </div>
  </Modal>
}
