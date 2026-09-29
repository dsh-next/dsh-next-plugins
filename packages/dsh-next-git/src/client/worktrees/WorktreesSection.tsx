import * as React from 'react'
import { Button, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconFolderOpenRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular, Menu, Tag, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { filterRefs, partitionRefs, refOptions, type RefOption } from '../../core/refs.ts'
import type { PanelState, WorktreeInfo } from '../../core/types.ts'
import { normalizeSlug, validateSlug } from '../../core/worktree.ts'
import { setupHasEffects, type WorktreeSetupPreview } from '../../core/worktree-create.ts'
import { PanelStore, type WorktreeCreateRequest } from '../controller.ts'
import type { MessageKey, Translate } from '../dictionaries.ts'
import { RefQuickPick } from '../branches/RefQuickPick.tsx'
import { IconTooltip } from '../ui/IconTooltip.tsx'
import { Section } from '../ui/Section.tsx'
import { baseName } from '../ui/path-label.ts'
import { WorktreeSetupDialog } from './WorktreeSetupDialog.tsx'
import classes from '../panel.module.css'
import worktreeClasses from './worktrees.module.css'

/** Two branches converging into the current checkout, in the native icon weight. */
function MergeGlyph({ size = 14 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4.5v7M12 4.5v1.25c0 3.5-8 1.5-8 5.75" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <circle cx="4" cy="3" r="1.5" stroke="currentColor" />
      <circle cx="12" cy="3" r="1.5" stroke="currentColor" />
      <circle cx="4" cy="13" r="1.5" stroke="currentColor" />
    </svg>
  )
}

/** Where a new worktree starts: a fresh branch, or an existing ref. */
type WorktreeSource =
  | { readonly mode: 'new' }
  | { readonly mode: 'ref'; readonly ref: string; readonly refKind: 'branch' | 'remote' | 'tag' }

export function WorktreesSection(props: {
  state: PanelState
  t: Translate
  busy: boolean
  store: PanelStore
  collapsed: boolean
  onToggle: () => void
  onDelete: (worktree: WorktreeInfo) => void
  onMerge: (worktree: WorktreeInfo) => void
  onUpdate: (worktree: WorktreeInfo, base?: string) => void
  openWorktreeSession?: ((path: string) => Promise<void>) | undefined
  registerCreatedWorktree?: ((path: string) => Promise<void>) | undefined
}): React.ReactElement {
  const { state, t, busy, store, onDelete } = props
  const [name, setName] = React.useState('')
  const [issue, setIssue] = React.useState<string | null>(null)
  const [source, setSource] = React.useState<WorktreeSource>({ mode: 'new' })
  const [sourceOpen, setSourceOpen] = React.useState(false)
  const [sourceQuery, setSourceQuery] = React.useState('')
  const [baseOpen, setBaseOpen] = React.useState(false)
  const [confirm, setConfirm] = React.useState<{ request: WorktreeCreateRequest; preview: WorktreeSetupPreview } | null>(null)
  const base = state.worktreeBase
  const baseRef = base.name
  const current = state.head.branch ?? 'HEAD'
  const prunable = state.worktrees.filter((worktree) => worktree.prunable).length

  // One create path for the button and the field's Enter key: a new branch is
  // slugged and validated here, a picked ref is checked out as it is. The host
  // is always asked what the repository declares before anything runs, so a
  // project that ships setup work gets an explicit decision and a project that
  // ships none creates in the same click.
  const finishCreate = async (created: boolean, path: string): Promise<void> => {
    if (!created) return
    setSource({ mode: 'new' })
    setName('')
    try { await props.registerCreatedWorktree?.(path) }
    catch { setIssue(t('worktrees.registerFailed')) }
  }
  const startCreate = (request: WorktreeCreateRequest): void => {
    setIssue(null)
    void store.worktreeSetup(request).then((preview) => {
      if (preview === null) return
      if (!setupHasEffects(preview)) {
        void store
          .worktreeAdd({ ...request, expectedSetupVersion: preview.version })
          .then(created => finishCreate(created, preview.path))
        return
      }
      setConfirm({ request, preview })
    })
  }
  const create = (): void => {
    if (source.mode === 'ref') {
      startCreate({ mode: 'ref', ref: source.ref, refKind: source.refKind })
      return
    }
    const verdict = validateSlug(normalizeSlug(name))
    if (!verdict.ok) {
      setIssue(t(`issue.slug.${verdict.issue}` as MessageKey))
      return
    }
    startCreate({ mode: 'new', name: verdict.slug, ...(baseRef === null ? {} : { base: baseRef }) })
  }

  // The start point: a fresh branch from the comparison base, or any existing
  // local branch, remote branch or tag (a tag checks out detached). It is the
  // same picker the header's chip opens, so a branch reads the same here.
  const sourceGroups = partitionRefs(filterRefs(refOptions(state.branches, state.tags), sourceQuery))

  // The comparison base: every row's ahead/behind/merged column is measured
  // against it, so the choice is visible next to the list it changes.
  const baseItems: MenuEntry[] = [
    {
      id: 'default',
      label: t('worktrees.baseDefault'),
      ...(base.source === 'default-branch' ? { icon: <IconCheckOutlineRegular size={14} /> } : {}),
    },
    ...base.candidates.map((candidate): MenuEntry => ({
      id: candidate,
      label: candidate,
      ...(base.name === candidate ? { icon: <IconCheckOutlineRegular size={14} /> } : {}),
    })),
  ]

  /** Action row: start from a fresh branch off the comparison base. */
  const startFromNew = (): void => {
    setSourceOpen(false)
    setSourceQuery('')
    setIssue(null)
    setSource({ mode: 'new' })
  }

  /** Picked ref: check the worktree out at that branch, remote branch or tag. */
  const pickSource = (option: RefOption): void => {
    setSourceOpen(false)
    setSourceQuery('')
    setIssue(null)
    setSource({ mode: 'ref', ref: option.name, refKind: option.kind })
  }

  const pickBase = (id: string): void => {
    setBaseOpen(false)
    void store.setWorktreeBase(id === 'default' ? null : id)
  }

  return (
    <Section
      id="worktrees"
      title={t('worktrees.title')}
      count={state.worktrees.length}
      collapsed={props.collapsed}
      onToggle={props.onToggle}
    >
      {/* The create row owns the seat under the band: it is the section's one
          write, and it stays visible however long the list grows. */}
      <div className={`${worktreeClasses.formRow} ${worktreeClasses.formRowTop}`}>
        <input
          id="dsh-git-worktree-name"
          className={classes.input}
          placeholder={source.mode === 'new' ? t('worktrees.namePlaceholder') : t('worktrees.sourcePick')}
          aria-label={t('worktrees.namePlaceholder')}
          value={source.mode === 'new' ? name : source.ref}
          disabled={source.mode === 'ref'}
          data-dsh-git="worktree-name"
          onChange={(event) => {
            setName(event.target.value)
            setIssue(null)
          }}
          onKeyDown={(event) => {
            // Enter creates, unless it is confirming an IME composition.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) create()
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || (source.mode === 'new' && name.trim() === '')}
          onClick={() => create()}
        >
          {t('worktrees.create')}
        </Button>
      </div>
      {/* Where a new worktree starts, and what every row is measured against:
          both change what the list means, so both sit in the open. */}
      <div className={worktreeClasses.contextRow}>
        <button
          type="button"
          className={worktreeClasses.contextButton}
          data-dsh-git="worktree-source"
          aria-label={t('worktrees.source')}
          aria-haspopup="dialog"
          aria-expanded={sourceOpen}
          disabled={busy}
          onClick={() => setSourceOpen(true)}
        >
          <span className={worktreeClasses.contextButtonLabel}>
            {source.mode === 'new' ? t('worktrees.sourceNewShort') : source.ref}
          </span>
          <IconChevronDownOutlineRegular size={12} />
        </button>
        {sourceOpen ? (
          <RefQuickPick
            marker="ref-picker"
            title={t('worktrees.source')}
            placeholder={t('worktrees.sourcePick')}
            groups={sourceGroups}
            actions={[{
              id: 'new',
              label: t('worktrees.sourceNew', { branch: baseRef ?? t('worktrees.baseNone') }),
              icon: source.mode === 'new' ? <IconCheckOutlineRegular size={14} /> : <IconPlusOutlineRegular size={14} />,
            }]}
            query={sourceQuery}
            onQuery={setSourceQuery}
            selectedId={source.mode === 'ref' ? `${source.refKind}:${source.ref}` : null}
            emptyLabel={t('picker.empty')}
            t={t}
            onClose={() => { setSourceOpen(false); setSourceQuery('') }}
            onAction={startFromNew}
            onPick={pickSource}
          />
        ) : null}
        {base.name === null ? null : (
          <Menu
            open={baseOpen}
            anchor={
              <button
                type="button"
                className={worktreeClasses.contextButton}
                data-dsh-git="worktree-base"
                aria-label={t('worktrees.base')}
                disabled={busy}
                onClick={() => setBaseOpen(!baseOpen)}
              >
                <span className={worktreeClasses.contextButtonLabel}>
                  {t('worktrees.baseLabel', { branch: base.name })}
                </span>
                <IconChevronDownOutlineRegular size={12} />
              </button>
            }
            items={baseItems}
            onSelect={pickBase}
            onClose={() => setBaseOpen(false)}
            align="start"
            portal
          />
        )}
        {prunable === 0 ? null : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void store.worktreePrune()}>
            {t('worktrees.prune')}
          </Button>
        )}
      </div>
      {issue === null ? null : <div className={classes.issue}>{issue}</div>}
      <div className={classes.caption} data-dsh-git="worktrees-hint">
        {t('worktrees.openHint')}
      </div>
      {state.worktrees.length === 0 ? (
        <div className={classes.empty}>
          <span className={classes.emptyTitle}>{t('worktrees.empty')}</span>
          <span className={classes.emptyHint}>{t('worktrees.emptyHint')}</span>
        </div>
      ) : null}
      {state.worktrees.map((worktree) => {
        // The branch is the identity; the slug only names the folder.
        const label = worktree.branch ?? worktree.slug ?? t('worktrees.detached')
        const baseLabel = baseRef ?? current
        const meta = [
          worktree.clean ? t('worktrees.clean') : t('worktrees.dirty'),
          worktree.ahead > 0 ? t('worktrees.ahead', { count: worktree.ahead }) : null,
          worktree.behind > 0 ? t('worktrees.behind', { count: worktree.behind }) : null,
          worktree.merged && baseRef !== null ? t('worktrees.mergedInto', { branch: baseRef }) : null,
          worktree.locked
            ? worktree.lockedReason === null
              ? t('worktrees.locked')
              : t('worktrees.lockedReason', { reason: worktree.lockedReason })
            : null,
          worktree.prunable ? t('worktrees.prunable') : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')
        const canMerge = worktree.branch !== null && worktree.branch !== current
        return (
          <div key={worktree.path} className={`${classes.row} ${classes.rowStatic}`} data-dsh-git="worktree">
            <div className={classes.rowMain}>
              <div className={worktreeClasses.worktreeHeading}>
                <span className={`${classes.rowPath} ${worktreeClasses.headingPath}`} title={label}>
                  {label}
                  {worktree.primary ? (
                    <Tag tone="neutral" className={classes.badge}>
                      {t('worktrees.primary')}
                    </Tag>
                  ) : null}
                </span>
                {worktree.primary ? null : (
                  <div className={`${classes.rowActions} ${worktreeClasses.worktreeActions}`} data-dsh-git="worktree-actions">
                    {props.openWorktreeSession === undefined ? null : (
                      <IconTooltip label={t('worktrees.openSession')}>
                        <button
                          type="button"
                          className={classes.iconButton}
                          aria-label={t('worktrees.openSession')}
                          data-dsh-git="worktree-open-session"
                          disabled={busy}
                          onClick={() => {
                            setIssue(null)
                            void props.openWorktreeSession?.(worktree.path).catch(() => {
                              setIssue(t('worktrees.openFailed'))
                            })
                          }}
                        >
                          <IconFolderOpenRegular size={14} />
                        </button>
                      </IconTooltip>
                    )}
                    <IconTooltip label={t('worktrees.update', { branch: baseLabel })}>
                      <button
                        type="button"
                        className={classes.iconButton}
                        aria-label={t('worktrees.update', { branch: baseLabel })}
                        data-dsh-git="worktree-update"
                        disabled={busy}
                        onClick={() => props.onUpdate(worktree, baseRef ?? undefined)}
                      >
                        <IconRefreshOutlineRegular size={14} />
                      </button>
                    </IconTooltip>
                    {canMerge ? (
                      <IconTooltip label={t('worktrees.merge', { branch: current })}>
                        <button
                          type="button"
                          className={classes.iconButton}
                          aria-label={t('worktrees.merge', { branch: current })}
                          data-dsh-git="worktree-merge"
                          disabled={busy}
                          onClick={() => props.onMerge(worktree)}
                        >
                          <MergeGlyph />
                        </button>
                      </IconTooltip>
                    ) : null}
                    {worktree.locked ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void store.worktreeUnlock(worktree.path)}
                      >
                        {t('worktrees.unlock')}
                      </Button>
                    ) : null}
                    <IconTooltip label={t('worktrees.delete')}>
                      <button
                        type="button"
                        className={classes.iconButton}
                        aria-label={t('worktrees.delete')}
                        data-dsh-git="worktree-delete"
                        disabled={busy}
                        onClick={() => onDelete(worktree)}
                      >
                        <IconTrashOutlineRegular size={14} />
                      </button>
                    </IconTooltip>
                  </div>
                )}
              </div>
              <span className={worktreeClasses.worktreePath} title={worktree.path} data-dsh-git="worktree-path">
                {/* The primary checkout is the repository itself, so it shows the
                    folder name; linked worktrees show their path inside it. */}
                {worktree.primary
                  ? baseName(state.root)
                  : worktree.path.startsWith(`${state.root}/`)
                    ? worktree.path.slice(state.root.length + 1)
                    : worktree.path}
              </span>
              <span className={classes.rowMeta} data-dsh-git="worktree-meta">
                {meta}
              </span>
            </div>
          </div>
        )
      })}
      {confirm === null ? null : (
        <WorktreeSetupDialog
          preview={confirm.preview}
          t={t}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={(approval) => {
            const pending = confirm
            setConfirm(null)
            void store
              .worktreeAdd({
                ...pending.request,
                setupApproved: approval.setupApproved,
                copyApproved: approval.copyApproved,
                expectedSetupVersion: pending.preview.version,
              })
              .then(created => finishCreate(created, pending.preview.path))
          }}
        />
      )}
    </Section>
  )
}
