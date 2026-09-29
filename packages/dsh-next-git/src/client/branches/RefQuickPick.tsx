/**
 * The ref quick pick: one search field over grouped branch / remote / tag rows.
 *
 * This is the panel's one ref chooser. The checkout picker
 * ({@link BranchPicker}) drives it, and so do the worktree start-point and
 * base-ref steps, so a branch looks the same wherever it is picked: glyph,
 * name, drift, age, and the tip commit's author, hash and subject. Rows are
 * `role="option"` and the field keeps focus, which is the combobox pattern
 * that lets one input filter and walk the list with the arrow keys.
 */

import * as React from 'react'
import {
  IconBranchOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RefGroup, RefKind, RefOption } from '../../core/refs.ts'
import type { Translate } from '../dictionaries.ts'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import { IconTooltip } from '../ui/IconTooltip.tsx'
import { refAge } from './ref-time.ts'
import classes from './refs.module.css'

/** One non-ref row above the list: "Create new branch…", "Checkout detached…". */
export interface RefAction {
  readonly id: string
  readonly label: string
  /** Muted trailing text (the base a branch would start from). */
  readonly hint?: string | undefined
  readonly icon?: React.ReactElement | undefined
  readonly disabled?: boolean | undefined
}

/** Which dictionary key names a section. */
const KIND_LABEL: Record<RefKind, 'picker.branches' | 'picker.remotes' | 'picker.tags'> = {
  branch: 'picker.branches',
  remote: 'picker.remotes',
  tag: 'picker.tags',
}

/** The glyph a row leads with. */
function RefGlyph({ kind, size = 14 }: { kind: RefKind; size?: number }): React.ReactElement {
  if (kind !== 'tag') return <IconBranchOutlineRegular size={size} />
  // A tag has no glyph in the platform set: the same 16x16 grid with a tag
  // outline, so a tag row still reads as a ref and not as a branch.
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 2.8h5.4a1 1 0 0 1 .7.3l5 5a1 1 0 0 1 0 1.4l-4.6 4.6a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1-.3-.7V2.8Z" />
      <circle cx="5.2" cy="5.2" r="1" />
    </svg>
  )
}

/** One row's second line: `<author> · <short hash> · <subject>`. */
function RefDetail({ option }: { readonly option: RefOption }): React.ReactElement | null {
  const parts: React.ReactNode[] = []
  if (option.author !== '') parts.push(<span key="author">{option.author}</span>)
  if (option.oid !== '') parts.push(<span key="hash">{option.oid.slice(0, 7)}</span>)
  if (option.subject !== '') parts.push(<span key="subject" className={classes.subject}>{option.subject}</span>)
  if (parts.length === 0) return null
  return (
    <span className={classes.detail}>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index === 0 ? null : <span className={classes.dot} aria-hidden="true">·</span>}
          {part}
        </React.Fragment>
      ))}
    </span>
  )
}

export interface RefQuickPickProps {
  /** Dialog name, read by assistive technology. */
  readonly title: string
  readonly placeholder: string
  /** Rows to show, in section order; already filtered by the owner. */
  readonly groups: readonly RefGroup[]
  readonly actions?: readonly RefAction[] | undefined
  /** Controlled filter text, so a later step can reuse what was typed. */
  readonly query: string
  readonly onQuery: (query: string) => void
  /**
   * The row the owner considers chosen, marked with a check. The current
   * branch is marked either way; the worktree start-point picker uses this to
   * show which ref the next checkout starts from.
   */
  readonly selectedId?: string | null
  readonly emptyLabel: string
  readonly error?: string | null
  /** Step-back control (a nested pick), shown before the field. */
  readonly onBack?: (() => void) | undefined
  /** Content under the list: a hint line, a form. */
  readonly footer?: React.ReactNode
  readonly onPick: (option: RefOption) => void
  readonly onAction?: ((id: string) => void) | undefined
  readonly onClose: () => void
  readonly t: Translate
  /** DOM marker root for the mounted picker (`ref-picker`, `branch-picker`). */
  readonly marker: string
}

