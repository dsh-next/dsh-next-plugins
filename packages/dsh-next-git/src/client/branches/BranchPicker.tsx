/**
 * The checkout picker behind the header's branch chip.
 *
 * Clicking the chip opens this instead of a dropdown: one field that filters
 * every ref, the three quick actions the VS Code picker offers, and rows that
 * carry the tip commit's author, hash, subject and age. Picking a branch
 * switches, picking a remote-tracking branch checks out its local twin, and
 * picking a tag detaches — the same rules the panel applies everywhere else.
 *
 * Creating a branch is a two-step pick in the same card (base, then name),
 * which keeps the flow in one place instead of stacking dialogs.
 */

import * as React from 'react'
import { Button, IconBranchOutlineRegular, IconPlusOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { hasLocalBranch, filterRefs, partitionRefs, refOptions, type RefOption } from '../../core/refs.ts'
import { validateBranchName, type BranchNameIssue } from '../../core/branches.ts'
import type { RefSummary } from '../../core/types.ts'
import type { MessageKey } from '../dictionaries.ts'
import type { Translate } from '../GitPanel.tsx'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import { RefQuickPick, type RefAction } from './RefQuickPick.tsx'
import classes from './refs.module.css'

/** Which list the card is showing. */
type Step = 'browse' | 'base' | 'detach' | 'create'

export interface BranchPickerProps {
  /**
   * The checkout and its refs. The panel passes its whole state, the composer
   * chip its own smaller summary; the picker only reads the head and the lists.
   */
  readonly state: RefSummary
  readonly t: Translate
  /**
   * A switch or checkout the host refused, reported by the owner that ran it.
   * Shown under the list, so the card stays open on the ref that failed.
   */
  readonly error?: string | null
  /** Open straight into the detached list (the repository's Checkout command). */
  readonly startAt?: 'browse' | 'detach'
  /** Check out a branch or remote-tracking branch; the panel confirms a dirty tree. */
  readonly onSwitch: (option: RefOption) => void
  /** Check out a ref with a detached HEAD; the panel confirms first. */
  readonly onDetached: (option: RefOption) => void
  /**
   * Create a branch from `from` (null = the current HEAD) and check it out.
   *
   * @returns the failure text to show in the card, or null when it worked.
   */
  readonly onCreate: (name: string, from: string | null) => Promise<string | null>
  readonly onClose: () => void
}

/** The detached-HEAD glyph: a commit dot that is not attached to a branch. */
function DetachedGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 8h4M10 8h4" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  )
}

/** The name issue to show, or null when the name can be created. */
function nameIssue(name: string, taken: boolean): BranchNameIssue | null {
  const issue = validateBranchName(name)
  if (issue !== null) return issue
  if (taken) return 'existing'
  return null
}

