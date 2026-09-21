import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PanelState } from '../../core/types.ts'
import type { RepositoryCommandRequest, RepositoryCommandPreview, RepositoryStashInspection, RepositoryCommandOutput } from '../../core/repository-commands.ts'
import type { RepositoryActionResult, RepositoryInventory } from '../../core/repository-actions.ts'
import { GitApiError, type GitApi } from '../api.ts'
import type { Translate } from '../GitPanel.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import { commandLabels, type RepositoryMenuCommand } from './commands.ts'
import classes from './repository.module.css'

export interface RepositoryCommandDialogProps {
  command: RepositoryMenuCommand
  state: PanelState
  sessionId: string
  api: GitApi
  t: Translate
  onClose(): void
  onChanged(): Promise<void> | void
}
interface Values { remote: string; branch: string; ref: string; name: string; url: string; directory: string; tag: string; message: string; stashOid: string }

/** Explicit mapping keeps menu aliases out of host command arguments. */
export function commandRequest(command: RepositoryMenuCommand, value: Values): RepositoryCommandRequest | null {
  const { remote, branch, ref, name, url, directory, tag, message, stashOid } = value
  switch (command) {
    case 'pull': case 'pull-from': case 'pull-rebase': return { action: 'pull', remote, branch, rebase: command === 'pull-rebase' }
    case 'sync': case 'publish': return { action: command, remote, branch }
    case 'push-force': case 'push-to-force': return { action: 'push-force', remote, branch }
    case 'fetch-all': return { action: 'fetch-all', prune: false }
    case 'merge': case 'rebase': return { action: command, ref }
    case 'remote-add': return { action: command, name, url }
    case 'remote-remove': case 'tags-push': return { action: command, remote }
    case 'remote-branch-delete': return { action: command, remote, branch }
    case 'tag-create': return { action: command, name, ref, message }
    case 'tag-delete': return { action: command, tag }
    case 'remote-tag-delete': return { action: command, remote, tag }
    case 'stash-staged': return { action: command, message }
    case 'stash-pop': case 'stash-pop-latest': return { action: 'stash-pop', stashOid }
    case 'stash-drop': return { action: command, stashOid }
    case 'stash-clear': case 'undo-commit': return { action: command }
    case 'clone': return { action: command, url, directory }
    default: return null
  }
}

export function RepositoryCommandDialog(props: RepositoryCommandDialogProps): React.ReactElement {
  return <Command key={JSON.stringify([props.sessionId, props.state.root, props.command])} {...props} />
}

