/**
 * The plugin's modal surface: a body-level React root owning the merge
 * delete, and create-name modals, plus a visually-hidden live region
 * while create is in flight (the repo-row icon spins via CSS). Rendered
 * outside the official browser's tree on purpose — the conversation and
 * the sidebar stay pure harness; our overlays live in our own root.
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
  setCreateName,
  submitCreate,
  subscribeModal,
  type HostCleanup,
  type MergePreflightFacts,
  type UpdateHandoff,
  type UpdatePreflightFacts,
  type WorktreeModalTarget,
} from './create-store.ts'
import type { MergeBlocker, MergeWarning } from '../core/merge.ts'
import type { UpdateBlocker } from '../core/update.ts'
import { validateFolderName } from '../core/slug.ts'
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
  'no-source-branch': 'merge.blocker.noSource',
  'old-git': 'merge.blocker.oldGit',
  'running-session': 'merge.blocker.running',
  conflict: 'merge.blocker.conflict',
  'already-merged': 'merge.blocker.alreadyMerged',
}

/** Locale key for Merge dirty-tree warnings (Merge stays enabled). */
export const WARNING_KEYS: Readonly<Record<MergeWarning, string>> = {
  'dirty-primary': 'merge.blocker.dirtyPrimary',
  'dirty-worktree': 'merge.blocker.dirtyWorktree',
}

/** Locale key for every update-preflight blocker the host can emit. */
export const UPDATE_BLOCKER_KEYS: Readonly<Record<UpdateBlocker, string>> = {
  'unknown-slug': 'update.blocker.unknownSlug',
  'no-target-branch': 'update.blocker.noTarget',
  'no-source-branch': 'update.blocker.noSource',
  'no-bound-session': 'update.blocker.noSession',
  'running-session': 'update.blocker.running',
  'in-progress': 'update.blocker.inProgress',
  'dirty-worktree': 'update.blocker.dirtyWorktree',
  'already-updated': 'update.blocker.alreadyUpdated',
}

/** Visible caption lines in `.dshx-dirtyList` before it scrolls. */
const DIRTY_LIST_VISIBLE = 6

