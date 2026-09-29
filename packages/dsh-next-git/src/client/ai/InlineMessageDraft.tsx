import * as React from 'react'
import { IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconTooltip } from '../ui/IconTooltip.tsx'
import type { Translate } from '../dictionaries.ts'
import classes from '../history/history-message-ai.module.css'

export interface InlineMessageDraftProps {
  scope: string
  t: Translate
  disabled: boolean
  generate(signal: AbortSignal): Promise<string>
  onMessage(message: string): void
}

/** One click replaces the fields; obsolete or failed requests never touch them. */
export function InlineMessageDraft(props: InlineMessageDraftProps): React.ReactElement {
  return <Draft key={props.scope} {...props} />
}

function Draft(props: InlineMessageDraftProps): React.ReactElement {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(false)
  const pending = React.useRef<AbortController | null>(null)
  const latest = React.useRef(props)
  latest.current = props
  React.useEffect(() => () => { pending.current?.abort(); pending.current = null }, [])
  React.useEffect(() => {
    if (props.disabled) { pending.current?.abort(); pending.current = null; setBusy(false) }
  }, [props.disabled])
  const draft = async (): Promise<void> => {
    if (pending.current || props.disabled) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setError(false)
    try {
      const message = await props.generate(controller.signal)
      if (pending.current !== controller || controller.signal.aborted || latest.current.disabled) return
      if (typeof message !== 'string' || !message.trim()) throw new Error('empty-draft')
      latest.current.onMessage(message)
    } catch {
      if (pending.current === controller && !controller.signal.aborted) setError(true)
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false) }
    }
  }
  return <div className={classes.body} data-dsh-git="inline-message-ai">
    <IconTooltip label={props.t(busy ? 'busy.draft' : 'commit.draft')}>
      <button type="button" className={classes.trigger} aria-label={props.t('commit.draft')}
        data-dsh-git="draft-message" aria-busy={busy} disabled={props.disabled || busy} onClick={() => { void draft() }}>
        <IconSparkleRegular size={14} />
      </button>
    </IconTooltip>
    {busy && <span role="status">{props.t('busy.draft')}</span>}
    {error && <p role="alert" className={classes.error}>{props.t('drafting.failed')}</p>}
  </div>
}