function Command({ command, state, sessionId, api, t, onClose, onChanged }: RepositoryCommandDialogProps): React.ReactElement {
  const [values, setValues] = React.useState<Values>({ remote: '', branch: state.head.branch ?? '', ref: state.head.branch ?? '', name: '', url: '', directory: '', tag: state.tags[0]?.name ?? '', message: '', stashOid: '' })
  const [inventory, setInventory] = React.useState<RepositoryInventory>({ remotes: [], stashes: [] })
  const [preview, setPreview] = React.useState<RepositoryCommandPreview | null>(null)
  const [result, setResult] = React.useState<RepositoryActionResult | null>(null)
  const [output, setOutput] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const alive = React.useRef(true), pending = React.useRef(false), body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)
  const request = commandRequest(command, values)
  const remoteField = request !== null && 'remote' in request
  const stashField = command.startsWith('stash-') && command !== 'stash-staged'
  const branchField = request !== null && 'branch' in request
  const refField = request !== null && 'ref' in request
  const force = command === 'push-force' || command === 'push-to-force'
  const danger = force || ['remote-remove', 'remote-branch-delete', 'tag-delete', 'remote-tag-delete', 'stash-drop', 'stash-clear', 'undo-commit'].includes(command)
  const readOnly = command === 'output' || command === 'stash-view'
  React.useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      try {
        if (command === 'output') {
          const value = await api.call<RepositoryCommandOutput>('repositoryOutput', { sessionId }, controller.signal)
          if (alive.current) setOutput(value.text)
        } else if (remoteField || stashField || command === 'fetch-all') {
          const value = await api.call<RepositoryInventory>('repositoryInventory', { sessionId }, controller.signal)
          if (!alive.current) return
          setInventory(value)
          const upstreamRemote = [...value.remotes].sort((a, b) => b.name.length - a.name.length).find(remote => state.head.upstream?.startsWith(remote.name + '/'))
          const remote = upstreamRemote?.name ?? value.remotes[0]?.name ?? ''
          setValues(old => ({ ...old, remote, stashOid: value.stashes[0]?.oid ?? '',
            branch: upstreamRemote && ['pull', 'pull-rebase', 'sync'].includes(command) ? state.head.upstream!.slice(remote.length + 1) : old.branch,
          }))
        }
      } catch { if (alive.current) setError(t('commands.readFailed')) }
      finally { if (alive.current) setLoading(false) }
    }
    void load()
    return () => { alive.current = false; controller.abort() }
  }, [api, sessionId, command])
  const change = (key: keyof Values, value: string): void => {
    setValues(old => ({ ...old, [key]: value })); setPreview(null); setResult(null); setOutput(null); setError(null)
  }
  const valid = request !== null && Object.entries(request).every(([key, value]) => key === 'message' || typeof value !== 'string' || value.trim() !== '')
    && (command !== 'stash-clear' || inventory.stashes.length > 0)
    && (command !== 'fetch-all' || inventory.remotes.length > 0)
  const prepare = async (): Promise<void> => {
    if (pending.current || !request || !valid) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const value = await api.call<RepositoryCommandPreview>('previewRepositoryCommand', { sessionId, request })
      if (!alive.current) return
      if (value.checkout !== state.root || JSON.stringify(value.request) !== JSON.stringify(request)) setError(t('repository.previewMismatch'))
      else setPreview(value)
    } catch (cause) { if (alive.current) setError(t('repository.previewFailed') + (cause instanceof GitApiError && cause.failure.detail ? '\n' + cause.failure.detail : '')) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  const execute = async (): Promise<void> => {
    if (!preview || pending.current || JSON.stringify(preview.request) !== JSON.stringify(request)) return
    pending.current = true; setBusy(true); setError(null)
    const approved = preview
    setPreview(null)
    try {
      const value = await api.call<RepositoryActionResult>('executeRepositoryCommand', { sessionId, request: approved.request, version: approved.version, approved: true })
      if (!alive.current) return
      setResult(value)
      if (value.refresh) await onChanged()
    } catch { if (alive.current) setError(t('repository.unconfirmed')) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  const inspectStash = async (): Promise<void> => {
    if (pending.current || !values.stashOid) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const value = await api.call<RepositoryStashInspection>('inspectRepositoryStash', { sessionId, stashOid: values.stashOid })
      if (alive.current && value.stashOid === values.stashOid) setOutput(value.patch)
    } catch { if (alive.current) setError(t('commands.failed')) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  const input = (key: keyof Values, label: Parameters<Translate>[0]) => <label>{t(label)}<input value={values[key]} onChange={event => change(key, event.target.value)} /></label>
  return <Modal open title={t(commandLabels[command])} closeLabel={t('repository.close')} className={readOnly ? classes.reader : classes.card} onClose={() => { if (!pending.current) onClose() }}>
    <div ref={body} className={classes.body} data-dsh-git="repository-command" data-command={command}>
      {loading ? <p role="status">{t('repository.loading')}</p> : <>
        {!result && <fieldset disabled={busy} className={classes.form}>
          {remoteField && <label>{t('repository.remote')}<select value={values.remote} onChange={event => change('remote', event.target.value)}>{inventory.remotes.map(remote => <option key={remote.name}>{remote.name}</option>)}</select></label>}
          {(remoteField || command === 'fetch-all') && inventory.remotes.length === 0 && <p className={classes.hint}>{t('repository.noRemote')}</p>}
          {branchField && input('branch', 'repository.branch')}
          {refField && input('ref', 'commands.ref')}
          {(command === 'remote-add' || command === 'tag-create') && input('name', 'commands.name')}
          {(command === 'remote-add' || command === 'clone') && input('url', 'commands.url')}
          {command === 'clone' && <>{input('directory', 'commands.directory')}<p className={classes.hint}>{t('commands.cloneHint')}</p></>}
          {command === 'tag-create' && input('message', 'commands.annotation')}
          {command === 'stash-staged' && input('message', 'repository.message')}
          {command === 'tag-delete' && <label>{t('commands.tag')}<select value={values.tag} onChange={event => change('tag', event.target.value)}>{state.tags.map(tag => <option key={tag.name}>{tag.name}</option>)}</select></label>}
          {command === 'tag-delete' && state.tags.length === 0 && <p className={classes.hint}>{t('commands.noTags')}</p>}
          {command === 'remote-tag-delete' && input('tag', 'commands.tag')}
          {stashField && command !== 'stash-clear' && (command === 'stash-pop-latest' ? <p>{inventory.stashes[0]?.label ?? t('commands.noStashes')}</p>
            : <label>{t('repository.stash')}<select value={values.stashOid} onChange={event => change('stashOid', event.target.value)}>{inventory.stashes.map(stash => <option key={stash.oid} value={stash.oid}>{stash.label}</option>)}</select></label>)}
          {stashField && inventory.stashes.length === 0 && <p className={classes.hint}>{t('commands.noStashes')}</p>}
          {danger && <p className={classes.hint}>{t(force ? 'commands.forceWarning' : 'commands.destructiveWarning')}</p>}
          {command === 'stash-view' ? <Button variant="primary" disabled={!values.stashOid} onClick={() => void inspectStash()}>{t('commands.read')}</Button>
            : !readOnly && !preview && <Button variant="primary" disabled={!valid} onClick={() => void prepare()}>{t('repository.preview')}</Button>}
        </fieldset>}
        {preview && <section><p>{preview.summary}</p>{preview.warnings.length > 0 && <ul className={classes.hint}>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}<Button variant={danger ? 'outline' : 'primary'} className={danger ? classes.danger : undefined} disabled={busy} onClick={() => void execute()}>{t('commands.confirm')}</Button></section>}
        {output !== null && <pre className={classes.output}>{output || t('commands.noOutput')}</pre>}
        {result && <div role="status"><p>{t(`repository.status.${result.status}`)}</p>{result.message && <p>{result.message}</p>}</div>}
      </>}
      {error && <p role="alert" className={classes.error}>{error}</p>}
      {busy && <p role="status">{t('repository.working')}</p>}
    </div>
  </Modal>
}
