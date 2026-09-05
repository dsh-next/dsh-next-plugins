/**
 * The plugin's modal surface: a body-level React root owning the merge
 * and delete modals (create is modal-free since rev 3 — the repo-row
 * button runs the auto-named flow directly). Rendered outside the
 * official browser's tree on purpose — the conversation and the sidebar
 * stay pure harness; our overlays live in our own root.
 *
 * Chrome follows the harness modal grammar (docs/agents design law):
 * elevation shadow with no border, radius 12, 15/1.4-600 titles, 13/20
 * body and controls, one primary action, focus ring on the shell's
 * business token, Escape cancels.
 */
import * as React from 'react'
import {
  armDelete,
  cleanupMerged,
  closeModal,
  executeDelete,
  executeMerge,
  modalState,
  subscribeModal,
  type HostCleanup,
  type MergePreflightFacts,
  type WorktreeModalTarget,
} from './create-store.ts'
import { rpc, requestTopologyRefresh } from './rpc.ts'
import type {
  SessionsServiceLike,
  Translate,
  WorkspacesServiceLike,
} from './types.ts'

export interface ModalHostProps {
  readonly t: Translate
  readonly workspaces: WorkspacesServiceLike
  readonly sessions: SessionsServiceLike
}

/** Host-truth cleanup over the stock workspace service. */
function hostCleanup(workspaces: WorkspacesServiceLike): HostCleanup {
  return {
    archiveSession: (sessionId) => workspaces.archiveSession(sessionId),
    removeWorkspace: (workspaceId) => workspaces.delete(workspaceId),
  }
}

const BLOCKER_KEYS: Readonly<Record<string, string>> = {
  'dirty-primary': 'merge.blocker.dirtyPrimary',
  'dirty-worktree': 'merge.blocker.dirtyWorktree',
  running: 'merge.blocker.running',
  conflict: 'merge.blocker.conflict',
  'old-git': 'merge.blocker.oldGit',
}

/** The root: renders the active modal, or nothing. */
export function ModalHost(props: ModalHostProps): React.ReactElement | null {
  const state = React.useSyncExternalStore(subscribeModal, modalState, modalState)
  if (props.workspaces === undefined) return null
  const host = hostCleanup(props.workspaces)
  if (state.kind === 'merge' && state.merge !== undefined) {
    return <MergeModal t={props.t} merge={state.merge} host={host} />
  }
  if (state.kind === 'delete' && state.delete !== undefined) {
    return (
      <DeleteModal
        t={props.t}
        target={state.delete.target}
        armed={state.delete.armed}
        busy={state.delete.busy}
        error={state.delete.error}
        host={host}
      />
    )
  }
  return null
}

function useEscapeClose(): void {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])
}

