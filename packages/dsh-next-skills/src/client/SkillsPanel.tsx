/**
 * The Skills settings page rendered in the `settings.section` slot — the
 * sibling of the Claude Plugins page (CcPanel) and styled by the same shared
 * chrome: `card.module.css` mirrors cc-plugins' module byte-for-byte on every
 * shared class, so the two settings pages read as one product.
 *
 *  - Skills: every discovered skill (project, custom, and user roots) plus
 *    every provider catalog skill in one two-column card grid — rows that
 *    exist on disk first, each group alphabetical, with a provider filter, a
 *    search box, and an installed-only toggle. Each card opens the scope
 *    modal: a radio picks where the skill is enabled — Global (the default,
 *    everywhere) or only in a checklist of workspaces — and installing or
 *    saving applies that scope as pure configuration (enable/disable never
 *    writes skill files; skills install once, into the global root). A
 *    managed card with a newer catalog version carries an Update button, and
 *    the modal manages scope, updates, and uninstalling it (two-step
 *    confirm). The name button opens the skill's full SKILL.md rendered as
 *    markdown.
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

/** Cards rendered before the "Show more" button appends the next page. */
const PAGE_SIZE = 30

/** Mutations whose success changes the skill set the chat UI surfaces. */
const CATALOG_MUTATIONS = new Set(['installSkill', 'setSkillScope', 'updateSkill', 'uninstallSkill', 'addProvider', 'removeProvider'])

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
  /** The modal's radio: global (default) or a workspace whitelist. */
  const [scopeMode, setScopeMode] = React.useState<'global' | 'workspaces'>('global')
  /** Checked workspace names while the modal is in workspaces mode. */
  const [checked, setChecked] = React.useState<Set<string>>(new Set())
  /** Two-step uninstall confirm inside the modal. */
  const [confirmUninstall, setConfirmUninstall] = React.useState(false)
  /** The open detail modal's entry plus its loaded content. */
  const [detail, setDetail] = React.useState<GridEntry | undefined>()
  const [detailData, setDetailData] = React.useState<SkillDetail | undefined>()
  const [addSpec, setAddSpec] = React.useState('')
  const workspaces = deps.getWorkspaces()
  // Key the memo on the joined paths, not the array: the workspace reader
  // returns a fresh array on every call, so an identity dep would re-run
  // every callback and effect on every render (an endless refetch loop the
  // detail modal once died in).
  const workspacePathsKey = workspaces.map((w) => w.path).join('\n')
  const workspacePaths = React.useMemo(
    () => workspaces.map((w) => w.path),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspacePathsKey],
  )

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
        setMessage({ ok: true, text: result.warning ?? t('status.done') })
        if (CATALOG_MUTATIONS.has(method)) deps.notifyInstalledChanged?.()
        setConfirmUninstall(false)
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
    setConfirmUninstall(false)
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
    setConfirmUninstall(false)
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
    const removable = row?.managed === true
    const canUpdate = removable === true && row?.updateAvailable === true && row.scope === 'global'
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
    const pick = (mode: 'global' | 'workspaces') => (): void => { setScopeMode(mode); setConfirmUninstall(false) }
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
            <div className={styles.optionList} data-testid="skills-workspaces">
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
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.ghost}
              disabled={busy}
              onClick={closeModal}
            >{t('modal.cancel')}</button>
            {canUpdate && (
              <button
                type="button"
                className={styles.ghost}
                disabled={busy}
                onClick={() => { void mutate('updateSkill', { name: modal.name }); closeModal() }}
                data-testid="skills-modal-update"
              >{t('modal.update')}</button>
            )}
            {removable && (
              confirmUninstall ? (
                <button
                  type="button"
                  className={`${styles.danger} ${styles.optionAction}`}
                  disabled={busy}
                  onClick={() => { void mutate('uninstallSkill', { name: modal.name }); closeModal() }}
                  data-testid="skills-uninstall-confirm"
                >{t('modal.confirmUninstall')}</button>
              ) : (
                <button
                  type="button"
                  className={`${styles.ghostDanger} ${styles.optionAction}`}
                  disabled={busy}
                  onClick={() => setConfirmUninstall(true)}
                  data-testid="skills-uninstall"
                >{t('modal.uninstall')}</button>
              )
            )}
            <button
              type="button"
              className={styles.primary}
              // An empty whitelist is meaningful: it disables the skill
              // everywhere, so the confirm never disables itself.
              disabled={busy}
              onClick={confirmModal}
              data-testid="skills-modal-confirm"
            >{row !== undefined ? t('modal.save') : t('card.add')}</button>
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

  return (
    <div className={styles.page}>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'skills'}
          className={tab === 'skills' ? styles.tabActive : styles.tab}
          onClick={() => setTab('skills')}
          data-testid="skills-tab-skills"
        >{t('tab.skills')}</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'providers'}
          className={tab === 'providers' ? styles.tabActive : styles.tab}
          onClick={() => setTab('providers')}
          data-testid="skills-tab-providers"
        >{t('tab.providers')}</button>
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
          {filtered.slice(0, visible).map((entry) => {
            const row = entry.row
            const installedHere = row !== undefined
            const project = installedHere && row.scope === 'workspace'
            const unmanagedCustom = installedHere && !project && row.managed === false && row.provider === undefined && entry.catalog === undefined
            // The Update button only applies to the global install; a
            // workspace-scoped managed skill flags the newer version instead.
            const updateFlagged = installedHere && row.updateAvailable === true && row.scope !== 'global'
            const presenceTitle = installedHere && row.configScope !== undefined ? row.configScope.join('\n') : undefined
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
                    </div>
                    <div className={styles.desc}>{entry.description !== '' ? entry.description : t('card.noDescription')}</div>
                  </div>
                  {installedHere && (
                    <div className={styles.badges}>
                      <span className={styles.presenceBadge} data-testid="skills-presence" title={presenceTitle}>
                        {presenceLabel(row.configScope, t)}
                      </span>
                      {project && <span className={styles.projectChip}>{t('badge.project')}</span>}
                      {unmanagedCustom && <span className={styles.customBadge}>{t('badge.custom')}</span>}
                      {updateFlagged && <span className={styles.updateChip}>{t('card.updateAvailable')}</span>}
                    </div>
                  )}
                </div>
                <div className={styles.pluginCardTop}>
                  {entry.providerSpec !== undefined && <span className={styles.providerChip}>{entry.providerSpec}</span>}
                  <div className={styles.rowActions}>
                    {installedHere && row.updateAvailable === true && row.scope === 'global' && (
                      <button
                        type="button"
                        className={styles.ghost}
                        disabled={busy}
                        onClick={() => { void mutate('updateSkill', { name: entry.name }) }}
                        data-testid="skills-update"
                      >{t('card.update')}</button>
                    )}
                    <button
                      type="button"
                      className={installedHere ? styles.ghost : styles.primary}
                      disabled={busy}
                      onClick={() => openModal(entry)}
                      data-testid="skills-add"
                    >{installedHere ? t('card.manage') : t('card.add')}</button>
                  </div>
                </div>
              </div>
            )
          })}
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
            onClick={() => void mutate('refreshProviders')}
            data-testid="skills-provider-refresh-all"
          >{t('providers.refreshAll')}</button>
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
            <button
              type="button"
              className={styles.ghostDanger}
              disabled={busy}
              onClick={() => { void mutate('removeProvider', { providerId: p.id }) }}
              data-testid="skills-provider-remove"
            >{t('providers.remove')}</button>
          </div>
        </div>
      )))}

      {modalDialog()}
      {detailDialog()}
    </div>
  )
}
