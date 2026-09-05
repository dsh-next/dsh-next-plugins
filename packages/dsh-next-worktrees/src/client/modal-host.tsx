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
  abortUpdate,
  armDelete,
  cleanupMerged,
  closeModal,
  executeDelete,
  executeMerge,
  executeUpdate,
  modalState,
  openUpdate,
  subscribeModal,
  type HostCleanup,
  type MergePreflightFacts,
  type UpdateHandoff,
  type UpdatePreflightFacts,
  type WorktreeModalTarget,
} from './create-store.ts'
import type { MergeBlocker } from '../core/merge.ts'
import type { UpdateBlocker } from '../core/update.ts'
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

/** Locale key for every merge-preflight blocker the host can emit. */
export const BLOCKER_KEYS: Readonly<Record<MergeBlocker, string>> = {
  'unknown-slug': 'merge.blocker.unknownSlug',
  'no-target-branch': 'merge.blocker.noTarget',
  'old-git': 'merge.blocker.oldGit',
  'dirty-primary': 'merge.blocker.dirtyPrimary',
  'dirty-worktree': 'merge.blocker.dirtyWorktree',
  conflict: 'merge.blocker.conflict',
  'already-merged': 'merge.blocker.alreadyMerged',
}

/** Locale key for every update-preflight blocker the host can emit. */
export const UPDATE_BLOCKER_KEYS: Readonly<Record<UpdateBlocker, string>> = {
  'unknown-slug': 'update.blocker.unknownSlug',
  'no-target-branch': 'update.blocker.noTarget',
  'no-bound-session': 'update.blocker.noSession',
  'running-session': 'update.blocker.running',
  'in-progress': 'update.blocker.inProgress',
  'dirty-worktree': 'update.blocker.dirtyWorktree',
  'already-updated': 'update.blocker.alreadyUpdated',
}

function handoffOf(sessions: SessionsServiceLike): UpdateHandoff {
  return {
    open: (sessionId) => { sessions.open(sessionId) },
    prompt: (sessionId, text) => {
      const binding = sessions.binding?.(sessionId)
      void binding?.session.prompt([{ type: 'text', text }], 'queue').catch(() => {})
    },
  }
}

