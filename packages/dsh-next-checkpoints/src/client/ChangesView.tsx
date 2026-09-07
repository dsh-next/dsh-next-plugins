/**
 * Changes conversation view: checkpoint rail + cumulative diffs + rewind modal.
 * Click selects. Rewind control + confirm modal restores. Selecting never restores.
 */
import * as React from 'react'
import { FilePreview } from './FilePreview.tsx'
import { validateHunks } from '../core/validate.ts'
import type {
  CheckpointDiffs,
  CheckpointList,
  CheckpointListItem,
  FileRow,
  RewindPreview,
  RewindResult,
} from '../core/types.ts'
import { DiffStat } from './DiffStat.tsx'
import { englishTranslate, type MessageKey, type Translate } from './dictionaries.ts'
import { clampRailWidth, RAIL_COLLAPSED, RAIL_DEFAULT, RAIL_NARROW } from './rail.ts'
import { CheckpointsRpcError, rpc } from './rpc.ts'
import { sumDiffs } from '../core/diffstat.ts'
import styles from './changes.module.css'

export type { Translate }

export interface ChangesViewProps {
  readonly sessionId?: string
  readonly t?: Translate
  readonly openSession?: (sessionId: string) => void
  readonly archiveSession?: (sessionId: string) => void | Promise<void>
}

