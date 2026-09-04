/**
 * The plugin's modal surface: a body-level React root owning the create
 * modal (merge and delete modals join it later). Rendered outside the
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
  closeModal,
  modalState,
  runCreateFlow,
  setCreateName,
  subscribeModal,
  type CreateModalState,
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

/** The root: renders the active modal, or nothing. */
export function ModalHost(props: ModalHostProps): React.ReactElement | null {
  const state = React.useSyncExternalStore(subscribeModal, modalState, modalState)
  if (state.kind === 'create' && state.create.open) {
    return <CreateModal {...props} state={state.create} />
  }
  return null
}

function CreateModal(
  { state, t, workspaces, sessions }: ModalHostProps & { state: CreateModalState },
): React.ReactElement {
  const nameRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (state.busy) return
    void runCreateFlow({ state, rpc, workspaces, sessions, onTopologyRefresh: requestTopologyRefresh })
  }

  return (
    <div
      className="dshx-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}
      data-dshx-modal="create"
    >
      <form
        className="dshx-modal"
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-label={t('create.title', { repo: state.repoLabel })}
      >
        <div className="dshx-modalTitle">{t('create.title', { repo: state.repoLabel })}</div>
        <label className="dshx-field">
          <span className="dshx-fieldLabel">{t('create.nameLabel')}</span>
          <input
            ref={nameRef}
            className="dshx-input"
            value={state.name}
            disabled={state.busy}
            onChange={(event) => { setCreateName(event.target.value) }}
            data-dshx-input="name"
          />
          <span className="dshx-fieldHint">{t('create.nameHint')}</span>
        </label>
        {state.error !== undefined && (
          <div className="dshx-error" data-dshx-error>{state.error}</div>
        )}
        <div className="dshx-modalActions">
          <button
            type="button"
            className="dshx-buttonGhost"
            disabled={state.busy}
            onClick={closeModal}
            data-dshx-button="cancel"
          >
            {t('create.cancel')}
          </button>
          <button
            type="submit"
            className="dshx-buttonPrimary"
            disabled={state.busy}
            data-dshx-button="confirm"
          >
            {t('create.confirm')}
          </button>
        </div>
      </form>
    </div>
  )
}
