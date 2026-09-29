import * as React from 'react'
import { Button, FileTypeIcon, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommitDetails, CommitFile } from '../../core/history-view.ts'
import type { CommitSummary, DiffResult } from '../../core/types.ts'
import type { GitApi } from '../api.ts'
import type { Translate } from '../dictionaries.ts'
import { FileDiff } from '../ui/FileDiff.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import panelClasses from '../panel.module.css'
import classes from './commit-details.module.css'

export interface CommitDetailsModalProps {
  sessionId: string
  /** Chronological, oldest first. The newest selected commit opens first. */
  commits: readonly CommitSummary[]
  t: Translate
  api: GitApi
  onClose(): void
}

/** A different selection or session owns a fresh read lifetime. */
export function CommitDetailsModal(props: CommitDetailsModalProps): React.ReactElement {
  return <Details key={JSON.stringify([props.sessionId, props.commits.map(commit => commit.hash)])} {...props} />
}

function Details({ sessionId, commits, t, api, onClose }: CommitDetailsModalProps): React.ReactElement {
  const newest = commits.at(-1)!
  const [hash, setHash] = React.useState(newest.hash)
  const [details, setDetails] = React.useState<CommitDetails | null>(null)
  const [path, setPath] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  const body = React.useRef<HTMLDivElement>(null)
  const commit = commits.find(item => item.hash === hash) ?? newest
  useDialogFocus(body)

  React.useEffect(() => {
    const abort = new AbortController()
    setDetails(null)
    setPath(null)
    setFailed(false)
    void api.call<CommitDetails>('getCommitDetails', { sessionId, hash: commit.hash }, abort.signal)
      .then(value => { if (!abort.signal.aborted) setDetails(value) })
      .catch(() => { if (!abort.signal.aborted) setFailed(true) })
    return () => abort.abort()
  }, [api, sessionId, commit.hash, version])

  const selected = details?.files.find(file => file.path === path) ?? details?.files[0]
  return <Modal open title={`${commit.short} · ${commit.subject}`} className={classes.card} contentClassName={classes.scroll} closeLabel={t('historyDetails.close')} onClose={onClose}>
    <div ref={body} className={classes.body} data-dsh-git="commit-details-modal">
      {commits.length > 1 && <label className={classes.picker}>{t('historyDetails.commit')}
        <select value={commit.hash} onChange={event => setHash(event.target.value)}>
          {[...commits].reverse().map(item => <option key={item.hash} value={item.hash}>{item.short} {item.subject}</option>)}
        </select>
      </label>}
      {failed ? <div role="alert" className={classes.error}>
        {t('historyDetails.readFailed')}
        <Button variant="ghost" onClick={() => setVersion(value => value + 1)}>{t('historyDetails.retry')}</Button>
      </div> : details === null ? <p role="status" className={classes.hint}>{t('diff.loading')}</p>
        : details.files.length === 0 ? <p className={classes.hint}>{t('historyDetails.empty')}</p>
        : <div className={classes.layout}>
          <section className={`${panelClasses.diffBody} ${classes.diff}`} data-dsh-git="commit-diff" aria-label={selected?.path}>
            {selected && <CommitFileDiff key={JSON.stringify([selected.path, selected.oldPath])} sessionId={sessionId} hash={commit.hash} file={selected} api={api} t={t} />}
          </section>
          <nav className={classes.sidebar} aria-label={t('historyDetails.files')}>
            <div className={panelClasses.groupHeader}><span className={panelClasses.groupTitle}>{t('historyDetails.files')}</span></div>
            {details.files.map(file => {
              const separator = file.path.lastIndexOf('/')
              const name = file.path.slice(separator + 1)
              const directory = separator < 0 ? '' : file.path.slice(0, separator)
              const status = file.status[0]
              const color = status === 'A' ? panelClasses.statusSuccess : status === 'D' ? panelClasses.statusDanger : panelClasses.statusWarn
              return <button key={file.path} type="button" className={`${panelClasses.row} ${classes.fileRow}`} data-dsh-git="commit-file" data-path={file.path}
                aria-current={selected?.path === file.path ? 'true' : undefined} onClick={() => setPath(file.path)}
                title={file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`}>
                <FileTypeIcon path={file.path} size={14} className={panelClasses.fileIcon} />
                <span className={panelClasses.fileName}>{name}</span>
                {directory && <span className={panelClasses.fileDir}>{directory}</span>}
                <span className={panelClasses.rowSpacer} />
                <span className={`${classes.status} ${color}`}>{status}</span>
              </button>
            })}
          </nav>
        </div>}
    </div>
  </Modal>
}

function CommitFileDiff({ sessionId, hash, file, api, t }: { sessionId: string; hash: string; file: CommitFile; api: GitApi; t: Translate }): React.ReactElement {
  const [diff, setDiff] = React.useState<DiffResult | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    const abort = new AbortController()
    setDiff(null)
    setFailed(false)
    void api.call<DiffResult>('getCommitDiff', { sessionId, hash, path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }) }, abort.signal)
      .then(value => { if (!abort.signal.aborted) setDiff(value) })
      .catch(() => { if (!abort.signal.aborted) setFailed(true) })
    return () => abort.abort()
  }, [api, sessionId, hash, file.path, file.oldPath, version])
  return <>
    <div className={classes.fileHeader}>{file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`}</div>
    {failed ? <div role="alert" className={classes.error}>
      {t('historyDetails.diffFailed')}
      <Button variant="ghost" onClick={() => setVersion(value => value + 1)}>{t('historyDetails.retry')}</Button>
    </div> : diff === null ? <p role="status" className={classes.hint}>{t('diff.loading')}</p>
      : diff.file === null ? <p className={classes.hint}>{t('diff.empty')}</p>
      : <FileDiff file={diff.file} t={t} />}
  </>
}