function formatTime(time: number): string {
  const date = new Date(time)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function kindMessage(kind: FileRow['kind'], t: Translate): string | null {
  if (kind === 'binary') return t('file.binary')
  if (kind === 'too-large') return t('file.tooLarge')
  if (kind === 'invalid-utf8') return t('file.invalidUtf8')
  if (kind === 'timeout') return t('file.timeout')
  if (kind === 'symlink') return t('file.symlink')
  if (kind === 'directory') return t('file.directory')
  return null
}

type FileStatus = 'create' | 'delete' | 'modify'

function fileStatus(kind: FileRow['kind']): FileStatus | null {
  if (kind === 'create') return 'create'
  if (kind === 'delete') return 'delete'
  if (kind === 'diff') return 'modify'
  return null
}

function fileStatusKey(status: FileStatus): MessageKey {
  if (status === 'create') return 'file.created'
  if (status === 'delete') return 'file.deleted'
  return 'file.modified'
}

function rowCaption(item: CheckpointListItem, t: Translate): string {
  if (item.live) return item.promptPreview || t('row.inProgress')
  if (item.turn === 0) return t('row.sessionStart')
  return item.promptPreview || t('row.turn', { turn: item.turn })
}

export function ChangesView(props: ChangesViewProps): React.ReactElement {
  const t = props.t ?? englishTranslate
  const sessionId = props.sessionId ?? ''
  const [list, setList] = React.useState<CheckpointList | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [diffs, setDiffs] = React.useState<CheckpointDiffs | null>(null)
  const [fileKey, setFileKey] = React.useState<string | null>(null)
  const [railWidth, setRailWidth] = React.useState(RAIL_DEFAULT)
  const [narrow, setNarrow] = React.useState(false)
  const [narrowExpanded, setNarrowExpanded] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef({ origin: 0, base: RAIL_DEFAULT })
  const [modal, setModal] = React.useState<{
    item: CheckpointListItem
    preview: RewindPreview | null
    armed: boolean
    error: string | null
    busy: boolean
  } | null>(null)

  const listTick = React.useRef(0)
  const refresh = React.useCallback(() => {
    if (sessionId === '') return
    const tick = ++listTick.current
    void rpc<CheckpointList>('list', { sessionId }).then((payload) => {
      if (tick !== listTick.current) return
      setList(payload)
    }).catch(() => {
      if (tick !== listTick.current) return
      setList({ sessionId, checkpoints: [], rewoundTo: null, openTurn: false, cwd: null })
    })
  }, [sessionId])

  React.useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-dsh-next-checkpoints', 'open')
    return () => { root.removeAttribute('data-dsh-next-checkpoints') }
  }, [])

  React.useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const apply = (): void => {
      const next = el.clientWidth < RAIL_NARROW
      setNarrow(next)
      if (!next) setNarrowExpanded(false)
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [])

  const live = list?.checkpoints.find((item) => item.live)
  const liveId = live?.id
  const liveTick = live?.time ?? 0
  const liveSeen = React.useRef<string | undefined>(undefined)

  React.useEffect(() => {
    refresh()
    const ms = list?.openTurn === true ? 500 : 2500
    const timer = window.setInterval(() => {
      if (modal !== null) return
      refresh()
    }, ms)
    return () => { window.clearInterval(timer) }
  }, [refresh, modal, list?.openTurn])

  React.useEffect(() => {
    if (liveId !== undefined && liveSeen.current !== liveId) {
      setSelectedId(liveId)
    }
    liveSeen.current = liveId
  }, [liveId])

  React.useEffect(() => {
    if (list === null || list.checkpoints.length === 0) return
    if (selectedId !== null && list.checkpoints.some((item) => item.id === selectedId)) return
    setSelectedId(list.checkpoints[list.checkpoints.length - 1]!.id)
  }, [list, selectedId])

  React.useEffect(() => {
    if (sessionId === '' || selectedId === null) {
      setDiffs(null)
      return
    }
    let cancelled = false
    void rpc<CheckpointDiffs>('diffs', { sessionId, checkpointId: selectedId }).then((payload) => {
      if (!cancelled) setDiffs(payload)
    }).catch(() => {
      if (!cancelled) setDiffs({ checkpointId: selectedId, files: [] })
    })
    return () => { cancelled = true }
  }, [sessionId, selectedId, liveTick])

  React.useEffect(() => {
    setFileKey(null)
  }, [selectedId])

  const openRewind = (item: CheckpointListItem, event: React.MouseEvent): void => {
    event.stopPropagation()
    if (sessionId === '') return
    setModal({ item, preview: null, armed: false, error: null, busy: true })
    void rpc<RewindPreview>('preview', { sessionId, checkpointId: item.id }).then((preview) => {
      setModal((current) => current === null ? null : { ...current, preview, busy: false })
    }).catch((error: unknown) => {
      const message = error instanceof CheckpointsRpcError ? error.message : String(error)
      setModal((current) => current === null ? null : { ...current, busy: false, error: message })
    })
  }

  const closeModal = (): void => { setModal(null) }

  const closePreview = (): void => { setFileKey(null) }

  React.useEffect(() => {
    if (modal === null && fileKey === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (fileKey !== null) {
        closePreview()
        return
      }
      closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [modal, fileKey])

  const confirmRewind = (): void => {
    if (modal === null || sessionId === '') return
    if (!modal.armed) {
      setModal({ ...modal, armed: true })
      return
    }
    setModal({ ...modal, busy: true, error: null })
    void rpc<RewindResult>('rewind', { sessionId, checkpointId: modal.item.id }).then((result) => {
      setModal(null)
      if (result.nextSessionId !== undefined && result.nextSessionId !== sessionId) {
        props.openSession?.(result.nextSessionId)
        void props.archiveSession?.(sessionId)
        return
      }
      setSelectedId(modal.item.id)
      refresh()
    }).catch((error: unknown) => {
      const message = error instanceof CheckpointsRpcError ? error.message : String(error)
      setModal((current) => current === null ? null : { ...current, busy: false, error: message })
    })
  }

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      origin: event.clientX,
      base: collapsed ? RAIL_DEFAULT : railWidth,
    }
    setNarrowExpanded(true)
    setDragging(true)
  }

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    setRailWidth(clampRailWidth(drag.current.base - (event.clientX - drag.current.origin)))
  }

  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }

  const checkpoints = list?.checkpoints ?? []
  const selected = diffs?.files ?? []
  const totals = sumDiffs(selected)
  const activeFile = selected.find((file) => file.targetKey === fileKey)
  const hunks = activeFile !== undefined ? validateHunks(activeFile.hunks) : []
  const note = activeFile !== undefined ? kindMessage(activeFile.kind, t) : null
  const showBanner = list?.rewoundTo !== null && list?.rewoundTo === selectedId
  const collapsed = narrow && !narrowExpanded
  const railPx = collapsed ? RAIL_COLLAPSED : railWidth

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-testid="dsh-next-checkpoints"
      data-conversation-composer-overlay=""
      data-session-id={sessionId}
      data-collapsed={collapsed ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      style={{ ['--dsh-checkpoints-rail' as string]: `${railPx}px` }}
    >
      {showBanner && <div className={styles.banner} data-testid="dsh-next-checkpoints-banner">{t('banner')}</div>}
      {checkpoints.length === 0 ? (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{t('empty.title')}</h2>
          <p className={styles.emptyBody}>{t('empty.body')}</p>
        </div>
      ) : (
        <div className={styles.split}>
          <nav className={styles.rail} aria-label={t('rail.label')} data-collapsed={collapsed ? 'true' : undefined}>
            <div
              className={styles.handle}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('rail.resize')}
              data-testid="dsh-next-checkpoints-resize"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
            />
            <div className={styles.railLabel}>{t('rail.label')}</div>
            {checkpoints.map((item) => (
              <div
                key={item.id}
                className={styles.row}
                data-selected={item.id === selectedId ? 'true' : undefined}
                data-testid="dsh-next-checkpoints-row"
                data-turn={String(item.turn)}
                data-checkpoint-id={item.id}
                data-live={item.live ? 'true' : undefined}
                onClick={() => { setSelectedId(item.id) }}
              >
                <span
                  className={styles.icon}
                  aria-label={item.turn === 0 ? t('row.iconAriaStart') : t('row.iconAria', { turn: item.turn })}
                >
                  {item.turn}
                </span>
                {item.live ? (
                  <span
                    className={styles.rewindBtn}
                    title={t('row.inProgress')}
                    aria-label={t('row.inProgressAria', { turn: item.turn })}
                    data-testid="dsh-next-checkpoints-live"
                  >
                    <span className={styles.spinner} aria-hidden="true" />
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.rewindBtn}
                    title={t('row.rewind')}
                    aria-label={item.turn === 0 ? t('row.rewindAriaStart') : t('row.rewindAria', { turn: item.turn })}
                    data-testid="dsh-next-checkpoints-rewind"
                    onClick={(event) => { openRewind(item, event) }}
                  >
                    <span className={styles.rewindMark} aria-hidden="true" />
                  </button>
                )}
                <button type="button" className={styles.rowMeta}>
                  <span className={styles.rowHead}>
                    <span className={styles.rowTime}>{formatTime(item.time)}</span>
                    {item.live && (
                      <DiffStat added={item.added} removed={item.removed} t={t} />
                    )}
                  </span>
                  <span
                    className={styles.rowTurn}
                    data-testid="dsh-next-checkpoints-prompt"
                    title={item.promptTooltip ?? undefined}
                  >
                    {rowCaption(item, t)}
                  </span>
                </button>
              </div>
            ))}
          </nav>
          <section className={styles.pane}>
            <div className={styles.filesHead}>
              <div className={styles.filesLabel}>{t('files.label')}</div>
              <DiffStat
                added={totals.added}
                removed={totals.removed}
                t={t}
                testId="dsh-next-checkpoints-files-total"
                addedTestId="dsh-next-checkpoints-files-total-added"
                removedTestId="dsh-next-checkpoints-files-total-removed"
              />
            </div>
            {selected.length === 0 ? (
              <p className={styles.kindNote}>{t('files.empty')}</p>
            ) : (
              <div className={styles.fileList}>
                {selected.map((file) => {
                  const status = fileStatus(file.kind)
                  const statusClass = status === null
                    ? undefined
                    : {
                      create: styles.statusCreate,
                      delete: styles.statusDelete,
                      modify: styles.statusModify,
                    }[status]
                  return (
                    <button
                      key={file.targetKey}
                      type="button"
                      className={styles.fileRow}
                      data-selected={file.targetKey === activeFile?.targetKey ? 'true' : undefined}
                      data-testid="dsh-next-checkpoints-file"
                      data-kind={file.kind}
                      onClick={() => {
                        setFileKey((current) => current === file.targetKey ? null : file.targetKey)
                      }}
                    >
                      {status !== null && (
                        <span
                          className={`${styles.status} ${statusClass}`}
                          data-testid="dsh-next-checkpoints-file-kind"
                          data-status={status}
                        >
                          {t(fileStatusKey(status))}
                        </span>
                      )}
                      <span
                        className={styles.filePath}
                        data-deleted={file.kind === 'delete' ? 'true' : undefined}
                      >
                        {file.displayPath}
                      </span>
                      {file.changedAt !== null && (
                        <span className={styles.fileTime} data-testid="dsh-next-checkpoints-file-time">
                          {formatTime(file.changedAt)}
                        </span>
                      )}
                      <DiffStat added={file.added} removed={file.removed} t={t} />
                    </button>
                  )
                })}
              </div>
            )}

          </section>
        </div>
      )}
      {activeFile !== undefined && (
        <div
          className={styles.mask}
          onMouseDown={(event) => { if (event.target === event.currentTarget) closePreview() }}
        >
          <div
            className={styles.preview}
            role="dialog"
            aria-modal="true"
            aria-label={activeFile.displayPath}
            data-testid="dsh-next-checkpoints-preview"
          >
            <div className={styles.previewHead}>
              <div className={styles.previewTitle}>{activeFile.displayPath}</div>
              <div className={styles.previewMeta}>
                {activeFile.changedAt !== null && (
                  <span className={styles.fileTime} data-testid="dsh-next-checkpoints-preview-time">
                    {formatTime(activeFile.changedAt)}
                  </span>
                )}
                <DiffStat
                  added={activeFile.added}
                  removed={activeFile.removed}
                  t={t}
                  testId="dsh-next-checkpoints-preview-diffstat"
                  addedTestId="dsh-next-checkpoints-preview-added"
                  removedTestId="dsh-next-checkpoints-preview-removed"
                />
                <button type="button" className={styles.ghost} onClick={closePreview}>
                  {t('files.closePreview')}
                </button>
              </div>
            </div>
            {note !== null && (
              <p className={styles.kindNote} data-testid="dsh-next-checkpoints-kind">{note}</p>
            )}
            {note === null && hunks.length > 0 && (
              <FilePreview file={activeFile} hunks={hunks} />
            )}
          </div>
        </div>
      )}
      {modal !== null && (
        <div
          className={styles.mask}
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={t('modal.title')}
            data-testid="dsh-next-checkpoints-modal"
          >
            <div className={styles.modalTitle}>{t('modal.title')}</div>
            <p className={styles.modalBody}>{t('modal.body')}</p>
            <p className={styles.warn}>{t('modal.lost')}</p>
            {modal.preview !== null && (
              <>
                {modal.preview.filesDeleted.length > 0 && (
                  <div>
                    <div className={styles.listTitle}>{t('modal.filesDelete')}</div>
                    <ul className={styles.list}>
                      {modal.preview.filesDeleted.map((path) => <li key={path}>{path}</li>)}
                    </ul>
                  </div>
                )}
                {modal.preview.turnsShadowed > 0 && (
                  <p className={styles.modalBody}>{t('modal.turns', { count: modal.preview.turnsShadowed })}</p>
                )}
                {modal.preview.dirtyNonAgent.length > 0 && (
                  <div>
                    <div className={styles.listTitle}>{t('modal.dirty')}</div>
                    <ul className={styles.list}>
                      {modal.preview.dirtyNonAgent.map((path) => <li key={path}>{path}</li>)}
                    </ul>
                  </div>
                )}
                {modal.preview.headMoved && (
                  <p className={styles.warn}>
                    {t('modal.headMoved')}
                    {' '}
                    {t('modal.headMovedDetail', {
                      checkpoint: modal.preview.checkpointHead?.short ?? '',
                      current: modal.preview.currentHead?.short ?? '',
                    })}
                  </p>
                )}
                {modal.preview.blockers.includes('turn-open') && (
                  <p className={styles.error}>{t('modal.blocker.openTurn')}</p>
                )}
                {modal.preview.blockers.includes('unrestorable') && (
                  <p className={styles.error}>{t('modal.blocker.unrestorable')}</p>
                )}
                {modal.preview.blockers.includes('missing-blob') && (
                  <p className={styles.error}>{t('modal.blocker.unrestorable')}</p>
                )}
              </>
            )}
            {modal.error !== null && (
              <p className={styles.error}>{t('modal.error', { message: modal.error })}</p>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={closeModal} disabled={modal.busy}>
                {t('modal.cancel')}
              </button>
              <button
                type="button"
                className={modal.armed ? styles.danger : styles.ghost}
                disabled={modal.busy || (modal.preview !== null && modal.preview.blockers.length > 0)}
                data-testid="dsh-next-checkpoints-confirm"
                onClick={confirmRewind}
              >
                {modal.armed ? t('modal.confirm') : t('modal.rewind')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
