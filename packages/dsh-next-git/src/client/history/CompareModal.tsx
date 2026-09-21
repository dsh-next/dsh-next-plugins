import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseUnifiedDiff } from '../../core/diff.ts'
import type { CommitComparison } from '../../core/history-view.ts'
import type { CommitSummary } from '../../core/types.ts'
import type { GitApi } from '../api.ts'
import type { Translate } from '../GitPanel.tsx'
import { FileDiff } from '../ui/FileDiff.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './commit-details.module.css'

export interface CompareModalProps {
  sessionId: string
  /** Chronological, oldest first. The ends of the selection seed the endpoints. */
  commits: readonly CommitSummary[]
  t: Translate
  api: GitApi
  onClose(): void
}

/** One comparison between two commits of the current checkout. */
export function CompareModal({ sessionId, commits, t, api, onClose }: CompareModalProps): React.ReactElement {
  const [from, setFrom] = React.useState(commits[0]!.hash)
  const [to, setTo] = React.useState(commits.at(-1)!.hash)
  const [comparison, setComparison] = React.useState<CommitComparison | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  const body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)
  const distinct = from !== to

  React.useEffect(() => {
    const abort = new AbortController()
    setComparison(null)
    setFailed(false)
    if (!distinct) return () => abort.abort()
    void api.call<CommitComparison>('compareCommits', { sessionId, from, to }, abort.signal)
      .then(value => { if (!abort.signal.aborted) setComparison(value) })
      .catch(() => { if (!abort.signal.aborted) setFailed(true) })
    return () => abort.abort()
  }, [api, sessionId, from, to, version])

  const files = comparison === null ? [] : parseUnifiedDiff(comparison.patch)
  return <Modal open title={t('history.compare')} className={classes.card} contentClassName={classes.scroll} closeLabel={t('historyCompare.close')} onClose={onClose}>
    <div ref={body} className={classes.body} data-dsh-git="compare-modal">
      <div className={classes.endpoints}>
        {(['from', 'to'] as const).map(endpoint => <label key={endpoint} className={classes.picker}>
          {t(('historyCompare.' + endpoint) as Parameters<Translate>[0])}
          <select value={endpoint === 'from' ? from : to} onChange={event => (endpoint === 'from' ? setFrom : setTo)(event.target.value)}>
            {commits.map(commit => <option key={commit.hash} value={commit.hash}>{commit.short} {commit.subject}</option>)}
          </select>
        </label>)}
      </div>
      {!distinct ? <p className={classes.hint}>{t('historyCompare.distinct')}</p>
        : failed ? <div role="alert" className={classes.error}>
          {t('historyCompare.readFailed')}
          <Button variant="ghost" onClick={() => setVersion(value => value + 1)}>{t('historyDetails.retry')}</Button>
        </div>
        : comparison === null ? <p role="status" className={classes.hint}>{t('diff.loading')}</p>
        : files.length === 0 ? <p className={classes.hint}>{t('diff.empty')}</p>
        : <>
          {comparison.truncated && <p className={classes.warning}>{t('historyCompare.truncated')}</p>}
          {files.map(file => <section key={file.path} className={classes.compareFile}>
            <div className={classes.fileHeader}>{file.displayPath}</div>
            <FileDiff file={file} t={t} />
          </section>)}
        </>}
    </div>
  </Modal>
}