export function BranchPicker(props: BranchPickerProps): React.ReactElement {
  const { state, t } = props
  const detachedOnly = props.startAt === 'detach'
  const [step, setStep] = React.useState<Step>(detachedOnly ? 'detach' : 'browse')
  const [query, setQuery] = React.useState('')
  const [base, setBase] = React.useState<RefOption | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const all = refOptions(state.branches, state.tags)
  const groups = partitionRefs(filterRefs(all, query))
  const current = state.head.branch
  const selectedId = current === null ? null : `branch:${current}`
  const trimmed = query.trim()
  const taken = hasLocalBranch(all, trimmed)
  // An untouched field is not an error yet: the issue text waits for a name.
  const issue = trimmed === '' ? null : nameIssue(trimmed, taken)
  const unborn = state.head.unborn
  const canCreate = trimmed !== '' && issue === null && !pending
  const emptyLabel = trimmed === '' ? t('picker.empty') : t('picker.noMatch')

  const actions: RefAction[] = React.useMemo(() => {
    if (step !== 'browse') return []
    if (trimmed === '') {
      return [
        { id: 'create', label: t('picker.create'), icon: <IconPlusOutlineRegular size={14} />, disabled: unborn },
        { id: 'create-from', label: t('picker.createFrom'), icon: <IconBranchOutlineRegular size={14} />, disabled: unborn },
        { id: 'detach', label: t('picker.detached'), icon: <DetachedGlyph /> },
      ]
    }
    // A typed name that no branch uses becomes the create row, the way VS Code
    // offers "Create new branch <query>" while you type.
    return issue === null
      ? [{ id: 'create-query', label: t('picker.createNamed', { name: trimmed }), icon: <IconPlusOutlineRegular size={14} /> }]
      : []
  }, [step, trimmed, issue, unborn, t])

  const pick = (option: RefOption): void => {
    if (option.current) {
      props.onClose()
      return
    }
    if (option.kind === 'tag') {
      props.onDetached(option)
      return
    }
    props.onSwitch(option)
  }

  /**
   * A detached pick checks out whatever ref was chosen: only the branch that
   * is already HEAD is a no-op, since detaching there changes nothing.
   */
  const pickDetached = (option: RefOption): void => {
    if (option.kind === 'branch' && option.current) {
      props.onClose()
      return
    }
    props.onDetached(option)
  }

  const onAction = (id: string): void => {
    if (id === 'detach') setStep('detach')
    else if (id === 'create-from') setStep('base')
    else if (id === 'create' || id === 'create-query') {
      setBase(null)
      setStep('create')
    }
  }

  const submit = async (): Promise<void> => {
    if (!canCreate) return
    setPending(true)
    setError(null)
    const failure = await props.onCreate(trimmed, base === null ? null : base.oid)
    setPending(false)
    if (failure === null) props.onClose()
    else setError(failure)
  }

  if (step === 'create') return <CreateStep {...props} name={query} onName={setQuery} base={base}
    issue={issue} error={error} pending={pending} canCreate={canCreate} onSubmit={() => void submit()}
    onBack={() => { setError(null); setStep(base === null ? 'browse' : 'base') }} />

  if (step === 'base') return <RefQuickPick marker="ref-picker" title={t('picker.baseTitle')}
    placeholder={t('picker.basePlaceholder')} groups={groups} query={query} onQuery={setQuery}
    emptyLabel={emptyLabel} selectedId={selectedId} t={t} onClose={props.onClose} error={props.error ?? null}
    onBack={() => { setQuery(''); setStep('browse') }}
    onPick={(option) => { setBase(option); setStep('create') }} />

  if (step === 'detach') return <RefQuickPick marker="ref-picker" title={t('picker.detachTitle')}
    placeholder={t('picker.detachPlaceholder')} groups={groups} query={query} onQuery={setQuery}
    emptyLabel={emptyLabel} selectedId={selectedId} t={t} onClose={props.onClose} error={props.error ?? null}
    {...(detachedOnly ? {} : { onBack: () => { setQuery(''); setStep('browse') } })}
    footer={<p className={classes.hint}>{t('picker.detachHint')}</p>}
    onPick={pickDetached} />

  return <RefQuickPick marker="ref-picker" title={t('picker.title')} placeholder={t('picker.placeholder')}
    groups={groups} actions={actions} query={query} onQuery={setQuery} selectedId={selectedId} t={t}
    emptyLabel={emptyLabel} error={props.error ?? null}
    onClose={props.onClose} onPick={pick} onAction={onAction} />
}

/** The second step: name the branch, showing the base it starts from. */
function CreateStep(props: BranchPickerProps & {
  readonly name: string
  readonly onName: (name: string) => void
  readonly base: RefOption | null
  readonly issue: BranchNameIssue | null
  readonly error: string | null
  readonly pending: boolean
  readonly canCreate: boolean
  readonly onSubmit: () => void
  readonly onBack: () => void
}): React.ReactElement {
  const { t, name, base } = props
  const body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)
  const from = base === null ? props.state.head.branch ?? 'HEAD' : base.name
  return (
    <Modal open headless title={t('picker.createTitle')} onClose={props.onClose} className={classes.card}>
      <div ref={body} className={classes.step} data-dsh-git="branch-create">
        <label className={classes.stepField}>
          <span>{t('picker.nameLabel')}</span>
          <input
            data-dsh-git="branch-name"
            autoFocus
            value={name}
            spellCheck={false}
            aria-label={t('picker.nameLabel')}
            placeholder={t('branches.createPlaceholder')}
            onChange={(event) => props.onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              props.onSubmit()
            }}
          />
        </label>
        <p className={classes.hint}>{t('picker.base', { ref: from })}</p>
        {props.issue === null ? null : <p className={classes.hint} data-dsh-git="branch-issue">{t(`issue.branch.${props.issue}` as MessageKey)}</p>}
        {props.error === null ? null : <p className={classes.error} role="alert">{props.error}</p>}
        {props.pending ? <p className={classes.hint} role="status">{t('repository.working')}</p> : null}
        <div className={classes.stepActions}>
          <Button variant="ghost" data-dsh-git="branch-create-back" onClick={props.onBack}>{t('picker.back')}</Button>
          <Button variant="primary" data-dsh-git="branch-create-submit" disabled={!props.canCreate} onClick={props.onSubmit}>
            {t('picker.createAction')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
