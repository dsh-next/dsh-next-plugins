import * as React from 'react'
import { Button, IconWarningOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OperationKind } from '../../core/types.ts'
import { PanelStore, type PanelSnapshot } from '../controller.ts'
import type { MessageKey, Translate } from '../dictionaries.ts'
import { degradedFix, degradedTitle, failureFix, failureTitleKey } from './failure-copy.ts'
import classes from '../panel.module.css'

export function Notices(props: {
  snapshot: PanelSnapshot
  t: Translate
  store: PanelStore
  /** Ask for the danger confirmation that precedes a skipped step. */
  onSkip: (kind: OperationKind) => void
}): React.ReactElement | null {
  const { snapshot, t, store } = props
  const blocks: React.ReactElement[] = []

  if (snapshot.phase === 'degraded' && snapshot.degraded !== null) {
    const degraded = snapshot.degraded
    blocks.push(
      <div className={classes.banner} key="degraded" data-dsh-git="degraded">
        <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
          <IconWarningOutlineRegular size={16} />
          <span>{degradedTitle(degraded.code, degraded, t)}</span>
        </div>
        <div className={classes.bannerBody}>{degradedFix(degraded.code, degraded, t)}</div>
      </div>,
    )
  } else if (snapshot.failure !== null) {
    blocks.push(
      <div className={classes.banner} key="failure" data-dsh-git="failure">
        <div className={`${classes.bannerTitle} ${classes.bannerError}`}>
          <IconWarningOutlineRegular size={16} />
          <span>{t(failureTitleKey(snapshot.failure.code))}</span>
        </div>
        <div className={classes.bannerBody}>{failureFix(snapshot.failure.code, t)}</div>
        {snapshot.failure.detail === '' ? null : (
          <div className={classes.bannerBody}>{snapshot.failure.detail}</div>
        )}
      </div>,
    )
  }

  const operation = snapshot.state?.operation ?? null
  if (operation !== null && operation.kind !== null) {
    // Captured so the narrowing survives into the button callbacks below.
    const kind = operation.kind
    blocks.push(
      <div className={classes.banner} key="operation" data-dsh-git="operation">
        <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
          <StateDot state="warning" />
          <span>{t(`operation.${kind}` as MessageKey)}</span>
          {operation.step === null ? null : (
            <span className={classes.caption}>{t('operation.step', { step: operation.step })}</span>
          )}
        </div>
        {operation.conflicts.length === 0 ? null : (
          <div className={classes.bannerBody}>
            {t('operation.conflicts', { count: operation.conflicts.length })}
          </div>
        )}
        <div className={classes.bannerActions}>
          <Button size="sm" variant="primary" disabled={snapshot.busy !== null || operation.conflicts.length > 0} onClick={() => void store.operationContinue()}>
            {t('operation.continue')}
          </Button>
          {kind === 'merge' ? null : (
            <Button
              size="sm"
              variant="ghost"
              disabled={snapshot.busy !== null}
              data-dsh-git="operation-skip"
              onClick={() => props.onSkip(kind)}
            >
              {t('operation.skip')}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={snapshot.busy !== null} onClick={() => void store.operationAbort()}>
            {t('operation.abort')}
          </Button>
        </div>
      </div>,
    )
  }

  if (snapshot.busy === 'busy.commit') {
    blocks.push(
      <div className={classes.banner} key="commit-progress" data-dsh-git="commit-progress">
        <span>{t('busy.commit')}</span>
        <Button size="sm" variant="ghost" onClick={() => void store.cancelCommit()}>{t('hook.cancel')}</Button>
      </div>,
    )
  }

  if (snapshot.hook !== null) {
    blocks.push(
      <div className={classes.banner} key="hook" data-dsh-git="hook">
        <div className={`${classes.bannerTitle} ${classes.bannerError}`}>
          <IconWarningOutlineRegular size={16} />
          <span>{t('hook.title', { hook: snapshot.hook.hook })}</span>
          <span className={classes.caption}>{t('hook.exitCode', { code: snapshot.hook.exitCode })}</span>
        </div>
        <pre className={classes.hookOutput}>{snapshot.hook.output === '' ? t('hook.note') : snapshot.hook.output}</pre>
        <div className={classes.bannerActions}>
          <Button size="sm" variant="primary" onClick={() => void store.retryCommit()}>
            {t('hook.retry')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void store.cancelCommit()}>
            {t('hook.cancel')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => store.dismissHook()}>
            {t('hook.dismiss')}
          </Button>
        </div>
      </div>,
    )
  }

  if (snapshot.setup !== null) {
    blocks.push(
      <div className={classes.banner} key="setup" data-dsh-git="setup">
        <div className={classes.bannerTitle}>
          <span>
            {snapshot.setup.report.failed
              ? t('worktrees.setupFailed', { count: snapshot.setup.report.ran })
              : t('worktrees.setupRan', { count: snapshot.setup.report.ran })}
          </span>
        </div>
        {snapshot.setup.report.output === '' ? null : (
          <>
            <div className={classes.caption}>{t('worktrees.setupOutput')}</div>
            <pre className={classes.hookOutput}>{snapshot.setup.report.output}</pre>
          </>
        )}
      </div>,
    )
  }

  const identity = snapshot.state?.identity
  if (identity !== undefined && (identity.name === null || identity.email === null)) {
    blocks.push(
      <div className={classes.banner} key="identity" data-dsh-git="identity">
        <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
          <IconWarningOutlineRegular size={16} />
          <span>{t('header.identityMissing')}</span>
        </div>
        <div className={classes.bannerBody}>{t('header.identityFix')}</div>
      </div>,
    )
  }

  if (snapshot.notice !== null) {
    blocks.push(
      <div className={classes.banner} key="notice" data-dsh-git="notice">
        <div className={classes.bannerTitle}>
          <span>{t(snapshot.notice as MessageKey)}</span>
          <span className={classes.sectionSpacer} />
          <Button size="sm" variant="ghost" onClick={() => store.dismissNotice()}>
            {t('notice.dismiss')}
          </Button>
        </div>
      </div>,
    )
  }

  if (blocks.length === 0) return null
  return <>{blocks}</>
}
