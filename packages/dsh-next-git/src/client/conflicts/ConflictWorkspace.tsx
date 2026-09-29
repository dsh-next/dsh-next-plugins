import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConflictFile, ConflictFileChoice, ConflictResolvedResult, ConflictWorkspace, ConflictWriteResult } from '../../core/conflict-types.ts'
import { parseConflictText, renderConflictResult, resolveConflictHunk, validateConflictResult, type ConflictResolution, type TextConflictModel } from '../../core/conflicts.ts'
import { asApiError, type GitApi, type GitApiError } from '../api.ts'
import type { Translate } from '../dictionaries.ts'
import type { AgentActionRequest } from '../ai/action-dialog.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './conflict-workspace.module.css'

export interface ConflictWorkspaceViewProps {
  sessionId: string
  initialPath: string
  paths: readonly string[]
  t: Translate
  api: GitApi
  onClose(): void
  onChanged(): Promise<void> | void
  onAskAgent?(request: AgentActionRequest): void
}

type Confirmation = { kind: 'discard' | 'replace' | 'delete'; action(): void }
const choiceKeys = { current: 'conflict.chooseCurrent', incoming: 'conflict.chooseIncoming', base: 'conflict.chooseBase', delete: 'conflict.chooseDelete' } as const

/** A session change creates a fresh lifetime, never reuses another checkout's version. */
export function ConflictWorkspaceView(props: ConflictWorkspaceViewProps): React.ReactElement {
  return <Workspace key={props.sessionId} {...props} />
}

