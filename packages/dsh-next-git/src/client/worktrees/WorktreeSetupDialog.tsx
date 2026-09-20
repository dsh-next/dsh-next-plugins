import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeSetupPreview } from '../../core/worktree-create.ts'
import type { Translate } from '../GitPanel.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './worktree-setup.module.css'

export interface WorktreeSetupDialogProps {
  preview: WorktreeSetupPreview
  t: Translate
  busy: boolean
  onCancel(): void
  onConfirm(approval: { readonly setupApproved: boolean; readonly copyApproved: boolean }): void
}

/**
 * The create confirmation for a repository that declares create-time work.
 *
 * Both consents start unchecked and are never inferred: running a repository's
 * commands executes project code with the user's account, and copying local
 * files can move secrets into a folder the agent reads. The dialog shows the
 * exact commands, paths, and base commit the approvals apply to; the host
 * rechecks the same definition before it acts.
 */
export function WorktreeSetupDialog(props: WorktreeSetupDialogProps): React.ReactElement {
  const { preview, t, busy } = props
  const [setupApproved, setSetupApproved] = React.useState(false)
  const [copyApproved, setCopyApproved] = React.useState(false)
  const body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)

  return (
    <Modal
      open
      title={t('worktrees.setupTitle')}
      onClose={props.onCancel}
      closeLabel={t('confirm.cancel')}
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={props.onCancel}>{t('confirm.cancel')}</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => props.onConfirm({ setupApproved, copyApproved })}
        >
          {busy ? t('busy.worktree-create') : t('worktrees.setupConfirm')}
        </Button>
      </>}
    >
      <div ref={body} className={classes.body} data-dsh-git="worktree-setup">
        <p>{t('worktrees.setupBody')}</p>
        <dl className={classes.context}>
          <dt>{t('worktrees.setupLocation')}</dt>
          <dd>{preview.path}</dd>
          <dt>{t('worktrees.setupBase')}</dt>
          <dd>{preview.base + ' ' + preview.baseOid.slice(0, 12)}</dd>
        </dl>
        {preview.steps.length > 0 ? (
          <fieldset className={classes.choice} disabled={busy}>
            <label>
              <input
                type="checkbox"
                checked={setupApproved}
                disabled={busy}
                onChange={(event) => setSetupApproved(event.target.checked)}
              />
              {t('worktrees.setupApprove', { count: preview.steps.length })}
            </label>
            <div className={classes.caption}>{t('worktrees.setupCommands')}</div>
            <pre className={classes.list}>
              {preview.steps.map((step, index) => (
                <span key={index}>{step.kind === 'command' ? step.command : 'sh ' + step.path}{'\n'}</span>
              ))}
            </pre>
          </fieldset>
        ) : null}
        {preview.includePaths.length > 0 ? (
          <fieldset className={classes.choice} disabled={busy}>
            <label>
              <input
                type="checkbox"
                checked={copyApproved}
                disabled={busy}
                onChange={(event) => setCopyApproved(event.target.checked)}
              />
              {t('worktrees.setupCopy', { count: preview.includePaths.length })}
            </label>
            <div className={classes.caption}>{t('worktrees.setupPaths')}</div>
            <ul className={classes.paths}>
              {preview.includePaths.map((path) => <li key={path}>{path}</li>)}
            </ul>
          </fieldset>
        ) : null}
        {preview.steps.length === 0 && preview.includePaths.length === 0
          ? <p className={classes.hint}>{t('worktrees.setupNone')}</p>
          : <p className={classes.hint}>{t('worktrees.setupSkippedHint')}</p>}
      </div>
    </Modal>
  )
}