function MergeModal({ t, merge, host }: {
  readonly t: Translate
  readonly host: HostCleanup
  readonly merge: {
    readonly target: WorktreeModalTarget
    readonly preflight?: MergePreflightFacts
    readonly busy: boolean
    readonly done?: { target: string; fastForward: boolean }
    readonly error?: string
  }
}): React.ReactElement {
  useEscapeClose()
  const preflight = merge.preflight
  return (
    <div
      className="dshx-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}
      data-dshx-modal="merge"
    >
      <div className="dshx-modal" role="dialog" aria-modal="true" aria-label={t('merge.title')}>
        <div className="dshx-modalTitle">{t('merge.title')}</div>
        {merge.done !== undefined && (
          <div className="dshx-modalBody">
            <div className="dshx-doneTitle">{t('merge.done.title', { target: merge.done.target })}</div>
            <div className="dshx-fieldHint">{t('merge.done.cleanup')}</div>
          </div>
        )}
        {merge.done === undefined && (
          <div className="dshx-modalBody">
            {preflight !== undefined && preflight.source !== undefined && preflight.target !== undefined && (
              <div className="dshx-factLine" data-dshx-merge="summary">
                {t('merge.summary', { source: preflight.source, target: preflight.target })}
              </div>
            )}
            {preflight !== undefined && preflight.green && (
              <div className="dshx-factLine" data-dshx-merge="shape">
                {t(preflight.fastForward ? 'merge.ff' : 'merge.commit')}
              </div>
            )}
            {preflight !== undefined && !preflight.green && (
              <div className="dshx-blockers" data-dshx-merge="blockers">
                {preflight.blockers.map((code) => (
                  <div key={code} className="dshx-error" data-dshx-blocker={code}>
                    {BLOCKER_KEYS[code] !== undefined
                      ? t(BLOCKER_KEYS[code]!, code === 'conflict' || code === 'old-git'
                        ? { command: preflight.manualCommand ?? '' }
                        : undefined)
                      : code}
                  </div>
                ))}
              </div>
            )}
            {preflight === undefined && <div className="dshx-fieldHint">{t('row.refresh')}</div>}
            {merge.error !== undefined && <div className="dshx-error" data-dshx-error>{merge.error}</div>}
          </div>
        )}
        <div className="dshx-modalActions">
          {merge.done === undefined && (
            <button type="button" className="dshx-buttonGhost" disabled={merge.busy} onClick={closeModal} data-dshx-button="cancel">
              {t('create.cancel')}
            </button>
          )}
          {merge.done === undefined && (
            <button
              type="button"
              className="dshx-buttonPrimary"
              disabled={merge.busy || preflight === undefined || !preflight.green}
              onClick={() => { executeMerge(rpc) }}
              data-dshx-button="merge"
            >
              {t('row.merge')}
            </button>
          )}
          {merge.done !== undefined && (
            <button type="button" className="dshx-buttonGhost" disabled={merge.busy} onClick={() => { closeModal(); requestTopologyRefresh() }} data-dshx-button="keep">
              {t('merge.done.keep')}
            </button>
          )}
          {merge.done !== undefined && (
            <button
              type="button"
              className="dshx-buttonPrimary"
              disabled={merge.busy}
              onClick={() => { void cleanupMerged(rpc, host).then(() => requestTopologyRefresh()) }}
              data-dshx-button="cleanup"
            >
              {t('merge.done.remove')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DeleteModal({ t, target, armed, busy, error, host }: {
  readonly t: Translate
  readonly target: WorktreeModalTarget
  readonly armed: boolean
  readonly busy: boolean
  readonly error?: string
  readonly host: HostCleanup
}): React.ReactElement {
  useEscapeClose()
  return (
    <div
      className="dshx-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}
      data-dshx-modal="delete"
    >
      <div className="dshx-modal" role="dialog" aria-modal="true" aria-label={t('delete.confirm.title')}>
        <div className="dshx-modalTitle">{t('delete.confirm.title')}</div>
        <div className="dshx-modalBody">
          <div className="dshx-factLine">{t('delete.confirm.body', { branch: target.branch })}</div>
          {target.dirty && <div className="dshx-error" data-dshx-dirty>{t('delete.confirm.dirty')}</div>}
          {error !== undefined && <div className="dshx-error" data-dshx-error>{error}</div>}
        </div>
        <div className="dshx-modalActions">
          <button type="button" className="dshx-buttonGhost" disabled={busy} onClick={closeModal} data-dshx-button="cancel">
            {t('delete.confirm.cancel')}
          </button>
          <button
            type="button"
            className={armed ? 'dshx-buttonDanger' : 'dshx-buttonGhost'}
            disabled={busy}
            onClick={() => { if (armed) { void executeDelete(rpc, host).then(() => requestTopologyRefresh()) } else armDelete() }}
            data-dshx-button={armed ? 'remove-armed' : 'remove'}
          >
            {armed ? (target.dirty ? t('delete.confirm.force') : t('delete.confirm.ok')) : t('delete.confirm.force')}
          </button>
        </div>
      </div>
    </div>
  )
}
