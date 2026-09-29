import * as React from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import classes from './icon-tooltip.module.css'

/** One tooltip grammar for Git's icon-only actions, including disabled ones. */
export function IconTooltip({ label, children }: {
  label: string
  children: React.ReactElement<{ disabled?: boolean }>
}): React.ReactElement {
  const disabled = children.props.disabled === true
  return (
    <Tooltip label={label} side="top" align="end" portal>
      <span className={classes.target} role={disabled ? 'note' : undefined} aria-label={disabled ? label : undefined}
        tabIndex={disabled ? 0 : undefined} onClick={event => event.stopPropagation()}>
        {children}
      </span>
    </Tooltip>
  )
}