function DirtyFiles({ t, files, kind }: {
  readonly t: Translate
  readonly files: readonly string[]
  readonly kind: 'dirty-primary' | 'dirty-worktree'
}): React.ReactElement | null {
  if (files.length === 0) return null
  return (
    <ul
      className="dshx-dirtyList"
      data-dshx-dirty-files={kind}
      aria-label={t('blocker.dirtyFiles')}
      tabIndex={files.length > DIRTY_LIST_VISIBLE ? 0 : undefined}
    >
      {files.map((file, index) => (
        <li key={`${index}:${file}`} className="dshx-dirtyFile" title={file}>{file}</li>
      ))}
    </ul>
  )
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
  const status = state.creating
    ? <CreatingStatus t={props.t} settingUp={state.settingUp !== undefined} />
    : null
  let modal: React.ReactElement | null = null
  if (state.kind === 'create' && state.create !== undefined) {
    modal = <CreateModal t={props.t} create={state.create} workspaces={props.workspaces} sessions={props.sessions} />
  } else if (state.kind === 'create-error' && state.createError !== undefined) {
    modal = (
      <CreateErrorModal
        t={props.t}
        message={state.createError}
        kind={state.createErrorKind === 'setup' ? 'setup' : 'create'}
        folder={state.createErrorFolder}
        worktreeTitle={state.createErrorTitle}
      />
    )
  } else if (props.workspaces !== undefined) {
    const host = hostCleanup(props.workspaces)
    if (state.kind === 'merge' && state.merge !== undefined) {
      modal = <MergeModal t={props.t} merge={state.merge} host={host} />
    } else if (state.kind === 'update' && state.update !== undefined) {
      modal = <UpdateModal t={props.t} update={state.update} sessions={props.sessions} />
    } else if (state.kind === 'delete' && state.delete !== undefined) {
      modal = (
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
  }
  if (status === null && modal === null) return null
  return (
    <>
      {status}
      {modal}
    </>
  )
}

function CreateModal({ t, create, workspaces, sessions }: {
  readonly t: Translate
  readonly create: {
    readonly cwd: string
    readonly repoLabel: string
    readonly suggestion: string
    readonly name: string
    readonly busy: boolean
  }
  readonly workspaces: WorkspacesServiceLike
  readonly sessions: SessionsServiceLike
}): React.ReactElement {
  useEscapeClose()
  const title = t('create.title', { repo: create.repoLabel })
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [create.busy])
  const parsed = validateFolderName(create.name)
  const canSubmit = !create.busy && parsed.ok
  const submit = (): void => {
    if (!canSubmit) return
    submitCreate({
      rpc,
      workspaces,
      sessions,
      onTopologyRefresh: requestTopologyRefresh,
    })
  }
  const errorKey = !parsed.ok && create.name.trim() !== ''
    ? (`create.nameError.${parsed.reason}` as const)
    : undefined
  return (
    <div
      className="dshx-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}
      data-dshx-modal="create"
    >
      <div className="dshx-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dshx-modalTitle">{title}</div>
        <div className="dshx-modalBody">
          <label className="dshx-field">
            <span className="dshx-fieldLabel">{t('create.name')}</span>
            <input
              ref={inputRef}
              className="dshx-input"
              value={create.name}
              disabled={create.busy}
              aria-invalid={errorKey !== undefined}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => { setCreateName(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
              data-dshx-create-name
            />
            {errorKey !== undefined
              ? <span className="dshx-fieldError" data-dshx-name-error={parsed.ok ? undefined : parsed.reason}>{t(errorKey)}</span>
              : <span className="dshx-fieldHint">{t('create.nameHint')}</span>}
          </label>
        </div>
        <div className="dshx-modalActions">
          <button type="button" className="dshx-buttonGhost" disabled={create.busy} onClick={closeModal} data-dshx-button="cancel">
            {t('create.cancel')}
          </button>
          <button
            type="button"
            className="dshx-buttonPrimary"
            disabled={!canSubmit}
            onClick={submit}
            data-dshx-button="create"
          >
            {t('create.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreatingStatus({ t, settingUp }: {
  readonly t: Translate
  readonly settingUp: boolean
}): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="dshx-srOnly"
      data-dshx-creating-status="true"
    >
      {settingUp ? t('create.settingUp') : t('create.working')}
    </div>
  )
}

function CreateErrorModal({ t, message, kind, folder, worktreeTitle }: {
  readonly t: Translate
  readonly message: string
  readonly kind: 'create' | 'setup'
  readonly folder?: string
  readonly worktreeTitle?: string
}): React.ReactElement {
  useEscapeClose()
  const title = kind === 'setup' ? t('create.setupFailed.title') : t('create.error.title')
  const hint = kind === 'setup' ? t('create.setupFailed.hint') : t('create.error.hint')
  return (
    <div
      className="dshx-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}
      data-dshx-modal="create-error"
      data-dshx-create-error={kind}
    >
      <div className="dshx-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dshx-modalTitle">{title}</div>
        <div className="dshx-modalBody">
          <div className="dshx-error" data-dshx-error>{message}</div>
          <div className="dshx-fieldHint">{hint}</div>
          {kind === 'setup' && folder !== undefined && folder !== ''
            && worktreeTitle !== undefined && worktreeTitle !== '' && worktreeTitle !== folder && (
            <div className="dshx-fieldHint" data-dshx-disk-folder={folder}>
              {t('create.setupFailed.disk', { folder, title: worktreeTitle })}
            </div>
          )}
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
            {preflight !== undefined && (preflight.warnings ?? []).length > 0 && (
              <div className="dshx-blockers" data-dshx-merge="warnings">
                {(preflight.warnings ?? []).map((code) => (
                  <div key={code} className="dshx-blocker">
                    <div className="dshx-warn" data-dshx-warning={code}>
                      {t(WARNING_KEYS[code], {
                        branch: code === 'dirty-primary'
                          ? (preflight.target ?? '')
                          : (preflight.source ?? ''),
                      })}
                    </div>
                    {code === 'dirty-primary' && (
                      <DirtyFiles t={t} kind={code} files={preflight.dirtyPrimary ?? []} />
                    )}
                    {code === 'dirty-worktree' && (
                      <DirtyFiles t={t} kind={code} files={preflight.dirtyWorktree ?? []} />
                    )}
                  </div>
                ))}
              </div>
            )}
            {preflight !== undefined && !preflight.green && (
              <div className="dshx-blockers" data-dshx-merge="blockers">
                {preflight.blockers.map((code) => (
                  <div key={code} className="dshx-blocker">
                    <div className="dshx-error" data-dshx-blocker={code}>
                      {t(BLOCKER_KEYS[code], code === 'old-git'
                        ? { command: preflight.manualCommand ?? '' }
                        : undefined)}
                    </div>
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
              {t('merge.resolve')}
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
  const title = inFlight
    ? t('update.inProgressTitle')
    : t('update.title', { branch: titleBranch })
  return (
    <div
      className="dshx-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}
      data-dshx-modal="update"
    >
      <div className="dshx-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dshx-modalTitle">{title}</div>
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
                <div key={code} className="dshx-blocker">
                  <div className="dshx-error" data-dshx-blocker={code}>
                    {t(UPDATE_BLOCKER_KEYS[code], code === 'dirty-worktree'
                      ? { branch: preflight.target ?? '' }
                      : undefined)}
                  </div>
                  {code === 'dirty-worktree' && (
                    <DirtyFiles t={t} kind={code} files={preflight.dirtyWorktree ?? []} />
                  )}
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
              {t('update.resolve')}
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
              {t(
                preflight?.wouldConflict === true ? 'update.resolve' : 'update.confirm',
                { branch: preflight?.source ?? '' },
              )}
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
