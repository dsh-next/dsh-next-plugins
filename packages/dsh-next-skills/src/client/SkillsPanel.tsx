/**
 * The Skills settings panel rendered in the `settings.section` slot — a whole
 * settings page over the Host JSON RPC, styled after the Claude Plugins page:
 *
 *  - Skills: every discovered skill (project, custom, and user roots) plus
 *    every provider catalog skill in one two-column card grid — rows that
 *    exist on disk first, each group alphabetical, with a provider filter, a
 *    search box, and an installed-only toggle. Each card opens the scope
 *    modal: a radio picks where the skill is enabled — Everywhere (the
 *    default) or only in a checklist of workspaces — and installing or
 *    saving applies that scope as pure configuration (enable/disable never
 *    writes skill files; skills install once, into the global root). A
 *    managed card with a newer catalog version carries an Update button, and
 *    the modal manages scope, updates, and removal (two-step confirm).
 *  - Providers: source management (add by owner/repo shorthand or GitHub
 *    URL, refresh all, remove) with per-source sync age and error rows.
 *
 * Providers, installed records, and scopes persist in the plugin's settings
 * namespace (the harness settings.yaml), so the configuration is readable
 * and shareable between developers; the name button opens the skill's full
 * SKILL.md rendered as markdown.
 *
 * Every user-facing string rides the `t` translator (the platform locale
 * service bound to this package's namespace; English without it). The
 * exported formatters take `t` as an optional last argument defaulting to
 * English, so their standalone behavior is unchanged.
 */
import * as React from 'react'
import type {
  CatalogSkillView,
  InstalledSkill,
  MutationResult,
  ProviderView,
  SkillDetail,
  SkillsState,
  WorkspaceRow,
} from '../core/types.ts'
import type { SkillScopeSetting } from '../core/settings.ts'
import styles from './card.module.css'
import { englishTranslate, type MessageKey } from './dictionaries.ts'
import { renderMarkdown } from './markdown.tsx'

/** Translates a dictionary key with `{name}` params (platform semantics). */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

export interface SkillsPanelDeps {
  rpc: (method: string, args?: unknown) => Promise<unknown>
  getWorkspaces: () => WorkspaceRow[]
  /** Signals the browser that the installed skill catalog changed. */
  notifyInstalledChanged?: () => void
  /** Locale-bound translator; defaults to English when omitted (tests). */
  t?: Translate
}

type Tab = 'skills' | 'providers'

/** Cards rendered before the "Show more" button appends the next page. */
const PAGE_SIZE = 30

/** Mutations whose success changes the skill set the chat UI surfaces. */
const CATALOG_MUTATIONS = new Set(['installSkill', 'setScope', 'updateSkill', 'remove', 'addProvider', 'removeProvider'])

