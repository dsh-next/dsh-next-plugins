import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HunkPreview, RepositoryActionResult } from '../../core/repository-actions.ts'
import type { DiffSide } from '../../core/types.ts'
import type { GitApi } from '../api.ts'
import type { Translate } from '../GitPanel.tsx'
import classes from './hunks.module.css'

export interface HunkControlsProps {
  sessionId: string; path: string; side: DiffSide; api: GitApi; t: Translate
  onChanged(): Promise<void> | void
  onWholeFile(): Promise<void> | void
}

export function HunkControls(props: HunkControlsProps): React.ReactElement {
  return <Controls key={JSON.stringify([props.sessionId, props.path, props.side])} {...props} />
}

function Controls({ sessionId, path, side, api, t, onChanged, onWholeFile }: HunkControlsProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [preview, setPreview] = React.useState<HunkPreview | null>(null)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const alive = React.useRef(true), pending = React.useRef(false), ticket = React.useRef(0)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; ++ticket.current } }, [])
  const load = async (): Promise<void> => {
    const id = ++ticket.current
    setBusy(true); setError(null)
    try {
      const value = await api.call<HunkPreview>('getHunks', { sessionId, path, side })
      if (alive.current && id === ticket.current) { setPreview(value); setSelected(new Set()) }
    } catch { if (alive.current && id === ticket.current) setError(t('hunks.readFailed')) }
    finally { if (alive.current && id === ticket.current) setBusy(false) }
  }
  const apply = async (): Promise<void> => {
    if (!preview || selected.size === 0 || pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const result = await api.call<RepositoryActionResult>('applyHunks', { sessionId, path, side, version: preview.version, hunkIds: [...selected], approved: true })
      if (!alive.current) return
      if (result.status !== 'completed' && result.status !== 'noop') { setError(t('hunks.writeFailed')); return }
      await onChanged()
      if (alive.current) await load()
    } catch { if (alive.current) setError(t('hunks.writeFailed')) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  return <div className={classes.root} data-dsh-git="hunk-controls">
    <Button size="sm" variant="ghost" disabled={busy} aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void load() }}>{t('hunks.title')}</Button>
    {open && <div className={classes.body}>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>{t('header.refresh')}</Button>
      {busy && <p role="status">{t('hunks.loading')}</p>}
      {error && <p role="alert" className={classes.error}>{error}</p>}
      {preview?.unsupported && <><p>{t('hunks.unsupported')}</p><Button size="sm" variant="ghost" disabled={busy} onClick={() => { void Promise.resolve(onWholeFile()).then(onChanged).then(load).catch(() => setError(t('hunks.writeFailed'))) }}>{t(side === 'staged' ? 'hunks.unstageFile' : 'hunks.stageFile')}</Button></>}
      {preview && !preview.unsupported && <>
        <p className={classes.hint}>{t('hunks.hint')}</p>
        {preview.hunks.length === 0 && <p>{t('diff.empty')}</p>}
        {preview.hunks.map((hunk, index) => <details key={hunk.id} className={classes.hunk}>
          <summary><label onClick={event => event.stopPropagation()}><input type="checkbox" checked={selected.has(hunk.id)} disabled={busy} aria-label={t('hunks.select', { number: index + 1 })} onChange={() => setSelected(old => { const next = new Set(old); if (next.has(hunk.id)) next.delete(hunk.id); else next.add(hunk.id); return next })} />{hunk.header}</label></summary>
          <pre tabIndex={0}>{hunk.patch}</pre>
        </details>)}
        <div className={classes.actions}><Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set(preview.hunks.map(hunk => hunk.id)))}>{t('hunks.selectAll')}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>{t('history.clearSelection')}</Button><Button size="sm" variant="primary" disabled={busy || selected.size === 0} onClick={() => void apply()}>{t(side === 'staged' ? 'hunks.unstageSelected' : 'hunks.stageSelected')}</Button></div>
      </>}
    </div>}
  </div>
}