function Workspace({ sessionId, initialPath, paths, t, api, onClose, onChanged, onAskAgent }: ConflictWorkspaceViewProps): React.ReactElement {
  const [path, setPath] = React.useState(() => paths.includes(initialPath) ? initialPath : paths[0] ?? '')
  const [workspace, setWorkspace] = React.useState<ConflictWorkspace | null>(null)
  const [model, setModel] = React.useState<TextConflictModel | null>(null)
  const [draft, setDraft] = React.useState('')
  const [latest, setLatest] = React.useState<ConflictWorkspace | null>(null)
  const [error, setError] = React.useState<GitApiError | null>(null)
  const [stale, setStale] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [backups, setBackups] = React.useState<Record<string, string>>({})
  const [resolved, setResolved] = React.useState<readonly string[]>([])
  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(null)
  const body = React.useRef<HTMLDivElement>(null)
  const alive = React.useRef(true)
  const request = React.useRef(0)
  const readAbort = React.useRef<AbortController | null>(null)
  const writeAbort = React.useRef<AbortController | null>(null)
  const writing = React.useRef(false)
  const current = React.useRef({ workspace, draft, path })
  current.current = { workspace, draft, path }
  const restoreLabel = React.useRef<string | null>(null)
  useDialogFocus(body)

  const dirty = workspace !== null && draft !== (workspace.worktree.content ?? '')
  const markerFree = workspace !== null && workspace.markerSize !== null && validateConflictResult(draft, workspace.markerSize).valid
  const isResolved = resolved.includes(path) || (workspace !== null && !paths.includes(path))
  const unresolved = paths.filter((item) => !resolved.includes(item))
  const next = unresolved.find((item) => item !== path)
  const ready = workspace?.canMarkResolved === true && !dirty && markerFree && !stale && !isResolved
  const locked = busy || loading

  const install = React.useCallback((value: ConflictWorkspace): void => {
    setWorkspace(value)
    setDraft(value.worktree.content ?? '')
    setModel(value.model)
    setLatest(null)
    setStale(false)
    setError(null)
  }, [])
  const fail = (cause: unknown): void => {
    const failure = asApiError(cause)
    setError(failure)
    if (failure.code === 'dirty-tree') setStale(true)
  }
  const load = React.useCallback(async (target: string, mode: 'refresh' | 'reload' | 'compare' = 'refresh'): Promise<void> => {
    if (writing.current || target === '') return
    readAbort.current?.abort()
    const abort = new AbortController()
    readAbort.current = abort
    const ticket = ++request.current
    setLoading(true)
    try {
      const value = await api.call<ConflictWorkspace>('getConflict', { sessionId, path: target }, abort.signal)
      if (!alive.current || ticket !== request.current) return
      const previous = current.current
      const keepDraft = previous.workspace?.path === target && previous.draft !== (previous.workspace.worktree.content ?? '')
      if (mode === 'compare' || (mode !== 'reload' && keepDraft)) {
        setLatest(value)
        if (previous.workspace?.version !== value.version) setStale(true)
      } else install(value)
    } catch (cause) {
      if (alive.current && ticket === request.current && !abort.signal.aborted) fail(cause)
    } finally {
      if (alive.current && ticket === request.current) setLoading(false)
    }
  }, [api, sessionId, install])

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false; ++request.current; readAbort.current?.abort(); writeAbort.current?.abort() }
  }, [])
  // Parent refreshes (including completed agent turns) may replace paths. Never replace a draft.
  React.useEffect(() => {
    if (path && paths.includes(path) && !resolved.includes(path)) void load(path)
  }, [path, paths, load, resolved])
  React.useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  React.useEffect(() => {
    if (confirmation !== null) return
    const label = restoreLabel.current
    if (label === null) return
    const dialog = body.current?.closest('[role="dialog"]')
    const control = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => (item.getAttribute('aria-label') ?? item.textContent) === label)
    control?.focus()
    restoreLabel.current = null
  }, [confirmation])

  const confirm = (value: Confirmation): void => {
    const focused = document.activeElement
    restoreLabel.current = focused?.getAttribute('aria-label') ?? focused?.textContent ?? null
    setConfirmation(value)
  }
  const guard = (action: () => void): void => {
    if (writing.current) return
    if (dirty) confirm({ kind: 'discard', action })
    else action()
  }
  const close = (): void => {
    if (confirmation) setConfirmation(null)
    else guard(onClose)
  }
  const navigate = (target: string): void => guard(() => {
    ++request.current
    readAbort.current?.abort()
    setWorkspace(null); setModel(null); setDraft(''); setLatest(null); setError(null); setStale(false)
    setPath(target)
  })
  const changed = async (): Promise<void> => {
    try { await onChanged() } catch (cause) { if (alive.current) fail(cause) }
  }
  const refresh = async (): Promise<void> => {
    await changed()
    if (alive.current && !writing.current) await load(current.current.path)
  }
  const write = async (method: 'saveConflict' | 'chooseConflict' | 'markConflictResolved', side?: ConflictFileChoice): Promise<void> => {
    if (!workspace || writing.current || loading) return
    writing.current = true; setBusy(true); setError(null)
    const abort = new AbortController()
    writeAbort.current = abort
    ++request.current; readAbort.current?.abort()
    const args = { sessionId, path, expectedVersion: workspace.version,
      ...(method === 'saveConflict' ? { content: draft } : {}), ...(side ? { side } : {}) }
    try {
      if (method === 'markConflictResolved') {
        const value = await api.call<ConflictResolvedResult>(method, args, abort.signal)
        if (!alive.current) return
        setBackups((old) => ({ ...old, [path]: value.backupId }))
        setResolved((old) => [...old, path])
      } else {
        const value = await api.call<ConflictWriteResult>(method, args, abort.signal)
        if (!alive.current) return
        install(value.workspace)
        setBackups((old) => ({ ...old, [path]: value.backupId }))
      }
      await changed()
    } catch (cause) { if (alive.current) fail(cause) }
    finally { writing.current = false; if (alive.current) setBusy(false) }
  }
  const choose = (side: ConflictFileChoice): void => confirm({
    kind: side === 'delete' ? 'delete' : 'replace',
    // The replacement confirmation also explicitly warns about an unsaved draft.
    action: () => { void write('chooseConflict', side) },
  })
  const accept = (id: string, resolution: ConflictResolution): void => {
    if (!model) return
    const nextModel = resolveConflictHunk(model, id, resolution)
    setModel(nextModel); setDraft(renderConflictResult(nextModel))
  }
  const ask = (verb: 'explain' | 'resolve', selected: readonly string[]): void => guard(() => {
    // Lead owns closing this modal before opening the destination chooser.
    onAskAgent?.({ verb, scope: { paths: selected } })
  })
  const hunks = model?.segments.filter((segment) => segment.kind === 'conflict') ?? []

  return <Modal open title={t(confirmation ? confirmation.kind === 'discard' ? 'conflict.discardTitle' : 'conflict.confirmTitle' : 'conflict.title')}
    className={classes.card} contentClassName={classes.scroll} closeLabel={t('conflict.close')} onClose={close}>
    <div ref={body} className={classes.body} data-dsh-git="conflict-workspace">
      {confirmation ? <ConfirmationBody confirmation={confirmation} dirty={dirty} t={t}
        onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation.action; setConfirmation(null); action() }} /> : <>
        <div className={classes.actions}>
          <Button variant="ghost" disabled={locked} onClick={() => { void refresh() }}>{t('conflict.refresh')}</Button>
          <Button variant="ghost" disabled={busy || !next} onClick={() => { if (next) navigate(next) }}>{t('conflict.next')}</Button>
          <Button variant="ghost" disabled={locked || unresolved.length === 0 || onAskAgent === undefined} onClick={() => ask('resolve', unresolved)}>{t('conflict.resolveAll')}</Button>
        </div>
        <nav aria-label={t('conflict.files')} className={classes.files}>
          {[...new Set([...paths, ...resolved, ...(dirty ? [path] : [])])].map((item) => <button key={item} type="button" className={classes.file}
            aria-current={item === path ? 'page' : undefined} disabled={busy || resolved.includes(item)} onClick={() => { if (item !== path) navigate(item) }}>
            <span>{item}</span><span className={classes.hint}>{t(resolved.includes(item) || !paths.includes(item) ? 'conflict.resolved' : item === path && dirty ? 'conflict.dirty' : 'conflict.unresolved')}</span>
          </button>)}
        </nav>
        {unresolved.length === 0 && !dirty && <p role="status">{t('conflict.empty')}</p>}
        {loading && <p role="status">{t('conflict.loading')}</p>}
        {error && <div role="alert" className={classes.error}><p>{t('conflict.failure')}</p><p>{error.failure.detail}</p></div>}
        {stale && <p role="alert" className={classes.warning}>{t('conflict.stale')}</p>}
        {(error || stale || latest) && path && <div className={classes.actions}>
          <Button variant="ghost" disabled={locked} onClick={() => { void load(path, 'compare') }}>{t('conflict.compare')}</Button>
          <Button variant="ghost" disabled={locked} onClick={() => guard(() => { void load(path, 'reload') })}>{t('conflict.reload')}</Button>
        </div>}
        {workspace && <>
          <div className={classes.heading}><h3>{workspace.path}</h3><span className={classes.hint}>{t('conflict.operation.' + workspace.labels.operation as Parameters<Translate>[0])}</span></div>
          <div className={classes.panes}>
            {(['base', 'current', 'incoming'] as const).map((side) => <section key={side} className={classes.pane}>
              <h4>{t(('conflict.' + side) as Parameters<Translate>[0])}</h4>
              <p className={classes.hint}>{operationLabel(workspace, side, t)}</p>
              <p className={classes.ref}>{side === 'base' ? workspace.stages.base.oid : side === 'current' ? workspace.labels.currentRef : workspace.labels.incomingRef}</p>
              <FilePreview file={workspace.stages[side]} label={t(('conflict.' + side) as Parameters<Translate>[0])} t={t} />
            </section>)}
          </div>
          {workspace.unsupportedReason && <div className={classes.warning}><p>{t('conflict.unsupported')}</p><p>{workspace.unsupportedReason}</p></div>}
          <div className={classes.actions}>
            {workspace.choices.map((side) => <Button key={side} variant="ghost" disabled={locked || stale || isResolved} onClick={() => choose(side)}>{t(choiceKeys[side])}</Button>)}
          </div>
          {model && model.issues.length > 0 && <p className={classes.warning}>{t('conflict.malformed')}</p>}
          {workspace.canSave && hunks.map((hunk, index) => <fieldset key={hunk.id} className={classes.hunk} disabled={locked || isResolved}>
            <legend>{t('conflict.hunk', { number: index + 1 })}</legend>
            <div className={classes.hunkSides}><pre>{hunk.current}</pre><pre>{hunk.incoming}</pre></div>
            <div className={classes.actions}>
              <Button variant="ghost" onClick={() => accept(hunk.id, { kind: 'current' })}>{t('conflict.acceptCurrent')}</Button>
              <Button variant="ghost" onClick={() => accept(hunk.id, { kind: 'incoming' })}>{t('conflict.acceptIncoming')}</Button>
              <Button variant="ghost" onClick={() => accept(hunk.id, { kind: 'both', order: 'current-incoming' })}>{t('conflict.bothCurrentFirst')}</Button>
              <Button variant="ghost" onClick={() => accept(hunk.id, { kind: 'both', order: 'incoming-current' })}>{t('conflict.bothIncomingFirst')}</Button>
            </div>
            {hunk.resolution && <p className={classes.hint} role="status">{t('conflict.hunkDone')}</p>}
          </fieldset>)}
          {workspace.canSave ? <label className={classes.result}><span>{t('conflict.result')}</span>
            <textarea aria-label={t('conflict.result')} spellCheck={false} value={draft} disabled={locked || isResolved}
              onChange={(event) => { setDraft(event.target.value); setModel(workspace.markerSize === null ? null : parseConflictText(event.target.value, workspace.markerSize)) }} />
          </label> : <section><h4>{t('conflict.result')}</h4><FilePreview file={workspace.worktree} label={t('conflict.result')} t={t} /></section>}
          {latest && <section><h4>{t('conflict.latest')}</h4><p className={classes.hint}>{t('conflict.compareHint')}</p><FilePreview file={latest.worktree} label={t('conflict.latest')} t={t} /></section>}
          <p role="status" className={classes.hint}>{t(isResolved ? 'conflict.resolved' : dirty ? 'conflict.dirty' : ready ? 'conflict.ready' : 'conflict.saved')}</p>
          {!markerFree && <p className={classes.warning}>{t('conflict.markers')}</p>}
          {backups[path] && <p className={classes.backup}>{t('conflict.backup', { id: backups[path]! })}</p>}
          <div className={classes.actions}>
            <Button variant="ghost" disabled={locked || !workspace.canSave || !dirty || stale || isResolved} onClick={() => { void write('saveConflict') }}>{t('conflict.save')}</Button>
            <Button variant="primary" disabled={locked || !ready} onClick={() => { void write('markConflictResolved') }}>{t('conflict.mark')}</Button>
            <Button variant="ghost" disabled={locked || isResolved || onAskAgent === undefined} onClick={() => ask('explain', [path])}>{t('conflict.explain')}</Button>
            <Button variant="ghost" disabled={locked || isResolved || onAskAgent === undefined} onClick={() => ask('resolve', [path])}>{t('conflict.resolve')}</Button>
          </div>
          {busy && <p role="status">{t('conflict.saving')}</p>}
          <p className={classes.hint}>{t('conflict.agentHint')}</p>
        </>}
      </>}
    </div>
  </Modal>
}

