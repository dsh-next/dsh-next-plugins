import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommitSummary } from '../../core/types.ts'
import type { HistoryAction } from '../../core/history-plan.ts'
import type { HistoryQuery } from '../../core/history-view.ts'
import { graphWidth, MAX_GRAPH_LANES } from '../../core/log.ts'
import type { PanelSnapshot } from '../controller.ts'
import type { Translate } from '../GitPanel.tsx'
import classes from './history-section.module.css'

export interface HistorySectionViewProps {
  snapshot: PanelSnapshot
  t: Translate
  onToggle(): void
  onRefresh(): void
  onLoadMore(): void
  onCheckout(commit: CommitSummary): void
  onOpen(commits: readonly CommitSummary[], action?: HistoryAction): void
  query: HistoryQuery
  onQuery(query: HistoryQuery): void
}

const actions = ['squash', 'fixup', 'reorder', 'reword', 'cherry-pick', 'revert'] as const

/** Filters and checkout changes create a fresh selection; pagination does not. */
export function HistorySectionView(props: HistorySectionViewProps): React.ReactElement {
  return <HistorySection key={JSON.stringify([props.snapshot.state?.root])} {...props} />
}

function HistorySection({ snapshot, t, onToggle, onRefresh, onLoadMore, onCheckout, onOpen, query, onQuery }: HistorySectionViewProps): React.ReactElement {
  const [ids, setIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const anchor = React.useRef<string | null>(null)
  React.useEffect(() => { setIds(new Set()); anchor.current = null }, [query.ref, query.search, query.author, query.since, query.until])
  const commits = snapshot.history?.commits ?? []
  const lanes = snapshot.history?.lanes ?? []
  // Log order is topology-aware, unlike author timestamps (which may run backwards).
  const selected = commits.filter(commit => ids.has(commit.hash)).reverse()
  const width = Math.max(1, Math.min(MAX_GRAPH_LANES, graphWidth(lanes))) * 8 + 8
  const x = (lane: number): number => Math.min(MAX_GRAPH_LANES - 1, Math.max(0, lane)) * 8 + 8
  const locked = snapshot.busy !== null
  const choose = (index: number, range: boolean): void => {
    const commit = commits[index]
    if (!commit) return
    const start = commits.findIndex(item => item.hash === anchor.current)
    setIds(previous => {
      const next = new Set(previous)
      if (range && start >= 0) {
        for (const item of commits.slice(Math.min(start, index), Math.max(start, index) + 1)) next.add(item.hash)
      } else if (next.has(commit.hash)) next.delete(commit.hash)
      else next.add(commit.hash)
      return next
    })
    if (!range || start < 0) anchor.current = commit.hash
  }
  const reason = (action: HistoryAction): string | null => {
    if (locked || snapshot.state?.operation.kind) return t('history.reason.busy')
    if (selected.length === 0) return t('history.reason.selection')
    if (selected.length > 100) return t('history.reason.limit')
    if (selected.some(commit => commit.parents.length !== 1)) return t('history.reason.topology')
    if (action === 'reword' && selected.length !== 1) return t('history.reason.one')
    if (['squash', 'fixup', 'reorder'].includes(action) && selected.length < 2) return t('history.reason.multiple')
    if (action !== 'cherry-pick' && action !== 'revert') {
      if (query.ref !== null && query.ref !== snapshot.state?.head.branch && query.ref !== 'refs/heads/' + snapshot.state?.head.branch && query.ref !== 'HEAD') return t('history.reason.current')
      if (selected.some((commit, index) => index > 0 && commit.parents[0] !== selected[index - 1]!.hash)) return t('history.reason.contiguous')
    }
    return null
  }
  return <section className={classes.section} data-dsh-git="history">
    <div className={classes.header}>
      <button type="button" className={classes.heading} data-dsh-git="section-toggle" data-section="history" aria-controls="dsh-git-section-history" aria-expanded={!snapshot.collapsed.history} onClick={onToggle}>{t('history.title')}</button>
      <Button variant="ghost" disabled={snapshot.historyLoading || locked} onClick={onRefresh}>{t('history.refresh')}</Button>
    </div>
    {!snapshot.collapsed.history && <div id="dsh-git-section-history" data-dsh-git="section-body" data-section="history">
      <div className={classes.filters}>
        <label>{t('history.ref')}<select value={query.ref ?? ''} onChange={event => onQuery({ ...query, ref: event.target.value || null })}>
          <option value="">{t('history.currentRef')}</option>
          {snapshot.state?.branches.map(branch => <option key={branch.name} value={branch.remote ? 'refs/remotes/' + branch.name : 'refs/heads/' + branch.name}>{branch.name}</option>)}
          {snapshot.state?.tags.map(tag => <option key={'tag:' + tag} value={'refs/tags/' + tag}>{tag}</option>)}
        </select></label>
        {(['search', 'author', 'since', 'until'] as const).map(field => <label key={field}>{t('history.' + field as Parameters<Translate>[0])}<input type={field === 'since' || field === 'until' ? 'date' : 'search'} value={query[field]} onChange={event => onQuery({ ...query, [field]: event.target.value })} /></label>)}
      </div>
      <p className={classes.hint} role="status">{t('history.selected', { count: selected.length })}</p>
      <div className={classes.toolbar} aria-label={t('history.selectionActions')}>
        <Button variant="ghost" disabled={selected.length === 0} onClick={() => onOpen(selected)}>{t('history.inspect')}</Button>
        <span title={selected.length !== 2 ? t('history.reason.two') : undefined}><Button variant="ghost" disabled={selected.length !== 2} onClick={() => onOpen(selected)}>{t('history.compare')}</Button></span>
        {actions.map(action => { const disabled = reason(action); return <span key={action} title={disabled ?? t('history.hostValidation')}><Button variant="ghost" disabled={disabled !== null} onClick={() => onOpen(selected, action)}>{t('historyPlan.action.' + action as Parameters<Translate>[0])}</Button></span> })}
        <Button variant="ghost" disabled={selected.length === 0} onClick={() => { setIds(new Set()); anchor.current = null }}>{t('history.clearSelection')}</Button>
      </div>
      <p className={classes.hint}>{t('history.selectionHint')}</p>
      {commits.length === 0 && !snapshot.historyLoading && <p className={classes.hint}>{t('history.noMatches')}</p>}
      <div className={classes.rows}>
        {commits.map((commit, index) => {
          const lane = lanes[index]
          return <div key={commit.hash} className={classes.row} data-dsh-git="commit-row" data-hash={commit.hash} data-selected={ids.has(commit.hash)}>
            <input type="checkbox" checked={ids.has(commit.hash)} aria-label={t('history.selectCommit', { hash: commit.short })}
              onClick={event => choose(index, event.shiftKey)} onChange={() => {}}
              onKeyDown={event => { if (event.key === ' ') { event.preventDefault(); choose(index, event.shiftKey) } }} />
            <svg className={classes.graph} width={width} height={48} viewBox={'0 0 ' + width + ' 48'} aria-hidden="true">
              {lanes[index - 1]?.edges.map((edge, i) => <path key={'in' + i} d={'M ' + x(edge.to) + ' 0 V 24'} />)}
              {lane?.edges.map((edge, i) => <path key={i} d={'M ' + x(edge.from) + ' 24 C ' + x(edge.from) + ' 36 ' + x(edge.to) + ' 36 ' + x(edge.to) + ' 48'} />)}
              <circle cx={x(lane?.lane ?? 0)} cy={24} r={3} />
            </svg>
            <button type="button" className={classes.commit} onClick={event => { if (event.shiftKey || event.metaKey || event.ctrlKey) choose(index, event.shiftKey); else onOpen([commit]) }}
              onKeyDown={event => { if (event.key === ' ' || ((event.ctrlKey || event.metaKey || event.shiftKey) && event.key === 'Enter')) { event.preventDefault(); choose(index, event.shiftKey) } }}>
              <span className={classes.subject}>{commit.subject}</span><span className={classes.meta}>{commit.short} · {commit.author}{commit.refs.length > 0 ? ' · ' + commit.refs.join(', ') : ''}</span>
            </button>
            <button type="button" className={classes.checkout} disabled={locked || !!snapshot.state?.operation.kind} title={t('history.checkout')} aria-label={t('history.checkoutHash', { hash: commit.short })} onClick={() => onCheckout(commit)}>{t('history.checkoutShort')}</button>
          </div>
        })}
      </div>
      {snapshot.historyLoading && <p role="status">{t('history.loading')}</p>}
      {snapshot.history?.hasMore && <Button variant="ghost" disabled={snapshot.historyLoading || locked} onClick={onLoadMore}>{t('history.loadMore')}</Button>}
    </div>}
  </section>
}
