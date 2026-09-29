import * as React from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PanelSection } from '../controller.ts'
import classes from '../panel.module.css'

/**
 * One collapsible section: an accordion header (chevron, title, count, and the
 * section's own actions) over its body. The header is a real button, so the
 * sections answer the keyboard and expose `aria-expanded`; the actions sit
 * beside it rather than inside, because a button cannot nest in a button.
 */
export function Section(props: {
  id: PanelSection
  title: string
  count?: number | null
  collapsed: boolean
  onToggle: () => void
  actions?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}): React.ReactElement {
  const { id, title, count, collapsed, onToggle, actions, children } = props
  const bodyId = `dsh-git-section-${id}`
  return (
    <section className={props.className === undefined ? classes.section : `${classes.section} ${props.className}`} data-dsh-git={id}>
      <div className={classes.sectionHeader} onClick={event => {
        if (!(event.target as Element).closest('button')) onToggle()
      }}>
        <button
          type="button"
          className={classes.sectionToggle}
          data-dsh-git="section-toggle"
          data-section={id}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <IconChevronDownOutlineRegular
            size={12}
            className={collapsed ? classes.sectionChevronCollapsed : classes.sectionChevron}
          />
          <span className={classes.sectionTitle}>{title}</span>
        </button>
        <span className={classes.sectionSpacer} />
        {actions}
        {count === undefined || count === null ? null : (
          <span className={classes.sectionCount} data-dsh-git="section-count">
            {count}
          </span>
        )}
      </div>
      {collapsed ? null : (
        <div id={bodyId} className={props.bodyClassName} data-dsh-git="section-body" data-section={id}>
          {children}
        </div>
      )}
    </section>
  )
}
