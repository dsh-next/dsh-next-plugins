import * as React from 'react'
import { IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconSparkleRegular, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentVerb } from '../../core/agent-verbs.ts'
import { PanelStore, type PanelSnapshot } from '../controller.ts'
import type { Translate } from '../dictionaries.ts'
import { RepositoryMenu } from '../repository/RepositoryMenu.tsx'
import type { RepositoryMenuCommand } from '../repository/commands.ts'
import { IconTooltip } from '../ui/IconTooltip.tsx'
import classes from '../panel.module.css'

interface HeaderProps {
  readonly snapshot: PanelSnapshot
  readonly t: Translate
  readonly store: PanelStore
  readonly busy: boolean
  /** Whether the ref picker the chip opens is showing. */
  readonly branchPickerOpen: boolean
  readonly onOpenBranchPicker: () => void
  readonly toolsOpen: boolean
  readonly setToolsOpen: (open: boolean) => void
  readonly onRefresh: () => void
  readonly onNewWorktree: () => void
  readonly onRepository: (action: RepositoryMenuCommand) => void
  readonly onAgentVerb?: ((verb: AgentVerb) => void) | undefined
}

/** Do not call an in-flight session read a missing repository. */
function branchLabel(snapshot: PanelSnapshot, t: Translate): string {
  const head = snapshot.state?.head
  if (head === undefined || head === null) {
    if (snapshot.phase === 'loading') return t('state.loading')
    if (snapshot.failure?.code === 'session-not-ready') return t('failure.sessionNotReady')
    return t('state.noRepository')
  }
  if (head.unborn) return t('header.unborn')
  return head.branch ?? t('header.detached')
}

export function PanelHeader(props: HeaderProps): React.ReactElement {
  const { snapshot, t, store, busy, toolsOpen, setToolsOpen } = props
  const state = snapshot.state
  const head = state?.head
  const label = branchLabel(snapshot, t)

  const toolItems: MenuEntry[] = [
    { id: 'agent-review', label: t('agent.review') },
    { id: 'agent-explain', label: t('agent.explain') },
    { id: 'agent-draft', label: t('agent.draft') },
    { id: 'agent-resolve', label: t('agent.resolve'), disabled: (state?.changes.conflicts.length ?? 0) === 0 },
  ]

  return (
    <header className={classes.header}>
      <div className={classes.headerMain}>
        <IconTooltip label={t('commands.sync')}>
          <button type="button" className={classes.iconButton} aria-label={t('commands.sync')}
            data-dsh-git="sync" disabled={busy || state === null} onClick={() => props.onRepository('sync')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M5 13V3m-3 3 3-3 3 3M11 3v10m-3-3 3 3 3-3" />
            </svg>
          </button>
        </IconTooltip>
        <button
          type="button"
          className={classes.branchButton}
          onClick={() => props.onOpenBranchPicker()}
          data-dsh-git="branch-button"
          aria-haspopup="dialog"
          aria-expanded={props.branchPickerOpen}
          aria-label={t('header.branchMenu')}
          title={t('header.branchMenu')}
        >
          <IconBranchOutlineRegular size={14} className={classes.branchGlyph} />
          <span className={classes.branchName} title={label}>
            {label}
          </span>
          <IconChevronDownOutlineRegular size={12} className={classes.branchGlyph} />
        </button>
        {head !== null && head !== undefined && (head.ahead > 0 || head.behind > 0) ? (
          <span className={classes.counts}>
            {head.ahead > 0 ? t('header.ahead', { count: head.ahead }) : null}
            {head.behind > 0 ? t('header.behind', { count: head.behind }) : null}
          </span>
        ) : null}
        {head !== null && head !== undefined && head.upstream !== null && head.behind > 0 ? (
          <IconTooltip label={t('header.updateTitle')}>
            <button
              type="button"
              className={classes.iconButton}
              aria-label={t('header.update')}
              data-dsh-git="update"
              disabled={busy}
              onClick={() => void store.updateFromBranch()}
            >
              <IconRefreshOutlineRegular size={14} />
            </button>
          </IconTooltip>
        ) : null}
      </div>
      <IconTooltip label={t('header.newWorktree')}>
        <button type="button" className={classes.iconButton} aria-label={t('header.newWorktree')} data-dsh-git="new-worktree" disabled={busy || state === null} onClick={props.onNewWorktree}><IconPlusOutlineRegular size={16} /></button>
      </IconTooltip>
      {props.onAgentVerb !== undefined ? (
        <Menu
          open={toolsOpen}
          anchor={
            <IconTooltip label={t('agent.title')}>
              <button
                type="button"
                className={classes.iconButton}
                aria-label={t('agent.title')}
                data-dsh-git="agent-menu"
                onClick={() => setToolsOpen(!toolsOpen)}
              >
                <IconSparkleRegular size={16} />
              </button>
            </IconTooltip>
          }
          items={toolItems}
          onSelect={(id) => {
            setToolsOpen(false)
            const verb = id.replace('agent-', '') as AgentVerb
            props.onAgentVerb?.(verb)
          }}
          onClose={() => setToolsOpen(false)}
          align="end"
          portal
        />
      ) : null}
      <IconTooltip label={t('header.refreshTitle')}>
        <button
          type="button"
          className={classes.iconButton}
          aria-label={t('header.refresh')}
          data-dsh-git="refresh"
          disabled={busy}
          onClick={props.onRefresh}
        >
          <IconRefreshOutlineRegular size={16} className={snapshot.reason === 'manual' && busy ? classes.spinning : undefined} />
        </button>
      </IconTooltip>
      {/* The catch-all menu closes the row: everything else is a one-click
          shortcut, and the three dots are where a command you cannot see lives. */}
      <RepositoryMenu t={t} disabled={busy || state === null} {...(state ? { state } : {})} onAction={props.onRepository} />
    </header>
  )
}