/** The root: renders the active modal, or nothing. */
export function ModalHost(props: ModalHostProps): React.ReactElement | null {
  const state = React.useSyncExternalStore(subscribeModal, modalState, modalState)
  if (state.kind === 'create-error' && state.createError !== undefined) {
    return <CreateErrorModal t={props.t} message={state.createError} />
  }
  if (props.workspaces === undefined) return null
  const host = hostCleanup(props.workspaces)
  if (state.kind === 'merge' && state.merge !== undefined) {
    return <MergeModal t={props.t} merge={state.merge} host={host} />
  }
  if (state.kind === 'update' && state.update !== undefined) {
    return <UpdateModal t={props.t} update={state.update} sessions={props.sessions} />
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

function CreateErrorModal({ t, message }: {
  readonly t: Translate
  readonly message: string
}): React.ReactElement {
  useEscapeClose()
  return (
    <div
      className="dshx-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}
      data-dshx-modal="create-error"
    >
      <div className="dshx-modal" role="dialog" aria-modal="true" aria-label={t('create.error.title')}>
        <div className="dshx-modalTitle">{t('create.error.title')}</div>
        <div className="dshx-modalBody">
          <div className="dshx-error" data-dshx-error>{message}</div>
          <div className="dshx-fieldHint">{t('create.error.hint')}</div>
        </div>
        <div className="dshx-modalActions">
          <button
            type="button"
            className="dshx-buttonPrimary"
            onClick={closeModal}
            data-dshx-button="create-error-ok"
          >
            {t('create.error.ok')}
          </button>
        </div>
      </div>
    </div>
  )
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
                    {t(BLOCKER_KEYS[code], code === 'old-git'
                      ? { command: preflight.manualCommand ?? '' }
                      : code === 'conflict'
                        ? { branch: preflight.target ?? '' }
                        : undefined)}
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
          {merge.done === undefined && preflight !== undefined && preflight.blockers.includes('conflict') && (
            <button
              type="button"
              className="dshx-buttonPrimary"
              disabled={merge.busy}
              onClick={() => { openUpdate(merge.target, rpc) }}
              data-dshx-button="update-from-merge"
            >
              {t('row.update', { branch: preflight.target ?? '' })}
            </button>
          )}
          {merge.done === undefined && (preflight === undefined || !preflight.blockers.includes('conflict')) && (
            <button
              type="button"
              className="dshx-buttonPrimary"
              disabled={merge.busy || preflight === undefined || !preflight.green}
              onClick={() => { executeMerge(rpc) }}
              data-dshx-button="merge"
            >
              {t('merge.confirm')}
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

function UpdateModal({ t, update, sessions }: {
  readonly t: Translate
  readonly sessions: SessionsServiceLike
  readonly update: {
    readonly target: WorktreeModalTarget
    readonly preflight?: UpdatePreflightFacts
    readonly busy: boolean
    readonly done?: { source: string; conflict: boolean; sessionId: string }
    readonly error?: string
  }
}): React.ReactElement {
  useEscapeClose()
  React.useEffect(() => {
    if (update.done !== undefined) requestTopologyRefresh()
  }, [update.done])
  const preflight = update.preflight
  const inFlight = update.done?.conflict === true
    || (preflight !== undefined && preflight.inProgress)
  const source = update.done?.source ?? preflight?.source ?? ''
  const sessionId = update.done?.sessionId ?? preflight?.sessionId
  const titleBranch = source === '' ? update.target.branch : source
  const cleanDone = update.done !== undefined && !update.done.conflict
  return (
    <div
      className="dshx-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}
      data-dshx-modal="update"
    >
      <div className="dshx-modal" role="dialog" aria-modal="true" aria-label={t('update.title', { branch: titleBranch })}>
        <div className="dshx-modalTitle">{t('update.title', { branch: titleBranch })}</div>
        <div className="dshx-modalBody">
          {cleanDone && (
            <div className="dshx-doneTitle" data-dshx-update="done">
              {t('update.done', { source })}
            </div>
          )}
          {!cleanDone && inFlight && (
            <div className="dshx-factLine" data-dshx-update="handoff">{t('update.handoff')}</div>
          )}
          {!cleanDone && !inFlight && preflight !== undefined && preflight.source !== undefined && preflight.target !== undefined && (
            <div className="dshx-factLine" data-dshx-update="summary">
              {t('update.summary', { source: preflight.source, target: preflight.target })}
            </div>
          )}
          {!cleanDone && !inFlight && preflight !== undefined && preflight.green && (
            <div className="dshx-factLine" data-dshx-update="shape">
              {t(preflight.fastForward ? 'update.ff' : 'update.commit')}
            </div>
          )}
          {!cleanDone && !inFlight && preflight !== undefined && preflight.green && preflight.wouldConflict && (
            <div className="dshx-warn" data-dshx-update="would-conflict">{t('update.wouldConflict')}</div>
          )}
          {!cleanDone && !inFlight && preflight !== undefined && !preflight.green && (
            <div className="dshx-blockers" data-dshx-update="blockers">
              {preflight.blockers.map((code) => (
                <div key={code} className="dshx-error" data-dshx-blocker={code}>
                  {t(UPDATE_BLOCKER_KEYS[code])}
                </div>
              ))}
            </div>
          )}
          {preflight === undefined && update.error === undefined && !cleanDone && (
            <div className="dshx-fieldHint">{t('row.refresh')}</div>
          )}
          {update.error !== undefined && <div className="dshx-error" data-dshx-error>{update.error}</div>}
        </div>
        <div className="dshx-modalActions">
          {!cleanDone && !inFlight && (
            <button type="button" className="dshx-buttonGhost" disabled={update.busy} onClick={closeModal} data-dshx-button="cancel">
              {t('create.cancel')}
            </button>
          )}
          {inFlight && (
            <button
              type="button"
              className="dshx-buttonDanger"
              disabled={update.busy}
              onClick={() => { void abortUpdate(rpc).then(() => requestTopologyRefresh()) }}
              data-dshx-button="abort-update"
            >
              {t('update.abort')}
            </button>
          )}
          {inFlight && sessionId !== undefined && sessionId !== '' && (
            <button
              type="button"
              className="dshx-buttonPrimary"
              disabled={update.busy}
              onClick={() => { sessions.open(sessionId); closeModal(); requestTopologyRefresh() }}
              data-dshx-button="continue-update"
            >
              {t('update.continue')}
            </button>
          )}
          {!cleanDone && !inFlight && (
            <button
              type="button"
              className="dshx-buttonPrimary"
              disabled={update.busy || preflight === undefined || !preflight.green}
              onClick={() => {
                const prompt = t('update.prompt', { source: preflight?.source ?? '' })
                executeUpdate(rpc, handoffOf(sessions), prompt)
              }}
              data-dshx-button="update"
            >
              {t('update.confirm', { branch: preflight?.source ?? '' })}
            </button>
          )}
          {cleanDone && (
            <button
              type="button"
              className="dshx-buttonPrimary"
              disabled={update.busy}
              onClick={() => { closeModal(); requestTopologyRefresh() }}
              data-dshx-button="update-ok"
            >
              {t('update.ok')}
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
