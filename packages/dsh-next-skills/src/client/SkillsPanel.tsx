/**
 * The Skills settings page rendered in the `settings.section` slot — the
 * sibling of the Claude Plugins page (CcPanel) and styled by the same shared
 * chrome: `card.module.css` mirrors cc-plugins' module byte-for-byte on every
 * shared class, so the two settings pages read as one product.
 *
 *  - Skills: every discovered skill copy (project `.dsh`/`.agents` and user
 *    roots) plus every provider catalog skill in one two-column card grid —
 *    one card per copy, with a provider filter, a search box, and an
 *    installed-only toggle. Each card shows the name, an origin chip, the
 *    provider spec, and a presence badge, then an equal-width action row
 *    below the description: Update (warn-tinted outline, only when a newer
 *    catalog version exists), Delete (dark-red text, two-step confirm), and
 *    Scopes (opens the scope modal — Global by default or a checklist of
 *    workspaces).
 *    Catalog skills with no installed copy render an Add button. The name
 *    button opens the skill's full SKILL.md rendered as markdown.
 *  - Providers: source management (add by owner/repo shorthand or GitHub
 *    URL, refresh all, remove) with per-source sync age and error rows.
 *
 * Providers, installed records, and scopes persist in the plugin's settings
 * namespace (the harness settings.yaml), so the configuration is readable
 * and shareable between developers.
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
import { basenamePath } from '../core/path.ts'
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

/** Tab strip order — the roving-tabindex keyboard model walks this. */
const TAB_ORDER: readonly Tab[] = ['skills', 'providers']

/** Cards rendered before the "Show more" button appends the next page. */
const PAGE_SIZE = 30

/** Mutations whose success may change the installed copies the chat UI surfaces. */
const CATALOG_MUTATIONS = new Set(['installSkill', 'setSkillScope', 'updateSkill', 'deleteSkill', 'addProvider', 'removeProvider', 'reconcileInstalled'])

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
  if (iso === '') return t('sync.never')
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return t('sync.unknown')
  const diff = now - at
  if (diff < 60_000) return t('sync.justNow')
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return t('sync.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('sync.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('sync.daysAgo', { count: days })
  return iso.slice(0, 10)
}

/** The presence badge label for a row's config scope (undefined = default). */
export function presenceLabel(scope: SkillScopeSetting | undefined, t: Translate = englishTranslate): string {
  if (scope === undefined) return t('presence.everywhere')
  if (scope.length === 0) return t('presence.off')
  return countOf(t, scope.length, 'presence.workspaces.one', 'presence.workspaces.many')
}

/** Dictionary key for a skill copy's origin root (the `source` bucket). */
export function sourceKey(source: string): MessageKey {
  switch (source) {
    case 'project-dsh': return 'source.projectDsh'
    case 'project-agents': return 'source.projectAgents'
    case 'user-dsh': return 'source.userDsh'
    case 'user-agents': return 'source.userAgents'
    default: return 'source.custom'
  }
}

/** One card in the skills grid: one discovered copy, or a catalog skill (Add). */
export interface GridEntry {
  key: string
  name: string
  description: string
  whenToUse?: string
  /** The catalog skill backing this entry (Add/Replace flow), when offered. */
  catalog?: CatalogSkillView
  /** The discovered copy this card manages (undefined for offering cards). */
  row?: InstalledSkill
  /** Catalog provider id (the provider filter compares ids). */
  providerId?: string
  /** Provider spec label (`owner/repo`), when provider-installed. */
  providerSpec?: string
  /** For an offering card whose name is installed: the copy a Replace
   *  targets, and whether this offering is that copy's active source. */
  installed?: { directory: string; active: boolean }
  /** How many providers offer this name (installed cards' sources chip;
   *  present only when more than one and the copy is not externally owned). */
  sourceCount?: number
}

