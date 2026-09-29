import * as React from 'react'
import { FileTypeIcon, IconPlusOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiffSide, PanelState, StatusEntry } from '../../core/types.ts'
import { PanelStore, type PanelSnapshot } from '../controller.ts'
import type { Translate } from '../dictionaries.ts'
import { IconTooltip } from '../ui/IconTooltip.tsx'
import { CommitActions } from './CommitActions.tsx'
export { commitModifier } from './CommitActions.tsx'
import { Section } from '../ui/Section.tsx'
import { baseName } from '../ui/path-label.ts'
import classes from '../panel.module.css'

/**
 * The unstage glyph: the platform's `+` with its vertical bar removed.
 *
 * The icon set has no minus, so this reuses the exact crossbar geometry of
 * `IconPlusOutlineRegular` in the same 16x16 filled-path style, which makes the
 * stage and unstage actions read as one pair.
 */
export function MinusGlyph({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M1.5 7.34961H14.5V8.65039H1.5V7.34961Z" fill="currentColor" />
    </svg>
  )
}

/**
 * The status mark a row shows: git's own letter, colored by what it means.
 * VS Code's SCM view reads the same way, which keeps the row scannable when
 * the file name and its directory share one line.
 */
function statusLetter(entry: StatusEntry): string {
  // Conflicts keep both letters (`UU`, `AA`), which is what git itself prints
  // and what tells the user which side is missing.
  if (entry.unmerged !== undefined) return entry.xy
  const kind = entry.index ?? entry.worktree
  switch (kind) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'typechange':
      return 'T'
    case 'untracked':
      return 'U'
    default:
      return 'M'
  }
}

/** The color class for one change's status letter. */
function statusClass(entry: StatusEntry): string {
  if (entry.unmerged !== undefined) return classes.statusDanger
  if (entry.index === 'deleted' || entry.worktree === 'deleted') return classes.statusDanger
  if (entry.untracked) return classes.statusSuccess
  if (entry.index === 'added' || entry.index === 'renamed' || entry.index === 'copied') return classes.statusSuccess
  if (entry.index === 'modified' || entry.worktree === 'modified') return classes.statusWarn
  return classes.statusQuiet
}

/** Directory prefix of a path, for the row's second line. */
function dirName(path: string): string {
  const at = path.lastIndexOf('/')
  return at <= 0 ? '' : path.slice(0, at)
}

export function ChangesSection(props: {
  state: PanelState
  snapshot: PanelSnapshot
  t: Translate
  busy: boolean
  store: PanelStore
  collapsed: boolean
  onToggle: () => void
  onOpen: (path: string, side: DiffSide, oldPath?: string) => void
  onDiscard: (paths: readonly string[]) => void
}): React.ReactElement {
  const { state, t, busy, store, onOpen, onDiscard } = props
  const changes = state.changes
  // A conflicted path is listed once, under Conflicts: staging or discarding
  // it is not what resolves it.
  const changeable = {
    staged: changes.staged.filter((entry) => entry.unmerged === undefined),
    unstaged: changes.unstaged.filter((entry) => entry.unmerged === undefined),
  }
  // Discard covers everything the panel can restore or delete; a conflicted
  // path is resolved, not discarded.
  const discardable = [...changeable.unstaged, ...changes.untracked]
  const total = new Set([...changes.staged, ...changes.unstaged, ...changes.untracked].map((entry) => entry.path)).size

  return (
    <Section
      id="changes"
      title={t('changes.title')}
      count={total}
      collapsed={props.collapsed}
      onToggle={props.onToggle}
      actions={
        <>
          <CommitActions snapshot={props.snapshot} t={t} store={store} />
          {changeable.unstaged.length + changes.untracked.length > 0 ? (
            <IconTooltip label={t('changes.stageAll')}>
              <button
                type="button"
                className={classes.iconButton}
                aria-label={t('changes.stageAll')}
                data-dsh-git="stage-all"
                disabled={busy}
                onClick={() =>
                  void store.stage([...changeable.unstaged, ...changes.untracked].map((entry) => entry.path))
                }
              >
                <IconPlusOutlineRegular size={14} />
              </button>
            </IconTooltip>
          ) : null}
          {changeable.staged.length > 0 ? (
            <IconTooltip label={t('changes.unstageAll')}>
              <button
                type="button"
                className={classes.iconButton}
                aria-label={t('changes.unstageAll')}
                data-dsh-git="unstage-all"
                disabled={busy}
                onClick={() => void store.unstage(changeable.staged.map((entry) => entry.path))}
              >
                <MinusGlyph size={14} />
              </button>
            </IconTooltip>
          ) : null}
          {discardable.length > 0 ? (
            <IconTooltip label={t('changes.discardAll')}>
              <button
                type="button"
                className={classes.iconButton}
                aria-label={t('changes.discardAll')}
                data-dsh-git="discard-all"
                disabled={busy}
                onClick={() => onDiscard(discardable.map((entry) => entry.path))}
              >
                <IconTrashOutlineRegular size={14} />
              </button>
            </IconTooltip>
          ) : null}
        </>
      }
    >
      {total === 0 ? (
        <div className={classes.empty}>
          <span className={classes.emptyTitle}>{t('changes.none')}</span>
          <span className={classes.emptyHint}>{t('state.emptyHint')}</span>
        </div>
      ) : null}

      {changes.conflicts.length > 0 ? (
        <Group
          label={t('changes.conflicts')}
          entries={changes.conflicts}
          t={t}
          busy={busy}
          store={store}
          side="unstaged"
          onOpen={onOpen}
          onDiscard={onDiscard}
          readonly
        />
      ) : null}
      {changeable.staged.length > 0 ? (
        <Group
          label={t('changes.staged')}
          entries={changeable.staged}
          t={t}
          busy={busy}
          store={store}
          side="staged"
          onOpen={onOpen}
          onDiscard={onDiscard}
        />
      ) : null}
      {changeable.unstaged.length > 0 ? (
        <Group
          label={t('changes.unstaged')}
          entries={changeable.unstaged}
          t={t}
          busy={busy}
          store={store}
          side="unstaged"
          onOpen={onOpen}
          onDiscard={onDiscard}
        />
      ) : null}
      {changes.untracked.length > 0 ? (
        <Group
          label={t('changes.untracked')}
          entries={changes.untracked}
          t={t}
          busy={busy}
          store={store}
          side="unstaged"
          onOpen={onOpen}
          onDiscard={onDiscard}
        />
      ) : null}
      {changes.ignoredCount > 0 ? (
        <div className={classes.caption} data-dsh-git="ignored">
          {t('changes.ignored', { count: changes.ignoredCount })}
        </div>
      ) : null}
    </Section>
  )
}

