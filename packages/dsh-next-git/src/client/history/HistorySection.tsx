import * as React from 'react'
import { Button, IconBranchOutline16, IconChevronDownOutline14, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommitSummary } from '../../core/types.ts'
import type { HistoryAction } from '../../core/history-plan.ts'
import { graphWidth, MAX_GRAPH_LANES } from '../../core/log.ts'
import type { PanelSnapshot } from '../controller.ts'
import type { Translate } from '../GitPanel.tsx'
import panelClasses from '../panel.module.css'
import classes from './history-section.module.css'

export interface HistorySectionViewProps {
  snapshot: PanelSnapshot
  t: Translate
  onToggle(): void
  onRefresh(): void
  onLoadMore(): void
  onCheckout(commit: CommitSummary): void
  onInspect(commits: readonly CommitSummary[]): void
  onCompare(commits: readonly CommitSummary[]): void
  onAction(action: HistoryAction, commits: readonly CommitSummary[]): void
}

const actions = ['squash', 'fixup', 'reorder', 'reword', 'cherry-pick', 'revert'] as const

/** Checkout changes create a fresh selection; pagination does not. */
export function HistorySectionView(props: HistorySectionViewProps): React.ReactElement {
  const state = props.snapshot.state
  return <HistorySection key={JSON.stringify([state?.root, state?.head.branch, state?.head.oid])} {...props} />
}

function HistorySection({ snapshot, t, onToggle, onRefresh, onLoadMore, onCheckout, onInspect, onCompare, onAction }: HistorySectionViewProps): React.ReactElement {
  const [ids, setIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const commits = snapshot.history?.commits ?? []
  const lanes = snapshot.history?.lanes ?? []
  // Log order is topology-aware, unlike author timestamps (which may run backwards).
  const selected = commits.filter(commit => ids.has(commit.hash)).reverse()
  const width = Math.max(1, Math.min(MAX_GRAPH_LANES, graphWidth(lanes))) * 8 + 8
  const x = (lane: number): number => Math.min(MAX_GRAPH_LANES - 1, Math.max(0, lane)) * 8 + 8
  const locked = snapshot.busy !== null
  const choose = (hash: string): void => {
    setIds(previous => {
      const next = new Set(previous)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }
  /** Why one command cannot run on the current selection, or null when it can. */
  const reason = (action: HistoryAction): string | null => {
    if (locked || snapshot.state?.operation.kind) return t('history.reason.busy')
    if (selected.length === 0) return t('history.reason.selection')
    if (selected.length > 100) return t('history.reason.limit')
    if (selected.some(commit => commit.parents.length !== 1)) return t('history.reason.topology')
    if (action === 'reword' && selected.length !== 1) return t('history.reason.one')
    if (['squash', 'fixup', 'reorder'].includes(action) && selected.length < 2) return t('history.reason.multiple')
    if (action !== 'cherry-pick' && action !== 'revert') {
      if (selected.some((commit, index) => index > 0 && commit.parents[0] !== selected[index - 1]!.hash)) return t('history.reason.contiguous')
    }
    return null
  }
  const compare = selected.length === 2 ? null : t('history.reason.two')
  return <section className={`${panelClasses.section} ${classes.section}`} data-dsh-git="history">
    <div className={panelClasses.sectionHeader} onClick={event => {
      if (!(event.target as Element).closest('button')) onToggle()
    }}>
      <button type="button" className={panelClasses.sectionToggle} data-dsh-git="section-toggle" data-section="history" aria-controls="dsh-git-section-history" aria-expanded={!snapshot.collapsed.history} onClick={onToggle}>
        <IconChevronDownOutline14 size={12} className={snapshot.collapsed.history ? panelClasses.sectionChevronCollapsed : panelClasses.sectionChevron} />
        <span className={panelClasses.sectionTitle}>{t('history.title')}</span>
      </button>
      <span className={panelClasses.sectionSpacer} />
      <button type="button" className={panelClasses.iconButton} aria-label={t('history.refresh')} title={t('history.refresh')} data-dsh-git="history-refresh" disabled={snapshot.historyLoading || locked} onClick={onRefresh}>
        <IconRefreshOutline16 size={16} className={snapshot.historyLoading ? panelClasses.spinning : undefined} />
      </button>
    </div>
    {!snapshot.collapsed.history && <div id="dsh-git-section-history" className={classes.body} data-dsh-git="section-body" data-section="history">
      <div className={classes.toolbar} aria-label={t('history.selectionActions')}>
        <Button variant="ghost" disabled={selected.length === 0} onClick={() => onInspect(selected)}>{t('history.inspect')}</Button>
        <span title={compare ?? undefined}><Button variant="ghost" disabled={compare !== null} onClick={() => onCompare(selected)}>{t('history.compare')}</Button></span>
        {actions.map(action => { const disabled = reason(action); return <span key={action} title={disabled ?? undefined}><Button variant="ghost" disabled={disabled !== null} onClick={() => onAction(action, selected)}>{t('history.action.' + action as Parameters<Translate>[0])}</Button></span> })}
        <Button variant="ghost" disabled={selected.length === 0} onClick={() => setIds(new Set())}>{t('history.clearSelection')}</Button>
      </div>
      <p className={classes.hint}>{t('history.selectionHint')}</p>
      {commits.length === 0 && !snapshot.historyLoading && <p className={classes.hint}>{t('history.empty')}</p>}
      {commits.map((commit, index) => {
        const lane = lanes[index]
        const isSelected = ids.has(commit.hash)
        return <div key={commit.hash} className={classes.row} data-dsh-git="commit-row" data-hash={commit.hash} data-selected={isSelected}>
          <button type="button" className={classes.commit} data-dsh-git="commit-select" aria-pressed={isSelected} aria-label={t('history.selectCommit', { hash: commit.short })} onClick={() => choose(commit.hash)}>
            <svg className={classes.graph} width={width} height={48} viewBox={'0 0 ' + width + ' 48'} aria-hidden="true">
              {lanes[index - 1]?.edges.map((edge, i) => <path key={'in' + i} d={'M ' + x(edge.to) + ' 0 V 24'} />)}
              {lane?.edges.map((edge, i) => <path key={i} d={'M ' + x(edge.from) + ' 24 C ' + x(edge.from) + ' 36 ' + x(edge.to) + ' 36 ' + x(edge.to) + ' 48'} />)}
              <circle cx={x(lane?.lane ?? 0)} cy={24} r={3} />
            </svg>
            <span className={classes.content}>
              <span className={classes.subject}>{commit.subject}</span><span className={classes.meta}>{commit.short} · {commit.author}{commit.refs.length > 0 ? ' · ' + commit.refs.join(', ') : ''}</span>
            </span>
          </button>
          <div className={classes.actions}>
            <button type="button" className={panelClasses.iconButton} data-dsh-git="commit-checkout" disabled={locked || !!snapshot.state?.operation.kind} title={t('history.checkout')} aria-label={t('history.checkoutHash', { hash: commit.short })} onClick={() => onCheckout(commit)}>
              <IconBranchOutline16 size={16} />
            </button>
          </div>
        </div>
      })}
      {snapshot.historyLoading && <p role="status" className={classes.hint}>{t('history.loading')}</p>}
      {snapshot.history?.hasMore && <Button variant="ghost" disabled={snapshot.historyLoading || locked} onClick={onLoadMore}>{t('history.loadMore')}</Button>}
    </div>}
  </section>
}