/**
 * One card per discovered copy (a skill present in several roots produces a
 * card per root), joined with EVERY provider offering: a catalog skill whose
 * name is not installed becomes an Add row; a same-name offering of an
 * installed (non-owned) copy becomes a Replace row — its active source marked
 * "current", the rest one click away from switching vendors. Externally-owned
 * copies (the cc-plugins bridge) render no offerings and no sources chip:
 * their source is the owning plugin's business.
 */
export function buildGridEntries(state: SkillsState): GridEntry[] {
  const specToId = new Map(state.providers.map((p) => [p.spec, p.id]))
  const offeringsByName = new Map<string, CatalogSkillView[]>()
  for (const s of state.catalog) {
    const list = offeringsByName.get(s.name) ?? []
    list.push(s)
    offeringsByName.set(s.name, list)
  }
  const compare = (a: GridEntry, b: GridEntry): number =>
    // Installed names first, then names to add; within a name the managed
    // copies precede the other providers' offerings.
    ((groupHasInstall.has(b.name) ? 1 : 0) - (groupHasInstall.has(a.name) ? 1 : 0))
    || a.name.localeCompare(b.name)
    || ((a.row !== undefined ? 0 : 1) - (b.row !== undefined ? 0 : 1))
    || (a.providerSpec ?? '').localeCompare(b.providerSpec ?? '')
  // The first (highest-precedence) non-owned copy per name is the target a
  // Replace switches; owned copies keep their name's offerings hidden (their
  // source is the owning plugin's business, and the offerings would render
  // unactionable Add cards for an already-installed name).
  const replaceTarget = new Map<string, InstalledSkill>()
  const ownedNames = new Set<string>()
  const groupHasInstall = new Set<string>()
  for (const row of state.installed) {
    groupHasInstall.add(row.name)
    if (row.ownership !== undefined) { ownedNames.add(row.name); continue }
    if (!replaceTarget.has(row.name)) replaceTarget.set(row.name, row)
  }
  const rows: GridEntry[] = state.installed.map((row) => {
    const offerings = offeringsByName.get(row.name) ?? []
    return {
      key: `row:${row.source}:${row.path}`,
      name: row.name,
      description: row.description,
      ...(row.whenToUse !== undefined ? { whenToUse: row.whenToUse } : {}),
      row,
      ...(row.provider !== undefined && specToId.get(row.provider) !== undefined
        ? { providerId: specToId.get(row.provider) }
        : {}),
      ...(row.provider !== undefined ? { providerSpec: row.provider } : {}),
      ...(row.ownership === undefined && offerings.length > 1 ? { sourceCount: offerings.length } : {}),
    }
  })
  const offerings: GridEntry[] = state.catalog
    .filter((s) => !ownedNames.has(s.name))
    .map((s) => {
    const target = replaceTarget.get(s.name)
    return {
      key: `cat:${s.providerId}/${s.skillPath}`,
      name: s.name,
      description: s.description,
      ...(s.whenToUse !== undefined ? { whenToUse: s.whenToUse } : {}),
      catalog: s,
      providerId: s.providerId,
      providerSpec: s.providerSpec,
      ...(target !== undefined ? { installed: { directory: target.directory, active: target.provider === s.providerSpec } } : {}),
    }
  })
  return [...rows, ...offerings].sort(compare)
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
  /** The modal's radio: global (default) or a workspace whitelist. */
  const [scopeMode, setScopeMode] = React.useState<'global' | 'workspaces'>('global')
  /** Checked workspace names while the modal is in workspaces mode. */
  const [checked, setChecked] = React.useState<Set<string>>(new Set())
  /** The provider a sequential Refresh all is currently downloading. */
  const [refreshingId, setRefreshingId] = React.useState<string | undefined>()
  /** The open detail modal's entry plus its loaded content. */
  const [detail, setDetail] = React.useState<GridEntry | undefined>()
  const [detailData, setDetailData] = React.useState<SkillDetail | undefined>()
  /** The copy awaiting delete confirmation (two-step before the RPC). */
  const [confirmDelete, setConfirmDelete] = React.useState<GridEntry | undefined>()
  /** The provider awaiting removal confirmation (two-step before the RPC). */
  const [confirmRemoveProvider, setConfirmRemoveProvider] = React.useState<ProviderView | undefined>()
  const [addSpec, setAddSpec] = React.useState('')
  const workspaces = deps.getWorkspaces()
  // The listing is global-only (project skills are hand-managed and live with
  // the project), so getState needs no workspace paths; the registered
  // workspaces still drive the scope modal's enablement checklist below.

  const refresh = React.useCallback(async (): Promise<void> => {
    try {
      const next = await deps.rpc('getState') as SkillsState
      // Defensive: the listing is global-only. A stale host envelope still
      // carrying workspace rows must not render them (they are hand-managed
      // in the project, not this panel's business).
      setState({ ...next, installed: next.installed.filter((s) => s.scope === 'global') })
    } catch (error) {
      setMessage({ ok: false, text: errMsg(error) })
    }
  }, [deps])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (modal === undefined && detail === undefined && confirmDelete === undefined && confirmRemoveProvider === undefined) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { closeModal(); setDetail(undefined); setDetailData(undefined); setConfirmDelete(undefined); setConfirmRemoveProvider(undefined) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, detail, confirmDelete, confirmRemoveProvider])

  // Load the detail body whenever the detail modal opens for a new entry.
  // Installed rows pass the copy's path: a name may have several copies, and
  // the modal must show the body of the copy whose name was clicked.
  React.useEffect(() => {
    setDetailData(undefined)
    if (detail === undefined) return
    const catalogOnly = detail.catalog !== undefined && detail.row === undefined
    const args = catalogOnly
      ? { providerId: detail.catalog!.providerId, skillPath: detail.catalog!.skillPath }
      : { name: detail.name, path: detail.row!.path }
    let cancelled = false
    deps.rpc(catalogOnly ? 'getCatalogSkillDetail' : 'getInstalledSkillDetail', args)
      .then((result) => {
        if (!cancelled) setDetailData((result ?? undefined) as SkillDetail | undefined)
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage({ ok: false, text: errMsg(error) })
      })
    return () => { cancelled = true }
  }, [detail, deps])

  const mutate = async (method: string, args?: unknown): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    try {
      const result = await deps.rpc(method, args) as MutationResult
      if (isMutationError(result)) {
        setMessage({ ok: false, text: result.error ?? t('status.requestFailed') })
      } else {
        if (result.state !== undefined) setState(result.state)
        else await refresh()
        setMessage({ ok: true, text: result.warning ?? t('status.done') })
        if (CATALOG_MUTATIONS.has(method)) deps.notifyInstalledChanged?.()
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

  const refreshAllSequential = async (): Promise<void> => {
    const list = providers
    if (list.length === 0) return
    setBusy(true)
    setMessage(undefined)
    const failures: string[] = []
    const healed: string[] = []
    for (const provider of list) {
      setRefreshingId(provider.id)
      try {
        const result = await deps.rpc('refreshProvider', { providerId: provider.id }) as MutationResult
        if (isMutationError(result)) {
          failures.push(`${provider.spec}: ${result.error ?? t('status.refreshFailed')}`)
          await refresh()
        } else {
          // The host already reconciles inside refreshProvider and reports
          // reinstalled skills as `warning`; surface it and skip an extra pass.
          if (result.warning !== undefined) healed.push(result.warning)
          if (result.state !== undefined) setState(result.state)
          else deps.notifyInstalledChanged?.()
        }
      } catch (error) {
        failures.push(`${provider.spec}: ${errMsg(error)}`)
        await refresh()
      }
    }
    setRefreshingId(undefined)
    let text = failures.length > 0
      ? t('providers.refreshFailed', { count: failures.length, items: failures.join('; ') })
      : t('status.done')
    if (healed.length > 0) text += ` — ${healed.join('; ')}`
    setMessage({ ok: failures.length === 0, text })
    setBusy(false)
  }

  const providers: ProviderView[] = state?.providers ?? []

  /** Tab buttons by tab id, for the Arrow/Home/End focus moves below. */
  const tabRefs = React.useRef(new Map<Tab, HTMLButtonElement>())

  /** The harness shell tablist's keyboard model: ArrowLeft/Right move the
   *  selection, Home/End jump, and selection follows focus. */
  const onTabKeyDown = (event: React.KeyboardEvent): void => {
    const index = TAB_ORDER.indexOf(tab)
    const next = event.key === 'ArrowLeft' ? (index + TAB_ORDER.length - 1) % TAB_ORDER.length
      : event.key === 'ArrowRight' ? (index + 1) % TAB_ORDER.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? TAB_ORDER.length - 1
      : undefined
    if (next === undefined) return
    event.preventDefault()
    setTab(TAB_ORDER[next]!)
    tabRefs.current.get(TAB_ORDER[next]!)?.focus()
  }

  /** One underline tab in the shell's style: `data-active` drives the
   *  indicator, tabIndex roves, the testid stays `skills-tab-<id>`. */
  const renderTab = (id: Tab, label: string): React.ReactElement => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      data-active={tab === id ? 'true' : undefined}
      tabIndex={tab === id ? 0 : -1}
      className={styles.tab}
      onClick={() => setTab(id)}
      ref={(el) => { if (el !== null) tabRefs.current.set(id, el) }}
      data-testid={`skills-tab-${id}`}
    >{label}</button>
  )

  const entries = React.useMemo(() => (state !== undefined ? buildGridEntries(state) : []), [state])
  const filtered = React.useMemo(
    () => filterEntries(entries, search, providerFilter, installedOnly),
    [entries, search, providerFilter, installedOnly],
  )

  const closeModal = (): void => {
    setModal(undefined)
    setScopeMode('global')
    setChecked(new Set())
  }

  /** Open the scope modal; an installed skill starts on its current scope. */
  const openModal = (entry: GridEntry): void => {
    setModal(entry)
    const scope = entry.row?.configScope
    if (scope !== undefined) {
      setScopeMode('workspaces')
      setChecked(new Set(scope))
    } else {
      setScopeMode('global')
      setChecked(new Set())
    }
  }

  const toggleWorkspace = (name: string): void => {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  /** Add (catalog entry) or re-scope (installed row) with the drafted scope.
   *  A workspaces draft with zero checked boxes means off everywhere. */
  const confirmModal = (): void => {
    if (modal === undefined) return
    const names = scopeMode === 'global' ? null : [...checked]
    if (modal.row !== undefined) void mutate('setSkillScope', { name: modal.name, workspaces: names })
    else if (modal.catalog !== undefined) {
      void mutate('installSkill', {
        providerId: modal.catalog.providerId,
        skillPath: modal.catalog.skillPath,
        ...(names !== null ? { workspaces: names } : {}),
      })
    }
    closeModal()
  }

  /** The scope modal: one radio — Global (default) or a workspace
   *  whitelist — and a checklist under the workspaces mode. Either/or. */
  const modalDialog = (): React.ReactElement | null => {
    if (modal === undefined) return null
    const row = modal.row
    // Checklist rows: the registry's workspaces plus any recorded name the
    // registry no longer knows (so it stays visible and can be unchecked).
    const recordedNames = row?.configScope ?? []
    const rows: Array<{ name: string; title: string; missing: boolean }> = [
      ...workspaces.map((w) => ({ name: basenamePath(w.path), title: w.title, missing: false })),
      ...recordedNames
        .filter((n) => !workspaces.some((w) => basenamePath(w.path) === n))
        .map((n) => ({ name: n, title: n, missing: true })),
    ]
    // Both handlers set an ABSOLUTE value, so onClick (which label-forwarded
    // clicks deliver reliably) and onChange (which React's change detection
    // delivers) can run in any combination without double effects.
    const pick = (mode: 'global' | 'workspaces') => (): void => { setScopeMode(mode) }
    return (
      <div className={styles.overlay} role="presentation" onClick={closeModal}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-label={t('modal.aria', { name: modal.name })}
          data-testid="skills-modal"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <p className={styles.modalTitle}>{modal.name}</p>
          <p className={styles.modalHint}>{t('modal.hint')}</p>
          <div className={styles.optionList} data-testid="skills-scope">
            <label className={styles.optionRow} data-testid="skills-scope-global">
              <input
                type="radio"
                name="skills-scope-mode"
                checked={scopeMode === 'global'}
                disabled={busy}
                onClick={pick('global')}
                onChange={pick('global')}
              />
              <span className={styles.optionLabel}>{t('modal.scope.global')}</span>
            </label>
            <label className={styles.optionRow} data-testid="skills-scope-workspaces">
              <input
                type="radio"
                name="skills-scope-mode"
                checked={scopeMode === 'workspaces'}
                disabled={busy}
                onClick={pick('workspaces')}
                onChange={pick('workspaces')}
              />
              <span className={styles.optionLabel}>{t('modal.scope.workspaces')}</span>
            </label>
          </div>
          {scopeMode === 'workspaces' && (
            <div className={`${styles.optionList} ${styles.optionNested}`} data-testid="skills-workspaces">
              {rows.length === 0 ? (
                <p className={styles.modalHint}>{t('modal.workspaces.empty')}</p>
              ) : rows.map((workspace) => (
                <label key={workspace.name} className={styles.optionRow} data-testid="skills-workspace">
                  <input
                    type="checkbox"
                    checked={checked.has(workspace.name)}
                    disabled={busy}
                    onChange={() => toggleWorkspace(workspace.name)}
                  />
                  <span className={styles.optionLabel}>{workspace.title}</span>
                  {workspace.missing && <span className={styles.addedBadge}>{t('modal.workspaceMissing')}</span>}
                </label>
              ))}
              <p className={styles.modalHint}>{t('modal.workspaces.hint')}</p>
            </div>
          )}
          <p className={styles.modalHint}>{t('modal.effectHint')}</p>
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.ghost}
              disabled={busy}
              onClick={closeModal}
            >{t('modal.cancel')}</button>
            <button
              type="button"
              className={styles.primary}
              // An empty whitelist is meaningful: it disables the skill
              // everywhere, so the confirm never disables itself.
              disabled={busy}
              onClick={confirmModal}
              data-testid="skills-modal-confirm"
            >{row !== undefined ? t('modal.save') : t('card.use')}</button>
          </div>
        </div>
      </div>
    )
  }

  /** The detail modal: invocability metadata plus the SKILL.md body rendered
   *  as markdown. */
  const detailDialog = (): React.ReactElement | null => {
    if (detail === undefined) return null
    const closeDetail = (): void => { setDetail(undefined); setDetailData(undefined) }
    return (
      <div className={styles.overlay} role="presentation" onClick={closeDetail}>
        <div
          className={`${styles.modal} ${styles.modalWide}`}
          role="dialog"
          aria-modal="true"
          aria-label={t('detail.aria', { name: detail.name })}
          data-testid="skills-skill-detail"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <p className={styles.modalTitle}>{detail.name}</p>
          <p className={styles.modalHint}>
            {[
              detailData?.modelInvocable === false ? t('detail.modelBlocked') : t('detail.modelInvocable'),
              detailData?.userInvocable === false ? t('detail.userBlocked') : t('detail.userInvocable'),
              detailData?.whenToUse !== undefined ? t('detail.whenToUse', { text: detailData.whenToUse }) : '',
            ].filter(Boolean).join(' · ')}
          </p>
          {detailData === undefined ? (
            <p className={styles.modalHint}>{t('status.working')}</p>
          ) : (
            <div className={`${styles.modalBody} ${styles.md}`} data-testid="skills-detail-body">
              {renderMarkdown(detailData.body)}
            </div>
          )}
          <div className={styles.modalActions}>
            <button type="button" className={styles.ghost} onClick={closeDetail} data-testid="skills-detail-close">{t('detail.close')}</button>
          </div>
        </div>
      </div>
    )
  }

  /** Two-step delete confirm: shows the target copy and path before the RPC. */
  const confirmDeleteDialog = (): React.ReactElement | null => {
    if (confirmDelete === undefined || confirmDelete.row === undefined) return null
    const copy = confirmDelete.row
    const close = (): void => setConfirmDelete(undefined)
    const doDelete = (): void => {
      void mutate('deleteSkill', { name: confirmDelete.name, directory: copy.directory, kind: copy.kind, path: copy.path })
      close()
    }
    return (
      <div className={styles.overlay} role="presentation" onClick={close}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-label={t('delete.aria', { name: confirmDelete.name })}
          data-testid="skills-delete-confirm"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <p className={styles.modalTitle}>{t('delete.title', { name: confirmDelete.name })}</p>
          <p className={styles.modalHint}>{t('delete.hint')}</p>
          <p className={styles.copyPath} data-testid="skills-delete-path">{copy.path}</p>
          <div className={styles.modalActions}>
            <button type="button" className={styles.ghost} disabled={busy} onClick={close} data-testid="skills-delete-cancel">{t('modal.cancel')}</button>
            <button type="button" className={styles.danger} disabled={busy} onClick={doDelete} data-testid="skills-delete-confirm-btn">{t('modal.confirmDelete')}</button>
          </div>
        </div>
      </div>
    )
  }

  /** Two-step provider removal: shows the provider spec before the RPC.
   *  Installed skill copies stay; only the source and its cache go. */
  const confirmRemoveProviderDialog = (): React.ReactElement | null => {
    if (confirmRemoveProvider === undefined) return null
    const provider = confirmRemoveProvider
    const close = (): void => setConfirmRemoveProvider(undefined)
    const doRemove = (): void => {
      void mutate('removeProvider', { providerId: provider.id })
      close()
    }
    return (
      <div className={styles.overlay} role="presentation" onClick={close}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-label={t('providers.removeAria', { name: provider.spec })}
          data-testid="skills-provider-remove-modal"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <p className={styles.modalTitle}>{t('providers.removeTitle', { name: provider.spec })}</p>
          <p className={styles.modalHint}>{t('providers.removeHint')}</p>
          <p className={styles.copyPath} data-testid="skills-provider-remove-spec">{provider.spec}</p>
          <div className={styles.modalActions}>
            <button type="button" className={styles.ghost} disabled={busy} onClick={close} data-testid="skills-provider-remove-cancel">{t('modal.cancel')}</button>
            <button type="button" className={styles.danger} disabled={busy} onClick={doRemove} data-testid="skills-provider-remove-confirm-btn">{t('providers.remove')}</button>
          </div>
        </div>
      </div>
    )
  }

  /** One card: a managed copy (installed) or a provider offering
   *  (Add / Replace / current source). */
  const renderCard = (entry: GridEntry): React.ReactElement => {
    const row = entry.row
    const installedHere = row !== undefined
    // Externally-owned skills never offer provider updates (their
    // update path is the owning plugin) — defensive against a stale
    // host envelope still carrying candidates.
    const candidate = row !== undefined && row.ownership === undefined && row.updateCandidates !== undefined && row.updateCandidates.length > 0 ? row.updateCandidates[0] : undefined
    const presenceTitle = row !== undefined && row.configScope !== undefined ? row.configScope.join('\n') : undefined
    return (
      <div key={entry.key} className={styles.pluginCard} data-testid="skills-card">
        <div className={styles.pluginCardTop}>
          <div className={styles.headText}>
            <div className={styles.pluginName}>
              <button
                type="button"
                className={styles.nameButton}
                title={t('card.detailsTitle', { name: entry.name })}
                onClick={() => setDetail(entry)}
                data-testid="skills-detail"
              >{entry.name}</button>
              {installedHere && <span className={styles.sourceChip}>{t(sourceKey(row.source))}</span>}
              {installedHere && row.provider !== undefined && <span className={styles.providerChip}>{row.provider}</span>}
            </div>
            <div className={styles.desc}>{entry.description !== '' ? entry.description : t('card.noDescription')}</div>
          </div>
          {installedHere && (
            <div className={styles.badges}>
              <span className={styles.presenceBadge} data-testid="skills-presence" title={presenceTitle}>
                {presenceLabel(row.configScope, t)}
              </span>
              {entry.sourceCount !== undefined && (
                <span className={styles.providerChip} data-testid="skills-sources">
                  {countOf(t, entry.sourceCount, 'card.sources.one', 'card.sources.many')}
                </span>
              )}
            </div>
          )}
        </div>
        {installedHere && (
          <div className={styles.cardActions} data-testid="skills-actions">
            {candidate !== undefined && (
              <button
                type="button"
                className={styles.updateBtn}
                disabled={busy}
                onClick={() => { void mutate('updateSkill', { name: entry.name, directory: row.directory, providerId: candidate.providerId, skillPath: candidate.skillPath }) }}
                data-testid="skills-update"
              >{t('card.update')}</button>
            )}
            <button
              type="button"
              className={styles.deleteBtn}
              disabled={busy}
              onClick={() => setConfirmDelete(entry)}
              data-testid="skills-delete"
            >{t('card.delete')}</button>
            <button
              type="button"
              className={styles.ghost}
              disabled={busy}
              onClick={() => openModal(entry)}
              data-testid="skills-scopes"
            >{t('card.scopes')}</button>
          </div>
        )}
        {!installedHere && (
          <div className={styles.pluginCardTop}>
            {entry.providerSpec !== undefined && <span className={styles.providerChip}>{entry.providerSpec}</span>}
            <div className={styles.rowActions}>
              {entry.installed === undefined && (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => openModal(entry)}
                  data-testid="skills-use"
                >{t('card.use')}</button>
              )}
              {entry.installed !== undefined && entry.installed.active && (
                <span className={styles.sourceChip} data-testid="skills-source-current">{t('card.currentSource')}</span>
              )}
              {entry.installed !== undefined && !entry.installed.active && (
                <button
                  type="button"
                  className={styles.updateBtn}
                  disabled={busy}
                  title={t('card.replaceTitle', { provider: entry.providerSpec ?? '' })}
                  onClick={() => {
                    void mutate('updateSkill', {
                      name: entry.name,
                      directory: entry.installed!.directory,
                      providerId: entry.catalog!.providerId,
                      skillPath: entry.catalog!.skillPath,
                    })
                  }}
                  data-testid="skills-replace"
                >{t('card.replace')}</button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  /** Same-name cards share one bordered group (the installed copies first,
   *  then the other providers' offerings); a single-card group renders as a
   *  plain card with no wrapper. */
  const renderGroups = (): React.ReactElement[] => {
    const slice = filtered.slice(0, visible)
    const groups: GridEntry[][] = []
    for (const entry of slice) {
      const last = groups[groups.length - 1]
      if (last !== undefined && last[0]!.name === entry.name) last.push(entry)
      else groups.push([entry])
    }
    return groups.map((group) => {
      if (group.length === 1) return renderCard(group[0]!)
      return (
        <div key={`grp:${group[0]!.name}`} className={styles.skillGroup} data-testid="skills-group">
          {group.map((entry) => renderCard(entry))}
        </div>
      )
    })
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>{t('title')}</h2>
      <p className={styles.intro}>{t('intro')}</p>
      <div className={styles.tabs} role="tablist" aria-label={t('tabs')} onKeyDown={onTabKeyDown}>
        {renderTab('skills', t('tab.skills'))}
        {renderTab('providers', t('tab.providers'))}
      </div>

      {message !== undefined && (
        <div className={message.ok ? styles.noticeOk : styles.noticeErr} data-testid="skills-message">{message.text}</div>
      )}

      {tab === 'skills' && (
        <div className={styles.filterRow}>
          <input
            type="search"
            className={styles.input}
            placeholder={t('search.placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="skills-search"
          />
          <select
            className={styles.select}
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            aria-label={t('provider.aria')}
            data-testid="skills-provider-filter"
          >
            <option value="">{t('provider.all')}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.spec}</option>
            ))}
          </select>
          <label className={styles.toggleWrap}>
            <input
              type="checkbox"
              checked={installedOnly}
              onChange={(e) => setInstalledOnly(e.target.checked)}
              data-testid="skills-installed-only"
            />
            {t('filter.installedOnly')}
          </label>
        </div>
      )}

      {tab === 'skills' && (filtered.length === 0 ? (
        <div className={styles.empty} data-testid="skills-empty">
          {providers.length === 0 ? t('empty.noProviders') : t('empty.noMatch')}
        </div>
      ) : (
        <div className={styles.pluginGrid} data-testid="skills-grid">
          {renderGroups()}
        </div>
      ))}

      {tab === 'skills' && filtered.length > visible && (
        <div className={styles.showMoreRow}>
          <button
            type="button"
            className={styles.ghost}
            disabled={busy}
            onClick={() => setVisible((n) => n + PAGE_SIZE)}
            data-testid="skills-show-more"
          >{t('list.showMore')}</button>
        </div>
      )}

      {tab === 'providers' && (
        <div className={styles.addRow}>
          <input
            className={styles.input}
            placeholder={t('providers.placeholder')}
            value={addSpec}
            onChange={(e) => setAddSpec(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addProvider()
            }}
            data-testid="skills-add-input"
          />
          <button type="button" className={styles.primary} disabled={busy || addSpec.trim() === ''} onClick={() => void addProvider()}>{t('providers.add')}</button>
          <button
            type="button"
            className={styles.ghost}
            disabled={busy || providers.length === 0}
            onClick={() => void refreshAllSequential()}
            data-testid="skills-provider-refresh-all"
          >{refreshingId !== undefined
            ? t('providers.refreshProgress', {
              done: Math.max(0, providers.findIndex((p) => p.id === refreshingId)) + 1,
              total: providers.length,
            })
            : t('providers.refreshAll')}</button>
        </div>
      )}

      {tab === 'providers' && (
        <div className={styles.hint}>{t('providers.hint')}</div>
      )}

      {tab === 'providers' && (providers.length === 0 ? (
        <div className={styles.empty} data-testid="skills-empty">{t('empty.noProviders')}</div>
      ) : providers.map((p) => (
        <div key={p.id} className={styles.card} data-testid="skills-provider">
          <div className={styles.marketHead}>
            <div className={styles.headText}>
              <div className={styles.name}>{p.spec}</div>
              <div className={styles.desc}>
                {[
                  p.description ?? '',
                  countOf(t, p.skillCount, 'providers.skillCount.one', 'providers.skillCount.many'),
                  t('providers.lastSynced', { age: formatLastSync(p.lastRefresh, Date.now(), t) }),
                ].filter(Boolean).join(' · ')}
              </div>
              {p.error !== undefined && <div className={styles.errText}>{p.error}</div>}
            </div>
            {refreshingId === p.id ? (
              <span className={styles.refreshing} data-testid="skills-provider-refreshing">
                <span className={styles.spinner} aria-hidden="true" />
                {t('providers.refreshing')}
              </span>
            ) : (
              <button
                type="button"
                className={styles.ghostDanger}
                disabled={busy}
                onClick={() => setConfirmRemoveProvider(p)}
                data-testid="skills-provider-remove"
              >{t('providers.remove')}</button>
            )}
          </div>
        </div>
      )))}

      {modalDialog()}
      {detailDialog()}
      {confirmDeleteDialog()}
      {confirmRemoveProviderDialog()}
    </div>
  )
}