export function RefQuickPick(props: RefQuickPickProps): React.ReactElement {
  const { groups, actions = [], query, t, marker } = props
  const body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)
  const options = React.useMemo(() => groups.flatMap((group) => group.refs), [groups])
  // A typed query replaces the quick actions with the "create this branch"
  // row the owner prepends, so the two never compete for the first slot.
  const rows = actions.length + options.length
  const [active, setActive] = React.useState(0)
  React.useEffect(() => { setActive(0) }, [query, rows])
  const activeRef = React.useRef(active)
  activeRef.current = active
  const rowRefs = React.useRef<(HTMLLIElement | null)[]>([])
  React.useEffect(() => {
    const row = rowRefs.current[active]
    if (row !== null && row !== undefined && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [active])

  const activate = (index: number): void => {
    const action = actions[index]
    if (action !== undefined) {
      if (action.disabled !== true) props.onAction?.(action.id)
      return
    }
    const option = options[index - actions.length]
    if (option !== undefined) props.onPick(option)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const last = rows - 1
    if (event.key === 'ArrowDown') setActive((index) => Math.min(index + 1, last))
    else if (event.key === 'ArrowUp') setActive((index) => Math.max(index - 1, 0))
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(Math.max(last, 0))
    else if (event.key === 'Enter') activate(activeRef.current)
    else return
    event.preventDefault()
  }

  const listId = `${marker}-list`
  let offset = actions.length

  return (
    <Modal open headless title={props.title} onClose={props.onClose} className={classes.card}>
      {/* One marker for the whole card: the field and the rows it drives. */}
      <div className={classes.picker} data-dsh-git={marker}>
        <div ref={body} className={classes.head}>
          {props.onBack === undefined ? null : (
            <IconTooltip label={t('picker.back')}>
              <button type="button" className={classes.back} data-dsh-git="ref-back" aria-label={t('picker.back')} onClick={props.onBack}>
                <IconChevronLeftOutlineRegular size={14} />
              </button>
            </IconTooltip>
          )}
          <Input
            className={classes.field}
            icon={<IconSearchOutlineRegular size={14} />}
            data-dsh-git="ref-filter"
            role="combobox"
            autoFocus
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={rows === 0 ? undefined : `${marker}-option-${active}`}
            aria-label={props.placeholder}
            placeholder={props.placeholder}
            value={query}
            onChange={(event) => props.onQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul className={classes.list} id={listId} role="listbox" aria-label={props.title}>
          {actions.map((action, index) => (
            <li
              key={action.id}
              id={`${marker}-option-${index}`}
              ref={(element) => { rowRefs.current[index] = element }}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              aria-disabled={action.disabled === true ? true : undefined}
              className={classes.action}
              data-dsh-git="ref-action"
              data-action={action.id}
              onMouseMove={() => setActive(index)}
              onClick={() => activate(index)}
            >
              <span className={classes.glyph}>{action.icon ?? null}</span>
              <span className={classes.actionLabel}>{action.label}</span>
              {action.hint === undefined ? null : <span className={classes.actionHint}>{action.hint}</span>}
            </li>
          ))}
          {groups.map((group) => {
            const base = offset
            offset += group.refs.length
            return group.refs.map((option, index) => {
              const absolute = base + index
              const age = refAge(option.committedAt, t)
              const drift = option.ahead > 0 || option.behind > 0
              // The current checkout is named for assistive technology; an
              // owner-chosen row is only ticked, since its meaning is local.
              const marked = option.current || option.id === props.selectedId
              return (
                <li
                  key={option.id}
                  id={`${marker}-option-${absolute}`}
                  ref={(element) => { rowRefs.current[absolute] = element }}
                  role="option"
                  tabIndex={-1}
                  aria-selected={absolute === active}
                  className={classes.row}
                  data-dsh-git="ref-row"
                  data-ref={option.id}
                  onMouseMove={() => setActive(absolute)}
                  onClick={() => activate(absolute)}
                >
                  <span className={classes.glyph}><RefGlyph kind={option.kind} /></span>
                  <span className={classes.main}>
                    <span className={classes.top}>
                      <span className={classes.name}>{option.name}</span>
                      {!marked ? null : option.current ? (
                        <IconTooltip label={t('picker.current')}>
                          <span className={classes.current} aria-label={t('picker.current')}>
                            <IconCheckOutlineRegular size={12} />
                          </span>
                        </IconTooltip>
                      ) : (
                        <span className={classes.current} aria-hidden="true">
                          <IconCheckOutlineRegular size={12} />
                        </span>
                      )}
                      {drift ? (
                        <span className={classes.meta}>
                          {option.ahead > 0 ? t('header.ahead', { count: option.ahead }) : null}
                          {option.behind > 0 ? t('header.behind', { count: option.behind }) : null}
                        </span>
                      ) : null}
                      {age === null ? null : <span className={classes.meta}>{age}</span>}
                      {index === 0 ? <span className={classes.kind}>{t(KIND_LABEL[group.kind])}</span> : null}
                    </span>
                    <RefDetail option={option} />
                  </span>
                </li>
              )
            })
          })}
        </ul>
        {rows === 0 ? <p className={classes.empty}>{props.emptyLabel}</p> : null}
        {props.error === null || props.error === undefined ? null : <p className={classes.error} role="alert">{props.error}</p>}
        {props.footer}
      </div>
    </Modal>
  )
}