function Group(props: {
  label: string
  entries: readonly StatusEntry[]
  t: Translate
  busy: boolean
  store: PanelStore
  side: DiffSide
  readonly?: boolean
  onOpen: (path: string, side: DiffSide, oldPath?: string) => void
  onDiscard: (paths: readonly string[]) => void
}): React.ReactElement {
  const { label, entries, t, busy, store, side, onOpen, onDiscard } = props
  return (
    <div data-dsh-git="group">
      <div className={classes.groupHeader}>
        <span className={classes.groupTitle}>{label}</span>
        <span className={classes.groupCount}>{entries.length}</span>
      </div>
      {entries.map((entry) => (
        <div
          key={`${entry.path}:${entry.xy}`}
          className={classes.row}
          data-dsh-git="row"
          data-path={entry.path}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(entry.path, side, entry.oldPath)}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              onOpen(entry.path, side, entry.oldPath)
            }
          }}
        >
          <FileTypeIcon path={entry.path} size={14} className={classes.fileIcon} />
          <span
            className={classes.fileName}
            title={entry.oldPath === undefined ? entry.path : `${entry.oldPath} -> ${entry.path}`}
          >
            {baseName(entry.path)}
          </span>
          {entry.oldPath === undefined ? null : (
            <span className={classes.fileFrom}>{`<- ${baseName(entry.oldPath)}`}</span>
          )}
          {dirName(entry.path) === '' ? null : <span className={classes.fileDir}>{dirName(entry.path)}</span>}
          <span className={classes.rowSpacer} />
          <span
            className={`${classes.statusLetter} ${statusClass(entry)}`}
            data-dsh-git="status"
            aria-hidden
          >
            {statusLetter(entry)}
          </span>
          <div className={`${classes.rowActions} ${classes.rowActionsOverlay}`}>
            {props.readonly === true ? null : side === 'staged' ? (
              <IconTooltip label={t('changes.unstage')}>
                <button
                  type="button"
                  className={classes.iconButton}
                  aria-label={t('changes.unstage')}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation()
                    void store.unstage([entry.path])
                  }}
                >
                  <MinusGlyph size={14} />
                </button>
              </IconTooltip>
            ) : (
              <IconTooltip label={t('changes.stage')}>
                <button
                  type="button"
                  className={classes.iconButton}
                  aria-label={t('changes.stage')}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation()
                    void store.stage([entry.path])
                  }}
                >
                  <IconPlusOutlineRegular size={14} />
                </button>
              </IconTooltip>
            )}
            {props.readonly === true || side === 'staged' ? null : (
              <IconTooltip label={t('changes.discard')}>
                <button
                  type="button"
                  className={classes.iconButton}
                  aria-label={t('changes.discard')}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation()
                    onDiscard([entry.path])
                  }}
                >
                  <IconTrashOutlineRegular size={14} />
                </button>
              </IconTooltip>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