function ConfirmationBody({ confirmation, dirty, t, onCancel, onConfirm }: { confirmation: Confirmation; dirty: boolean; t: Translate; onCancel(): void; onConfirm(): void }): React.ReactElement {
  const body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)
  return <div ref={body} className={classes.body} data-dsh-git="conflict-confirmation">
    <p>{t(confirmation.kind === 'discard' ? 'conflict.discardBody' : confirmation.kind === 'delete' ? 'conflict.confirmDelete' : 'conflict.confirmReplace')}</p>
    {dirty && confirmation.kind !== 'discard' && <p className={classes.warning}>{t('conflict.discardBody')}</p>}
    <div className={classes.actions}>
      <Button variant="ghost" onClick={onCancel}>{t(confirmation.kind === 'discard' ? 'conflict.cancel' : 'conflict.cancelChoice')}</Button>
      <Button variant="ghost" className={classes.danger} onClick={onConfirm}>{t(confirmation.kind === 'discard' ? 'conflict.discard' : confirmation.kind === 'delete' ? 'conflict.chooseDelete' : 'conflict.confirm')}</Button>
    </div>
  </div>
}

function FilePreview({ file, label, t }: { file: ConflictFile; label: string; t: Translate }): React.ReactElement {
  return file.kind === 'text' && file.content !== null
    ? <pre className={classes.preview} aria-label={label} tabIndex={0}>{file.content}</pre>
    : <p className={classes.hint}>{t(('conflict.kind.' + file.kind) as Parameters<Translate>[0])}</p>
}

function operationLabel(workspace: ConflictWorkspace, side: 'base' | 'current' | 'incoming', t: Translate): string {
  const operation = workspace.labels.operation
  const replay = operation === 'rebase' || operation === 'cherry-pick'
  if (operation === 'unknown') return t(side === 'base' ? 'conflict.label.unknownBase' : side === 'current' ? 'conflict.label.unknownCurrent' : 'conflict.label.unknownIncoming')
  if (side === 'current') return t(operation === 'rebase' ? 'conflict.label.rebaseCurrent' : 'conflict.label.current')
  if (side === 'incoming') return t(replay ? 'conflict.label.replayIncoming' : operation === 'revert' ? 'conflict.label.revertIncoming' : 'conflict.label.incoming')
  return t(replay ? 'conflict.label.replayBase' : operation === 'revert' ? 'conflict.label.revertBase' : 'conflict.label.base')
}
