import * as React from 'react'
import { Button, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../dictionaries.ts'
import classes from '../panel.module.css'

/** The guard's state: the crash it caught, or none. */
interface PanelBoundaryState {
  readonly error: Error | null
}

/**
 * A crash guard for one subtree of this plugin.
 *
 * The slot runtime retires a registration that lets a render error escape:
 * the abdication is one-shot and final, the cell goes empty, and the tab stays
 * blank for the rest of the page's life while its chip keeps working. Every
 * crash therefore has to stay inside this plugin. The fallback is a render
 * function rather than an element because it reports what happened.
 *
 * `resetKey` clears a caught error when the surrounding content changes, so a
 * transient failure — a tab record not yet committed, say — heals on the next
 * meaningful render instead of pinning the fallback until a reload.
 */
export class PanelBoundary extends React.Component<
  {
    readonly renderFallback: (error: Error) => React.ReactNode
    readonly resetKey?: unknown
    readonly children: React.ReactNode
  },
  PanelBoundaryState
> {
  state: PanelBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PanelBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error): void {
    // The fallback names the failure for the user; the console keeps the stack.
    console.error('[dsh-next-git] panel render failed', error)
  }

  componentDidUpdate(previous: { readonly resetKey?: unknown }): void {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render(): React.ReactNode {
    const { error } = this.state
    return error === null ? this.props.children : this.props.renderFallback(error)
  }
}

/**
 * The panel's face when a render failed: what happened, and a way back.
 *
 * Showing the message here is deliberate — a silent blank pane is what this
 * whole guard exists to prevent, and the message is what makes the failure
 * reportable.
 */
export function PanelCrashed(props: {
  t: Translate
  error: Error
  onRetry: () => void
}): React.ReactElement {
  const detail = props.error.message.trim()
  return (
    <div className={classes.root} data-dsh-git="panel">
      <div className={classes.body} data-dsh-git="body">
        <div className={classes.banner} data-dsh-git="crashed">
          <div className={`${classes.bannerTitle} ${classes.bannerError}`}>
            <IconWarningOutlineRegular size={16} />
            <span>{props.t('state.renderFailed')}</span>
          </div>
          <div className={classes.bannerBody}>{props.t('state.renderFailedFix')}</div>
          {detail === '' ? null : <pre className={classes.hookOutput}>{detail}</pre>}
          <div className={classes.bannerActions}>
            <Button size="sm" variant="primary" onClick={props.onRetry}>
              {props.t('state.retry')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The panel's face when the seat handed it no session to read.
 *
 * A registered seat that renders nothing leaves an empty pane, so this state
 * still says what is happening rather than looking like a broken panel.
 */
export function GitPanelUnavailable(props: { t: Translate }): React.ReactElement {
  return (
    <div className={classes.root} data-dsh-git="panel">
      <div className={classes.body} data-dsh-git="body">
        <div className={classes.banner} data-dsh-git="no-session">
          <div className={`${classes.bannerTitle} ${classes.bannerWarn}`}>
            <IconWarningOutlineRegular size={16} />
            <span>{props.t('state.noSession')}</span>
          </div>
          <div className={classes.bannerBody}>{props.t('state.noSessionFix')}</div>
        </div>
      </div>
    </div>
  )
}
