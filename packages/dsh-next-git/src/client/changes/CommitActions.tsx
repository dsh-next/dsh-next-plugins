import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { PanelStore, type PanelSnapshot } from '../controller.ts'
import type { Translate } from '../dictionaries.ts'
import { InlineMessageDraft } from '../ai/InlineMessageDraft.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './commit.module.css'

/** The commit chord's modifier name for this platform. */
export function commitModifier(): string {
  const platform = typeof navigator === 'undefined' ? '' : (navigator.platform ?? '')
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '\u2318' : 'Ctrl'
}

/**
 * The two working-tree writes, each behind its own dialog.
 *
 * They sit in the Changes section header beside the staging actions, so the
 * header's own buttons say what can be done to the index right now. Both act
 * on the index, so both need staged work, and a conflicted index is neither
 * committable nor stashable. The disabled tooltip carries that reason, which is
 * why no separate hint line is needed.
 */
export function CommitActions(props: {
  snapshot: PanelSnapshot
  t: Translate
  store: PanelStore
}): React.ReactElement | null {
  const { snapshot, t, store } = props
  const state = snapshot.state
  const [dialog, setDialog] = React.useState<'commit' | 'stash' | null>(null)
  if (state === null) return null
  const busy = snapshot.busy !== null
  const staged = state.changes.staged.filter((entry) => entry.unmerged === undefined).length
  const unstaged = state.changes.unstaged.filter((entry) => entry.unmerged === undefined).length
  const untracked = state.changes.untracked.length
  const ready = staged > 0 && !busy && state.changes.conflicts.length === 0
  const why = busy ? t('history.reason.busy')
    : staged === 0 ? (unstaged + untracked > 0 ? t('commit.nothingStagedButChanges') : t('commit.nothingStaged'))
      : t('commit.conflicts')

  return (
    <>
      <span className={classes.commitAction} data-dsh-git="commit">
        <Button
          size="sm"
          variant="ghost"
          disabled={!ready}
          title={ready ? t('commit.button') : why}
          data-dsh-git="commit-open"
          onClick={() => setDialog('commit')}
        >
          {t('commit.button')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!ready}
          title={ready ? t('stash.button') : why}
          data-dsh-git="stash-open"
          onClick={() => setDialog('stash')}
        >
          {t('stash.button')}
        </Button>
      </span>
      {dialog === 'commit' ? <CommitDialog snapshot={snapshot} t={t} store={store} onClose={() => setDialog(null)} /> : null}
      {dialog === 'stash' ? <StashDialog t={t} store={store} onClose={() => setDialog(null)} /> : null}
    </>
  )
}

function CommitDialog(props: {
  snapshot: PanelSnapshot
  t: Translate
  store: PanelStore
  onClose(): void
}): React.ReactElement {
  const { snapshot, t, store, onClose } = props
  const [applying, setApplying] = React.useState(false)
  const body = React.useRef<HTMLDivElement>(null)
  const messageId = React.useId()
  useDialogFocus(body)
  const state = snapshot.state
  const summary = snapshot.message.split('\n', 1)[0] ?? ''
  const busy = snapshot.busy !== null
  const unresolved = (state?.changes.conflicts.length ?? 0) > 0
  const staged = (state?.changes.staged ?? []).filter((entry) => entry.unmerged === undefined).length
  const canCommit = summary.trim() !== '' && staged > 0 && !busy && !unresolved
  const branch = state?.head.branch ?? 'HEAD'

  const submit = async (): Promise<void> => {
    if (!canCommit || applying) return
    setApplying(true)
    try {
      if (await store.commit(snapshot.message)) onClose()
    } finally {
      setApplying(false)
    }
  }

  return <Modal open title={t('commit.button')} closeLabel={t('confirm.cancel')} onClose={onClose}
    footer={<>
      <Button variant="ghost" disabled={applying} onClick={onClose}>{t('confirm.cancel')}</Button>
      <Button variant="primary" disabled={!canCommit || applying} data-dsh-git="commit-submit" onClick={() => { void submit() }}>
        {applying ? t('busy.commit') : t('commit.button')}
      </Button>
    </>}>
    <div ref={body} className={classes.dialogBody} data-dsh-git="commit-dialog">
      <label className={classes.fieldLabel} htmlFor={messageId}>{t('commit.message')}</label>
      <div className={classes.messageEditor}>
        <textarea id={messageId} className={`${classes.fieldInput} ${classes.fieldBody}`} data-dsh-git="commit-message"
          rows={7} value={snapshot.message} placeholder={t('commit.messagePlaceholder')} autoFocus
          onChange={event => store.setMessage(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }} />
        <InlineMessageDraft scope={JSON.stringify([store.sessionId, state?.root, state?.cwd, state?.head.oid])} t={t}
          disabled={busy || applying || unresolved || staged === 0} generate={signal => store.draftInput(signal)}
          onMessage={message => store.setMessage(message)} />
      </div>
      <p>{t('commit.chord', { mod: commitModifier(), branch })}</p>
    </div>
  </Modal>
}

function StashDialog(props: { t: Translate; store: PanelStore; onClose(): void }): React.ReactElement {
  const { t, store, onClose } = props
  const [name, setName] = React.useState('')
  const [applying, setApplying] = React.useState(false)
  const body = React.useRef<HTMLDivElement>(null)
  const nameId = React.useId()
  useDialogFocus(body)

  const submit = async (): Promise<void> => {
    if (applying) return
    setApplying(true)
    try {
      if (await store.stashSave(name)) onClose()
    } finally {
      setApplying(false)
    }
  }

  return <Modal open title={t('stash.button')} closeLabel={t('confirm.cancel')} onClose={onClose}
    footer={<>
      <Button variant="ghost" disabled={applying} onClick={onClose}>{t('confirm.cancel')}</Button>
      <Button variant="primary" disabled={applying} data-dsh-git="stash-submit" onClick={() => { void submit() }}>
        {applying ? t('busy.stash') : t('stash.button')}
      </Button>
    </>}>
    <div ref={body} className={classes.dialogBody} data-dsh-git="stash-dialog">
      <label className={classes.fieldLabel} htmlFor={nameId}>{t('stash.name')}</label>
      <input id={nameId} className={classes.fieldInput} data-dsh-git="stash-name" value={name}
        placeholder={t('stash.namePlaceholder')} autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }} />
      <p>{t('stash.hint')}</p>
    </div>
  </Modal>
}