function isMutationError(result: unknown): result is { ok: false; error: string } {
  return !!result && typeof result === 'object' && (result as { ok?: unknown }).ok === false
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `{count}` plural pick: one vs many key, count passed for interpolation. */
function countOf(t: Translate, n: number, one: MessageKey, many: MessageKey): string {
  return t(n === 1 ? one : many, { count: n })
}

/** Relative age of a provider's last sync, e.g. "3h ago" or "never". */
export function formatLastSync(iso: string, now: number = Date.now(), t: Translate = englishTranslate): string {
  if (iso === '') return t('providers.syncNever')
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return t('providers.syncNever')
  const diff = now - at
  if (diff < 60_000) return t('providers.justNow')
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return t('providers.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('providers.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('providers.daysAgo', { count: days })
  return iso.slice(0, 10)
}

/** The presence badge label for a row's config scope (undefined = default). */
export function presenceLabel(scope: SkillScopeSetting | undefined, t: Translate = englishTranslate): string {
  if (scope === undefined || scope.kind === 'global') return t('presence.everywhere')
  if (scope.workspacePaths.length === 0) return t('presence.off')
  return countOf(t, scope.workspacePaths.length, 'presence.workspaces.one', 'presence.workspaces.many')
}

/** One card in the skills grid: a discovered row, a catalog skill, or both. */
export interface GridEntry {
  key: string
  name: string
  description: string
  whenToUse?: string
  /** The catalog skill backing this entry (Add flow), when offered. */
  catalog?: CatalogSkillView
  /** The discovered on-disk skill (Manage flow), when present. */
  row?: InstalledSkill
  /** Catalog provider id (the provider filter compares ids). */
  providerId?: string
  /** Provider spec label (`owner/repo`), when provider-installed. */
  providerSpec?: string
}

/**
 * Merge the discovered rows and the provider catalog into grid entries:
 * rows first (each group alphabetical by name, provider spec as tie-break).
 */
export function buildGridEntries(state: SkillsState): GridEntry[] {
  const byName = new Map(state.installed.map((r) => [r.name, r]))
  const byCatalogName = new Map(state.catalog.map((s) => [s.name, s]))
  const compare = (a: GridEntry, b: GridEntry): number =>
    a.name.localeCompare(b.name) || (a.providerSpec ?? '').localeCompare(b.providerSpec ?? '')
  const rows: GridEntry[] = state.installed.map((row) => {
    const catalog = byCatalogName.get(row.name)
    return {
      key: `row:${row.name}`,
      name: row.name,
      description: row.description,
      ...(row.whenToUse !== undefined ? { whenToUse: row.whenToUse } : {}),
      row,
      ...(catalog !== undefined ? { catalog } : {}),
      ...(catalog !== undefined ? { providerId: catalog.providerId } : {}),
      ...(row.provider !== undefined || catalog !== undefined
        ? { providerSpec: row.provider ?? catalog?.providerSpec }
        : {}),
    }
  })
  const catalogOnly: GridEntry[] = state.catalog
    .filter((s) => !byName.has(s.name))
    .map((s) => ({
      key: `cat:${s.providerId}/${s.skillPath}`,
      name: s.name,
      description: s.description,
      ...(s.whenToUse !== undefined ? { whenToUse: s.whenToUse } : {}),
      catalog: s,
      providerId: s.providerId,
      providerSpec: s.providerSpec,
    }))
  return [...rows.sort(compare), ...catalogOnly.sort(compare)]
}

/** Case-insensitive search + provider filter + installed-only filter. */
export function filterEntries(
  entries: readonly GridEntry[],
  search: string,
  providerFilter: string,
  installedOnly: boolean,
): GridEntry[] {
  const q = search.trim().toLowerCase()
  return entries.filter((entry) => {
    if (installedOnly && entry.row === undefined) return false
    if (providerFilter !== '' && entry.providerId !== providerFilter) return false
    if (q !== '' && !`${entry.name} ${entry.description} ${entry.providerSpec ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

export function SkillsPanel(deps: SkillsPanelDeps): React.ReactElement {
  const t = deps.t ?? englishTranslate
  const [tab, setTab] = React.useState<Tab>('skills')
  const [state, setState] = React.useState<SkillsState | undefined>()
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | undefined>()
  const [search, setSearch] = React.useState('')
  const [providerFilter, setProviderFilter] = React.useState('')
  const [installedOnly, setInstalledOnly] = React.useState(false)
  const [visible, setVisible] = React.useState(PAGE_SIZE)
  /** The open scope modal's entry. */
  const [modal, setModal] = React.useState<GridEntry | undefined>()
  /** The modal's radio: everywhere (default) or a workspace whitelist. */
  const [scopeMode, setScopeMode] = React.useState<'global' | 'workspaces'>('global')
  /** Checked workspace paths while the modal is in workspaces mode. */
  const [checked, setChecked] = React.useState<Set<string>>(new Set())
  /** Two-step remove confirm inside the modal. */
  const [confirmRemove, setConfirmRemove] = React.useState(false)
  /** The open detail modal's entry plus its loaded content. */
  const [detail, setDetail] = React.useState<GridEntry | undefined>()
  const [detailData, setDetailData] = React.useState<SkillDetail | undefined>()
  const [addSpec, setAddSpec] = React.useState('')
  const workspaces = deps.getWorkspaces()
  const workspacePaths = React.useMemo(() => workspaces.map((w) => w.path), [workspaces])

  const refresh = React.useCallback(async (): Promise<void> => {
    try {
      const next = await deps.rpc('getState', { workspacePaths }) as SkillsState
      setState(next)
    } catch (error) {
      setMessage({ ok: false, text: errMsg(error) })
    }
  }, [deps, workspacePaths])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (modal === undefined && detail === undefined) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { closeModal(); setDetail(undefined); setDetailData(undefined) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, detail])

  // Load the detail body whenever the detail modal opens for a new entry.
  React.useEffect(() => {
    setDetailData(undefined)
    if (detail === undefined) return
    const catalogOnly = detail.catalog !== undefined && detail.row === undefined
    const args = catalogOnly
      ? { providerId: detail.catalog!.providerId, skillPath: detail.catalog!.skillPath }
      : { name: detail.name, workspacePaths }
    let cancelled = false
    deps.rpc(catalogOnly ? 'getCatalogSkillDetail' : 'getInstalledSkillDetail', args)
      .then((result) => {
        if (!cancelled) setDetailData((result ?? undefined) as SkillDetail | undefined)
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage({ ok: false, text: errMsg(error) })
      })
    return () => { cancelled = true }
  }, [detail, deps, workspacePaths])

  const mutate = async (method: string, args?: unknown): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    try {
      const result = await deps.rpc(method, args) as MutationResult
      if (isMutationError(result)) {
        setMessage({ ok: false, text: result.error ?? 'request failed' })
      } else {
        if (result.state !== undefined) setState(result.state)
        else await refresh()
        if (CATALOG_MUTATIONS.has(method)) deps.notifyInstalledChanged?.()
        setConfirmRemove(false)
      }
    } catch (error) {
      setMessage({ ok: false, text: errMsg(error) })
    } finally {
      setBusy(false)
    }
  }

  const addProvider = async (): Promise<void> => {
    if (addSpec.trim() === '') return
    await mutate('addProvider', { spec: addSpec.trim() })
    setAddSpec('')
  }

  const providers: ProviderView[] = state?.providers ?? []
  const entries = React.useMemo(() => (state !== undefined ? buildGridEntries(state) : []), [state])
  const filtered = React.useMemo(
    () => filterEntries(entries, search, providerFilter, installedOnly),
    [entries, search, providerFilter, installedOnly],
  )

  const closeModal = (): void => {
    setModal(undefined)
    setScopeMode('global')
    setChecked(new Set())
    setConfirmRemove(false)
  }

  /** Open the scope modal; an installed skill starts on its current scope. */
  const openModal = (entry: GridEntry): void => {
    setModal(entry)
    const scope = entry.row?.configScope
    if (scope?.kind === 'workspaces') {
      setScopeMode('workspaces')
      setChecked(new Set(scope.workspacePaths))
    } else {
      setScopeMode('global')
      setChecked(new Set())
    }
    setConfirmRemove(false)
  }

  const toggleWorkspace = (path: string): void => {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** Add (catalog entry) or re-scope (installed row) with the drafted scope.
   *  A workspaces draft with zero checked boxes means off everywhere. */
  const confirmModal = (): void => {
    if (modal === undefined) return
    const scope = scopeMode === 'global'
      ? { kind: 'global' }
      : { kind: 'workspaces', workspacePaths: [...checked] }
    if (modal.row !== undefined) void mutate('setScope', { name: modal.name, scope })
    else if (modal.catalog !== undefined) {
      void mutate('installSkill', { providerId: modal.catalog.providerId, skillPath: modal.catalog.skillPath, scope })
    }
    closeModal()
  }

  /** The scope modal: one radio — Everywhere (default) or a workspace
   *  whitelist — and a checklist under the workspaces mode. Either/or. */
  const modalDialog = (): React.ReactElement | null => {
    if (modal === undefined) return null
    const row = modal.row
    const removable = row?.managed === true
    const canUpdate = removable === true && row?.updateAvailable === true && row.scope === 'global'
    // Checklist rows: the registry's workspaces plus any recorded path the
    // registry no longer knows (so it stays visible and can be unchecked).
    const recordedPaths = row?.configScope?.kind === 'workspaces' ? row.configScope.workspacePaths : []
    const rows: Array<{ path: string; title: string; missing: boolean }> = [
      ...workspaces.map((w) => ({ path: w.path, title: w.title, missing: false })),
      ...recordedPaths
        .filter((p) => !workspaces.some((w) => w.path === p))
        .map((p) => ({ path: p, title: p, missing: true })),
    ]
    const globalRadio = React.createElement('label', { className: styles.optionRow, 'data-testid': 'skills-scope-global' },
      React.createElement('input', {
        type: 'radio',
        name: 'skills-scope-mode',
        checked: scopeMode === 'global',
        disabled: busy,
        onChange: () => { setScopeMode('global'); setConfirmRemove(false) },
      }),
      React.createElement('span', { className: styles.optionLabel }, t('modal.scope.global')),
    )
    const workspacesRadio = React.createElement('label', { className: styles.optionRow, 'data-testid': 'skills-scope-workspaces' },
      React.createElement('input', {
        type: 'radio',
        name: 'skills-scope-mode',
        checked: scopeMode === 'workspaces',
        disabled: busy,
        onChange: () => { setScopeMode('workspaces'); setConfirmRemove(false) },
      }),
      React.createElement('span', { className: styles.optionLabel }, t('modal.scope.workspaces')),
    )
    const checklist = scopeMode !== 'workspaces' ? null : React.createElement('div', { className: styles.optionList, 'data-testid': 'skills-workspaces' },
      rows.length === 0
        ? React.createElement('p', { className: styles.modalHint }, t('modal.workspaces.empty'))
        : rows.map((workspace) => React.createElement('label', { key: workspace.path, className: styles.optionRow, 'data-testid': 'skills-workspace' },
          React.createElement('input', {
            type: 'checkbox',
            checked: checked.has(workspace.path),
            disabled: busy,
            onChange: () => toggleWorkspace(workspace.path),
          }),
          React.createElement('span', { className: styles.optionLabel }, workspace.title),
          workspace.missing ? React.createElement('span', { className: styles.addedBadge }, t('modal.workspaceMissing')) : null,
        )),
      React.createElement('p', { className: styles.modalHint }, t('modal.workspaces.hint')),
    )
    const updateButton = canUpdate
      ? React.createElement('button', {
        type: 'button',
        className: styles.ghost,
        disabled: busy,
        onClick: () => { void mutate('updateSkill', { name: modal.name }); closeModal() },
        'data-testid': 'skills-modal-update',
      }, t('modal.update'))
      : null
    const removeButton = removable === false
      ? null
      : confirmRemove
        ? React.createElement('button', {
          type: 'button',
          className: `${styles.danger} ${styles.optionAction}`,
          disabled: busy,
          onClick: () => { void mutate('remove', { name: modal.name }); closeModal() },
          'data-testid': 'skills-remove-confirm',
        }, t('modal.confirmRemove'))
        : React.createElement('button', {
          type: 'button',
          className: `${styles.ghostDanger} ${styles.optionAction}`,
          disabled: busy,
          onClick: () => setConfirmRemove(true),
          'data-testid': 'skills-remove',
        }, t('modal.remove'))
    return React.createElement('div', { className: styles.overlay, role: 'presentation', onClick: closeModal },
      React.createElement('div', {
        className: styles.modal,
        role: 'dialog',
        'aria-modal': true,
        'aria-label': t('modal.aria', { name: modal.name }),
        'data-testid': 'skills-scope-modal',
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('p', { className: styles.modalTitle }, modal.name),
        React.createElement('p', { className: styles.modalHint }, t('modal.hint')),
        React.createElement('div', { className: styles.optionList, 'data-testid': 'skills-scope' },
          globalRadio,
          workspacesRadio,
        ),
        checklist,
        React.createElement('div', { className: styles.modalActions },
          React.createElement('button', {
            type: 'button', className: styles.ghost, disabled: busy, onClick: closeModal,
          }, t('modal.cancel')),
          updateButton,
          removeButton,
          React.createElement('button', {
            type: 'button',
            className: styles.primary,
            // An empty whitelist is meaningful: it disables the skill
            // everywhere (the old master switch), so the confirm stays on.
            disabled: busy,
            onClick: confirmModal,
            'data-testid': 'skills-modal-confirm',
          }, row !== undefined ? t('modal.save') : t('card.add')),
        ),
      ),
    )
  }

  /** The detail modal: metadata plus the SKILL.md body rendered as markdown. */
  const detailDialog = (): React.ReactElement | null => {
    if (detail === undefined) return null
    const closeDetail = (): void => { setDetail(undefined); setDetailData(undefined) }
    const body = detailData === undefined
      ? React.createElement('p', { className: styles.modalHint }, t('status.working'))
      : React.createElement('div', { className: styles.modalBody + ' ' + styles.md, 'data-testid': 'skills-detail-body' },
        renderMarkdown(detailData.body),
      )
    return React.createElement('div', { className: styles.overlay, role: 'presentation', onClick: closeDetail },
      React.createElement('div', {
        className: styles.modal,
        role: 'dialog',
        'aria-modal': true,
        'aria-label': t('detail.aria', { name: detail.name }),
        'data-testid': 'skills-detail',
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('p', { className: styles.modalTitle }, detail.name),
        React.createElement('p', { className: styles.modalHint }, [
          detailData?.modelInvocable === false ? t('detail.modelBlocked') : t('detail.modelInvocable'),
          detailData?.userInvocable === false ? t('detail.userBlocked') : t('detail.userInvocable'),
          detailData?.whenToUse !== undefined ? t('detail.whenToUse', { text: detailData.whenToUse }) : '',
        ].filter(Boolean).join(' · ')),
        body,
        React.createElement('div', { className: styles.modalActions },
          React.createElement('button', {
            type: 'button', className: styles.ghost, onClick: closeDetail,
            'data-testid': 'skills-detail-close',
          }, t('detail.close')),
        ),
      ),
    )
  }

  // Compose the page from pre-built elements: conditional sections become
  // local consts (never `cond && ( ... )` argument expressions — the TSX
  // parser mis-handled that shape in this nesting).
  const tabBar = React.createElement('div', { className: styles.tabs, role: 'tablist' },
    React.createElement('button', {
      type: 'button', role: 'tab', 'aria-selected': tab === 'skills',
      className: tab === 'skills' ? styles.tabActive : styles.tab,
      onClick: () => setTab('skills'), 'data-testid': 'skills-tab-skills',
    }, t('tab.skills')),
    React.createElement('button', {
      type: 'button', role: 'tab', 'aria-selected': tab === 'providers',
      className: tab === 'providers' ? styles.tabActive : styles.tab,
      onClick: () => setTab('providers'), 'data-testid': 'skills-tab-providers',
    }, t('tab.providers')),
  )

  const messageBanner = message === undefined
    ? null
    : React.createElement('div', { className: message.ok ? styles.noticeOk : styles.noticeErr, 'data-testid': 'skills-message' },
      message.text,
    )

  const searchInput = React.createElement('input', {
    type: 'search',
    className: styles.input,
    placeholder: t('search.placeholder'),
    value: search,
    onChange: (e) => setSearch((e.target as HTMLInputElement).value),
    'data-testid': 'skills-search',
  })

  const providerOptions = [
    React.createElement('option', { key: 'all', value: '' }, t('provider.all')),
    ...providers.map((p) => React.createElement('option', { key: p.id, value: p.id }, p.spec)),
  ]

  const providerSelect = React.createElement('select', {
    className: styles.select,
    value: providerFilter,
    onChange: (e) => setProviderFilter((e.target as HTMLSelectElement).value),
    'aria-label': t('provider.aria'),
    'data-testid': 'skills-provider-filter',
  }, providerOptions)

  const installedToggle = React.createElement('label', { className: styles.toggleWrap },
    React.createElement('input', {
      type: 'checkbox',
      checked: installedOnly,
      onChange: (e) => setInstalledOnly((e.target as HTMLInputElement).checked),
      'data-testid': 'skills-installed-only',
    }),
    t('filter.installedOnly'),
  )

  const filterBar = tab !== 'skills'
    ? null
    : React.createElement('div', { className: styles.filterRow },
      searchInput,
      providerSelect,
      installedToggle,
    )

  const emptyState = React.createElement('div', { className: styles.empty, 'data-testid': 'skills-empty' },
    providers.length === 0 ? t('empty.noProviders') : t('empty.noMatch'),
  )

  const cardNodes = filtered.slice(0, visible).map((entry) => {
    const row = entry.row
    const installedHere = row !== undefined
    const project = row !== undefined && row.scope === 'workspace'
    const unmanagedCustom = row !== undefined && !project && row.managed === false && row.provider === undefined && entry.catalog === undefined
    const presenceTitle = row !== undefined && row.configScope?.kind === 'workspaces'
      ? row.configScope.workspacePaths.join('\n')
      : undefined
    const titleLine = React.createElement('div', { className: styles.pluginName },
      React.createElement('button', {
        type: 'button',
        className: styles.nameButton,
        title: t('card.detailsTitle', { name: entry.name }),
        onClick: () => setDetail(entry),
        'data-testid': 'skills-detail-open',
      }, entry.name),
      entry.providerSpec !== undefined
        ? React.createElement('span', { className: styles.providerChip }, entry.providerSpec)
        : null,
      row?.updateAvailable === true
        ? React.createElement('span', { className: styles.addedBadge }, t('card.update'))
        : null,
    )
    const descriptionLine = React.createElement('div', { className: styles.desc },
      entry.description !== '' ? entry.description : t('card.noDescription'),
    )
    const badges = installedHere === false
      ? null
      : React.createElement('div', { className: styles.badges },
        React.createElement('span', {
          className: styles.presenceBadge,
          'data-testid': 'skills-presence',
          title: presenceTitle,
        }, presenceLabel(row.configScope, t)),
        project ? React.createElement('span', { className: styles.projectChip }, t('badge.project')) : null,
        unmanagedCustom ? React.createElement('span', { className: styles.installedChip }, t('badge.custom')) : null,
      )
    const topHalf = React.createElement('div', { className: styles.pluginCardTop },
      React.createElement('div', { className: styles.headText },
        titleLine,
        descriptionLine,
      ),
      badges,
    )
    const updateButton = row?.updateAvailable === true && row.scope === 'global'
      ? React.createElement('button', {
        type: 'button',
        className: styles.ghost,
        disabled: busy,
        onClick: () => { void mutate('updateSkill', { name: entry.name }) },
        'data-testid': 'skills-update',
      }, t('card.update'))
      : null
    const actionButton = React.createElement('button', {
      type: 'button',
      className: installedHere ? styles.ghost : styles.primary,
      disabled: busy,
      onClick: () => openModal(entry),
      'data-testid': installedHere ? 'skills-manage' : 'skills-add',
    }, installedHere ? t('card.manage') : t('card.add'))
    const bottomHalf = React.createElement('div', { className: styles.pluginCardTop },
      React.createElement('span', { className: styles.providerKind },
        installedHere ? t('card.installed') : '',
      ),
      React.createElement('div', { className: styles.rowActions },
        updateButton,
        actionButton,
      ),
    )
    return React.createElement('div', { key: entry.key, className: styles.pluginCard, 'data-testid': 'skills-card' },
      topHalf,
      bottomHalf,
    )
  })

  const showMoreButton = filtered.length <= visible
    ? null
    : React.createElement('div', { className: styles.showMoreRow },
      React.createElement('button', {
        type: 'button',
        className: styles.ghost,
        disabled: busy,
        onClick: () => setVisible((n) => n + PAGE_SIZE),
        'data-testid': 'skills-show-more',
      }, t('list.showMore')),
    )

  const skillsBody = tab !== 'skills'
    ? null
    : filtered.length === 0
      ? emptyState
      : React.createElement('div', { className: styles.pluginGrid, 'data-testid': 'skills-grid' },
        cardNodes,
      )

  const providerInput = React.createElement('input', {
    className: styles.input,
    placeholder: t('providers.placeholder'),
    value: addSpec,
    onChange: (e) => setAddSpec((e.target as HTMLInputElement).value),
    onKeyDown: (e) => {
      if (e.key === 'Enter') void addProvider()
    },
    'data-testid': 'skills-provider-input',
  })

  const providerAddRow = tab !== 'providers'
    ? null
    : React.createElement('div', { className: styles.addRow },
      providerInput,
      React.createElement('button', {
        type: 'button', className: styles.primary, disabled: busy || addSpec.trim() === '', onClick: () => void addProvider(),
      }, t('providers.add')),
      React.createElement('button', {
        type: 'button', className: styles.ghost, disabled: busy || providers.length === 0, onClick: () => void mutate('refreshProviders'),
        'data-testid': 'skills-provider-refresh-all',
      }, t('providers.refreshAll')),
    )

  const providerHint = tab !== 'providers'
    ? null
    : React.createElement('div', { className: styles.hint }, t('providers.hint'))

  const providerNodes = providers.map((p) => React.createElement('div', { key: p.id, className: styles.card, 'data-testid': 'skills-provider' },
    React.createElement('div', { className: styles.marketHead },
      React.createElement('div', { className: styles.headText },
        React.createElement('div', { className: styles.name }, p.spec),
        React.createElement('div', { className: styles.desc },
          [
            p.description !== undefined ? p.description : '',
            countOf(t, p.skillCount, 'providers.skillCount.one', 'providers.skillCount.many'),
            formatLastSync(p.lastRefresh, Date.now(), t),
          ].filter(Boolean).join(' · '),
        ),
        p.error !== undefined ? React.createElement('div', { className: styles.errText }, p.error) : null,
      ),
      React.createElement('button', {
        type: 'button',
        className: styles.ghostDanger,
        disabled: busy,
        onClick: () => { void mutate('removeProvider', { providerId: p.id }) },
        'data-testid': 'skills-provider-remove',
      }, t('providers.remove')),
    ),
  ))

  const providersBody = tab !== 'providers'
    ? null
    : providers.length === 0
      ? emptyState
      : providerNodes

  return React.createElement('div', { className: styles.page },
    tabBar,
    messageBanner,
    filterBar,
    skillsBody,
    showMoreButton,
    providerAddRow,
    providerHint,
    providersBody,
    modalDialog(),
    detailDialog(),
  )
}