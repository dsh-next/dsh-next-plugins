/**
 * The Claude Plugins settings panel rendered in the `settings.section` slot:
 * a whole settings page with two tabs over the Host JSON RPC.
 *
 *  - Plugins: every plugin across all marketplaces in a two-column card grid
 *    (installed plugins first, each group alphabetical by name) with a
 *    provider (marketplace) filter, a search box, and an
 *    installed-only toggle. Installed cards carry their installed version and
 *    an Update button whenever the (auto-refreshed) marketplace snapshot
 *    offers a newer one. Each card opens the scope modal: a radio picks
 *    where the plugin works — Global (the default, everywhere) or
 *    Workspaces (a checklist of the registered workspaces appears) — and
 *    installing or saving applies that scope. For an installed plugin the
 *    same modal manages the scope (saving re-scopes it), updates it, and
 *    uninstalls it after a two-step confirm.
 *  - Marketplaces: source management (add by owner/repo shorthand, GitHub
 *    URL, or local path; refresh; remove) with per-source last-synced age.
 *    Snapshots older than 24 hours re-sync automatically when the panel
 *    opens (Host `getState`), so versions stay current without a timer.
 *  - Models: map the Claude model names your agents use onto models the
 *    runtime actually offers (discovered live from the llm service). Every
 *    alias defaults to inheriting the delegating session's model; values
 *    from the composition config show as a preset baseline. Saving
 *    re-resolves installed agent rows without reinstalling.
 *
 * Skills land per scope (the global root or each checked workspace's own
 * root); MCP servers, agent rows, commands, and hooks are plugin-level and
 * activate once regardless of scope — the modal states this so the scope
 * picker never over-promises.
 *
 * Every user-facing string rides the `t` translator (the platform locale
 * service bound to this package's namespace; English without it). The
 * exported formatters take `t` as an optional last argument defaulting to
 * English, so their standalone behavior is unchanged.
 */
import * as React from 'react'
import type {
  CcState,
  InstalledPlugin,
  MarketplacePluginView,
  MarketplaceViewRow,
  MutationResult,
  PluginInventory,
  WorkspaceRow,
} from '../core/types.ts'
import { englishTranslate, type MessageKey } from './dictionaries.ts'
import styles from './card.module.css'

/** Translates a dictionary key with `{name}` params (platform semantics). */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

export interface CcPanelDeps {
  rpc: (method: string, args?: unknown) => Promise<unknown>
  getWorkspaces: () => WorkspaceRow[]
  /** Signals the browser that the installed skill catalog changed. */
  notifyInstalledChanged?: () => void
  /** Locale-bound translator; defaults to English when omitted (tests). */
  t?: Translate
}

type Tab = 'plugins' | 'marketplaces' | 'models'

/** Mutations whose success changes the installed skill set the chat UI surfaces. */
const CATALOG_MUTATIONS = new Set(['installPlugin', 'setPluginScope', 'uninstallPlugin', 'updatePlugin'])

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

/** Component-count summary line, e.g. "2 skills, 1 MCP server, not bridged:
 *  1 LSP server". The trailing group names the Claude Code component
 *  families an install deliberately leaves out. */
export function inventorySummary(inventory: PluginInventory, t: Translate = englishTranslate): string {
  const parts = [
    inventory.skills.length > 0 ? countOf(t, inventory.skills.length, 'summary.skill.one', 'summary.skill.many') : '',
    inventory.mcpServers.length > 0 ? countOf(t, inventory.mcpServers.length, 'summary.mcp.one', 'summary.mcp.many') : '',
    inventory.commands.length > 0 ? countOf(t, inventory.commands.length, 'summary.command.one', 'summary.command.many') : '',
    inventory.agents.length > 0 ? countOf(t, inventory.agents.length, 'summary.agent.one', 'summary.agent.many') : '',
    inventory.hookEvents.length > 0 ? countOf(t, inventory.hookEvents.length, 'summary.hook.one', 'summary.hook.many') : '',
    unbridgedSummary(inventory.unbridged, t),
    inventory.dependencies.length > 0 ? t('summary.requires', { deps: inventory.dependencies.join(', ') }) : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : t('summary.noComponents')
}

/** "not bridged: 2 LSP servers, 1 monitor" — '' when everything bridges. */
export function unbridgedSummary(unbridged: PluginInventory['unbridged'], t: Translate = englishTranslate): string {
  const labels: Array<[keyof PluginInventory['unbridged'] & string, [MessageKey, MessageKey]]> = [
    ['lspServers', ['unbridged.lsp.one', 'unbridged.lsp.many']],
    ['monitors', ['unbridged.monitors.one', 'unbridged.monitors.many']],
    ['outputStyles', ['unbridged.outputStyles.one', 'unbridged.outputStyles.many']],
    ['themes', ['unbridged.themes.one', 'unbridged.themes.many']],
    ['workflows', ['unbridged.workflows.one', 'unbridged.workflows.many']],
    ['executables', ['unbridged.executables.one', 'unbridged.executables.many']],
    ['settings', ['unbridged.settings.one', 'unbridged.settings.many']],
  ]
  const parts: string[] = []
  for (const [key, [one, many]] of labels) {
    const count = unbridged[key]
    if (count === undefined || count <= 0) continue
    parts.push(countOf(t, count, one, many))
  }
  return parts.length > 0 ? t('unbridged.prefix') + parts.join(', ') : ''
}

/** Where a plugin's skills are installed: the scope as a readable label. */
export function presenceLabel(record: InstalledPlugin, workspaces: ReadonlyArray<WorkspaceRow>, t: Translate = englishTranslate): string {
  if (record.scope.kind === 'global') return t('presence.in', { targets: t('presence.global') })
  const parts = record.scope.workspacePaths.map((path) => {
    const row = workspaces.find((w) => w.path === path)
    if (row !== undefined) return row.title
    const base = path.split('/').filter(Boolean).pop() ?? path
    return base
  })
  return parts.length > 0 ? t('presence.in', { targets: parts.join(', ') }) : t('presence.installed')
}

/** Relative age of a marketplace's last sync, e.g. "3h ago" or "never". */
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

export function CcPanel(deps: CcPanelDeps): React.ReactElement {
  const t = deps.t ?? englishTranslate
  const [tab, setTab] = React.useState<Tab>('plugins')
  const [state, setState] = React.useState<CcState | undefined>()
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | undefined>()
  const [spec, setSpec] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [providerFilter, setProviderFilter] = React.useState('')
  const [installedOnly, setInstalledOnly] = React.useState(false)
  /** The open scope modal's plugin (marketplace + catalog entry). */
  const [modal, setModal] = React.useState<{ marketplaceId: string; plugin: MarketplacePluginView } | undefined>()
  /** The open detail modal's plugin (same identity shape). */
  const [detail, setDetail] = React.useState<{ marketplaceId: string; plugin: MarketplacePluginView } | undefined>()
  /** The modal's radio: global (default) or workspaces. */
  const [scopeMode, setScopeMode] = React.useState<'global' | 'workspaces'>('global')
  /** Checked workspace paths while the modal is in workspaces mode. */
  const [checked, setChecked] = React.useState<Set<string>>(new Set())
  /** Two-step uninstall confirm inside the modal. */
  const [confirmUninstall, setConfirmUninstall] = React.useState(false)
  /** Unsaved Models-tab selections, alias to model id ('' = inherit). */
  const [modelDraft, setModelDraft] = React.useState<Record<string, string>>({})
  const workspaces = deps.getWorkspaces()

  const refresh = React.useCallback(async (): Promise<void> => {
    try {
      const next = await deps.rpc('getState') as CcState
      setState(next)
    } catch (error) {
      setMessage({ ok: false, text: errMsg(error) })
    }
  }, [deps])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (modal === undefined && detail === undefined) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { closeModal(); setDetail(undefined) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, detail])

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
        setMessage({ ok: true, text: result.message ?? 'done' })
        if (CATALOG_MUTATIONS.has(method)) deps.notifyInstalledChanged?.()
        setConfirmUninstall(false)
      }
    } catch (error) {
      setMessage({ ok: false, text: errMsg(error) })
    } finally {
      setBusy(false)
    }
  }

  const addMarketplace = async (): Promise<void> => {
    if (spec.trim() === '') return
    await mutate('addMarketplace', { spec: spec.trim() })
    setSpec('')
  }

  const marketplaces: MarketplaceViewRow[] = state?.marketplaces ?? []
  const installed: InstalledPlugin[] = state?.installed ?? []
  const models = state?.models ?? []
  const byKey = React.useMemo(() => new Map(installed.map((r) => [r.key, r])), [installed])

  const closeModal = (): void => {
    setModal(undefined)
    setScopeMode('global')
    setChecked(new Set())
    setConfirmUninstall(false)
  }

  /** Open the scope modal; an installed plugin starts on its current scope. */
  const openModal = (marketplaceId: string, plugin: MarketplacePluginView, record: InstalledPlugin | undefined): void => {
    setModal({ marketplaceId, plugin })
    if (record?.scope.kind === 'workspaces') {
      setScopeMode('workspaces')
      setChecked(new Set(record.scope.workspacePaths))
    } else {
      setScopeMode('global')
      setChecked(new Set())
    }
    setConfirmUninstall(false)
  }

  const toggleWorkspace = (path: string): void => {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** Install (fresh) or re-scope (installed) with the drafted scope. */
  const confirmModal = (key: string, installed: boolean): void => {
    if (modal === undefined) return
    if (scopeMode === 'workspaces' && checked.size === 0) return
    const scope = scopeMode === 'global'
      ? { kind: 'global' }
      : { kind: 'workspaces', workspacePaths: [...checked] }
    if (installed) void mutate('setPluginScope', { key, scope })
    else void mutate('installPlugin', { marketplaceId: modal.marketplaceId, plugin: modal.plugin.name, scope })
    closeModal()
  }

  /**
   * Save the Models tab as a delta over the saved overrides: only drafted
   * aliases change, other saved entries persist verbatim. Choosing inherit
   * on a config-mapped alias saves the explicit `null` marker (which
   * suppresses the baseline); on an alias without a baseline it just drops
   * the entry — inherit is already the default.
   */
  const saveModels = async (): Promise<void> => {
    const overrides = state?.agentModelOverrides ?? {}
    const config = state?.agentModelConfig ?? {}
    const map: Record<string, string | null> = { ...overrides }
    for (const [alias, value] of Object.entries(modelDraft)) {
      if (value === '') {
        if (config[alias] !== undefined) map[alias] = null
        else delete map[alias]
      } else {
        map[alias] = value
      }
    }
    await mutate('setAgentModelOverrides', { map })
    setModelDraft({})
  }

  // The flat plugin catalog across every marketplace, filtered in-panel.
  const catalog = React.useMemo(() => marketplaces.flatMap((m) => m.plugins.map((p) => ({ marketplace: m, plugin: p }))), [marketplaces])
  // Distinct model ids across providers (an id may ride several routes; the
  // agent row carries the bare id, so one option per id is the honest set).
  const uniqueModels = React.useMemo(() => {
    const seen = new Set<string>()
    const out: typeof models = []
    for (const m of models) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      out.push(m)
    }
    return out
  }, [models])
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const hits = catalog.filter(({ marketplace, plugin }) => {
      if (providerFilter !== '' && marketplace.id !== providerFilter) return false
      if (installedOnly && !byKey.has(`${marketplace.id}/${plugin.name}`)) return false
      if (q !== '' && !`${plugin.name} ${plugin.description} ${marketplace.name}`.toLowerCase().includes(q)) return false
      return true
    })
    // Installed plugins first; within each group by name asc, with the
    // marketplace id as a stable tie-break for one name in two marketplaces.
    return [...hits].sort((a, b) => {
      const ai = byKey.has(`${a.marketplace.id}/${a.plugin.name}`) ? 0 : 1
      const bi = byKey.has(`${b.marketplace.id}/${b.plugin.name}`) ? 0 : 1
      if (ai !== bi) return ai - bi
      const byName = a.plugin.name.localeCompare(b.plugin.name)
      if (byName !== 0) return byName
      return a.marketplace.id.localeCompare(b.marketplace.id)
    })
  }, [catalog, providerFilter, installedOnly, search, byKey])

  /** The scope modal: one radio — Global (default) or Workspaces — and a
   *  workspace checklist under the workspaces mode. Either/or, never a mix. */
  const modalDialog = (): React.ReactElement | null => {
    if (modal === undefined) return null
    const key = `${modal.marketplaceId}/${modal.plugin.name}`
    const record = byKey.get(key)
    const installed = record !== undefined
    // Checklist rows: the registry's workspaces plus any recorded path the
    // registry no longer knows (so it stays visible and can be unchecked).
    const rows: Array<{ path: string; title: string; missing: boolean }> = [
      ...workspaces.map((w) => ({ path: w.path, title: w.title, missing: false })),
      ...(record?.scope.kind === 'workspaces' ? record.scope.workspacePaths : [])
        .filter((p) => !workspaces.some((w) => w.path === p))
        .map((p) => ({ path: p, title: p, missing: true })),
    ]
    return (
      <div className={styles.overlay} role="presentation" onClick={closeModal}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-label={t('modal.aria', { name: modal.plugin.name })}
          data-testid="cc-modal"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <p className={styles.modalTitle}>
            {`${modal.plugin.name}${record !== undefined && record.version !== '' ? ` (${t('card.installedVersion', { version: record.version })})` : ''}${modal.plugin.updateAvailable === true && modal.plugin.version !== '' ? ` — ${t('modal.available', { version: modal.plugin.version })}` : ''}`}
          </p>
          <p className={styles.modalHint}>{t('modal.hint')}</p>
          <div className={styles.optionList} data-testid="cc-scope">
            <label className={styles.optionRow} data-testid="cc-scope-global">
              <input
                type="radio"
                name="cc-plugin-scope"
                checked={scopeMode === 'global'}
                disabled={busy}
                onChange={() => { setScopeMode('global'); setConfirmUninstall(false) }}
              />
              <span className={styles.optionLabel}>{t('modal.scope.global')}</span>
            </label>
            <label className={styles.optionRow} data-testid="cc-scope-workspaces">
              <input
                type="radio"
                name="cc-plugin-scope"
                checked={scopeMode === 'workspaces'}
                disabled={busy}
                onChange={() => { setScopeMode('workspaces'); setConfirmUninstall(false) }}
              />
              <span className={styles.optionLabel}>{t('modal.scope.workspaces')}</span>
            </label>
          </div>
          {scopeMode === 'workspaces' && (
            <div className={styles.optionList} data-testid="cc-workspaces">
              {rows.length === 0 ? (
                <p className={styles.modalHint}>{t('modal.workspaces.empty')}</p>
              ) : rows.map((row) => (
                <label key={row.path} className={styles.optionRow} data-testid="cc-workspace">
                  <input
                    type="checkbox"
                    checked={checked.has(row.path)}
                    disabled={busy}
                    onChange={() => toggleWorkspace(row.path)}
                  />
                  <span className={styles.optionLabel}>{row.title}</span>
                  {row.missing && <span className={styles.addedBadge}>{t('modal.workspaceMissing')}</span>}
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
            {installed && (
              <button
                type="button"
                className={styles.ghost}
                disabled={busy}
                onClick={() => { void mutate('updatePlugin', { key }); closeModal() }}
              >{t('modal.update')}</button>
            )}
            {installed && (
              confirmUninstall ? (
                <button
                  type="button"
                  className={`${styles.danger} ${styles.optionAction}`}
                  disabled={busy}
                  onClick={() => { void mutate('uninstallPlugin', { key }); closeModal() }}
                  data-testid="cc-uninstall-confirm"
                >{t('modal.confirmUninstall')}</button>
              ) : (
                <button
                  type="button"
                  className={`${styles.ghostDanger} ${styles.optionAction}`}
                  disabled={busy}
                  onClick={() => setConfirmUninstall(true)}
                  data-testid="cc-uninstall"
                >{t('modal.uninstall')}</button>
              )
            )}
            <button
              type="button"
              className={styles.primary}
              disabled={busy || (scopeMode === 'workspaces' && checked.size === 0)}
              onClick={() => confirmModal(key, installed)}
              data-testid="cc-modal-confirm"
            >{installed ? t('modal.save') : t('card.add')}</button>
          </div>
        </div>
      </div>
    )
  }

  /**
   * The detail modal: everything the catalog and the installed record know
   * about one plugin — metadata, the full component listing (including the
   * families this bridge does not install), and the persisted notes.
   */
  const detailDialog = (): React.ReactElement | null => {
    if (detail === undefined) return null
    const key = `${detail.marketplaceId}/${detail.plugin.name}`
    const record = byKey.get(key)
    const inv = detail.plugin.inventory
    const marketplace = marketplaces.find((m) => m.id === detail.marketplaceId)
    const section = (label: string, values: readonly string[]): React.ReactElement | null =>
      values.length === 0 ? null : (
        <li><strong>{label}:</strong> {values.join(', ')}</li>
      )
    return (
      <div className={styles.overlay} role="presentation" onClick={() => setDetail(undefined)}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-label={t('detail.aria', { name: detail.plugin.name })}
          data-testid="cc-plugin-detail"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <p className={styles.modalTitle}>{detail.plugin.name}</p>
          <p className={styles.modalHint}>
            {[
              detail.plugin.version !== '' ? t('detail.version', { version: detail.plugin.version }) : '',
              record !== undefined && record.version !== '' ? t('card.installedVersion', { version: record.version }) : t('detail.notInstalled'),
              marketplace !== undefined ? t('detail.from', { marketplace: marketplace.name }) : '',
            ].filter(Boolean).join(' — ')}
          </p>
          {detail.plugin.description !== '' && <p className={styles.modalHint}>{detail.plugin.description}</p>}
          <ul className={styles.detailList}>
            {detail.plugin.author !== '' ? <li><strong>{t('detail.author')}:</strong> {detail.plugin.author}</li> : null}
            {detail.plugin.homepage !== '' ? <li><strong>{t('detail.homepage')}:</strong> {detail.plugin.homepage}</li> : null}
            {detail.plugin.category !== '' ? <li><strong>{t('detail.category')}:</strong> {detail.plugin.category}</li> : null}
            {detail.plugin.tags.length > 0 ? <li><strong>{t('detail.tags')}:</strong> {detail.plugin.tags.join(', ')}</li> : null}
          </ul>
          {detail.plugin.sourceUnsupported !== undefined && (
            <p className={styles.modalHint}>{t('card.notInstallable', { reason: detail.plugin.sourceUnsupported })}</p>
          )}
          {inv === undefined ? (
            <p className={styles.modalHint}>{t('card.resolveOnInstall')}</p>
          ) : (
            <ul className={styles.detailList} data-testid="cc-detail-components">
              {section(t('detail.skills'), inv.skills.map((s) => s.name))}
              {section(t('detail.commands'), inv.commands.map((c) => c.name))}
              {section(t('detail.agents'), inv.agents.map((a) => a.name))}
              {section(t('detail.mcpServers'), inv.mcpServers.map((m) => m.name))}
              {section(t('detail.hookEvents'), inv.hookEvents)}
              {unbridgedSummary(inv.unbridged, t) !== '' ? <li><strong>{t('detail.notBridged')}:</strong> {unbridgedSummary(inv.unbridged, t).replace(t('unbridged.prefix'), '')}</li> : null}
              {section(t('detail.requires'), inv.dependencies)}
              {section(t('detail.inventoryNotes'), inv.notes)}
            </ul>
          )}
          {record !== undefined && (
            <>
              <p className={styles.modalHint}>{presenceLabel(record, workspaces, t)}</p>
              {(record.notes ?? []).length > 0 && (
                <ul className={styles.detailList} data-testid="cc-detail-notes">
                  {(record.notes ?? []).map((note) => <li key={note}>{note}</li>)}
                </ul>
              )}
            </>
          )}
          <div className={styles.modalActions}>
            <button type="button" className={styles.ghost} onClick={() => setDetail(undefined)} data-testid="cc-detail-close">{t('detail.close')}</button>
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
          aria-selected={tab === 'plugins'}
          className={tab === 'plugins' ? styles.tabActive : styles.tab}
          onClick={() => setTab('plugins')}
        >{t('tab.plugins')}</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'marketplaces'}
          className={tab === 'marketplaces' ? styles.tabActive : styles.tab}
          onClick={() => setTab('marketplaces')}
        >{t('tab.marketplaces')}</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'models'}
          className={tab === 'models' ? styles.tabActive : styles.tab}
          onClick={() => setTab('models')}
        >{t('tab.models')}</button>
      </div>

      {message !== undefined && (
        <div className={message.ok ? styles.noticeOk : styles.noticeErr} data-testid="cc-message">{message.text}</div>
      )}

      {(state?.importSkipped ?? []).length > 0 && (
        <div className={styles.empty} data-testid="cc-import-skipped">
          {t('import.skipped', { count: state?.importSkipped.length ?? 0, items: (state?.importSkipped ?? []).join('; ') })}
        </div>
      )}

      {tab === 'plugins' && (
        <div className={styles.filterRow}>
          <input
            type="search"
            className={styles.input}
            placeholder={t('search.placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="cc-search"
          />
          <select
            className={styles.select}
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            aria-label={t('provider.aria')}
            data-testid="cc-provider"
          >
            <option value="">{t('provider.all')}</option>
            {marketplaces.map((m) => (
              <option key={m.id} value={m.id}>{m.spec}</option>
            ))}
          </select>
          <label className={styles.toggleWrap}>
            <input
              type="checkbox"
              checked={installedOnly}
              onChange={(e) => setInstalledOnly(e.target.checked)}
              data-testid="cc-installed-only"
            />
            {t('filter.installedOnly')}
          </label>
        </div>
      )}

      {tab === 'plugins' && (marketplaces.length === 0 ? (
        <div className={styles.empty} data-testid="cc-empty">
          {t('empty.noMarketplacesPlugins')}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty} data-testid="cc-empty">{t('empty.noMatch')}</div>
      ) : (
        <div className={styles.pluginGrid} data-testid="cc-plugins">
          {filtered.map(({ marketplace, plugin }) => {
            const key = `${marketplace.id}/${plugin.name}`
            const record = byKey.get(key)
            return (
              <div key={key} className={styles.pluginCard} data-testid="cc-plugin">
                <div className={styles.pluginCardTop}>
                  <div className={styles.headText}>
                    <div className={styles.pluginName}>
                      <button
                        type="button"
                        className={styles.nameButton}
                        title={t('card.detailsTitle', { key })}
                        onClick={() => setDetail({ marketplaceId: marketplace.id, plugin })}
                        data-testid="cc-detail"
                      >{plugin.name}</button>
                      {plugin.version !== '' && <span className={styles.version}> {plugin.version}</span>}
                    </div>
                    <div className={styles.desc}>{plugin.description !== '' ? plugin.description : t('card.noDescription')}</div>
                    <div className={styles.desc}>
                      {plugin.inventory !== undefined ? inventorySummary(plugin.inventory, t)
                        : plugin.sourceUnsupported !== undefined ? t('card.notInstallable', { reason: plugin.sourceUnsupported })
                          : t('card.resolveOnInstall')}
                    </div>
                  </div>
                  {record !== undefined && (
                    <div className={styles.badges}>
                      <span className={styles.presenceBadge}>{presenceLabel(record, workspaces, t)}</span>
                      {plugin.installedVersion !== undefined && (
                        <span className={styles.installedChip} data-testid="cc-installed-version">
                          {t('card.installedVersion', { version: plugin.installedVersion })}
                        </span>
                      )}
                      {(record.notes ?? []).length > 0 && (
                        <span className={styles.notesChip} data-testid="cc-notes-chip" title={(record.notes ?? []).join('\n')}>
                          {countOf(t, (record.notes ?? []).length, 'card.noteCount.one', 'card.noteCount.many')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className={styles.pluginCardTop}>
                  <span className={styles.marketplaceChip}>{marketplace.name}</span>
                  <div className={styles.rowActions}>
                    {plugin.updateAvailable === true && record !== undefined && (
                      <button
                        type="button"
                        className={styles.ghost}
                        disabled={busy}
                        title={t('card.updateTitle', { key, version: plugin.version !== '' ? plugin.version : 'latest' })}
                        onClick={() => { void mutate('updatePlugin', { key }) }}
                        data-testid="cc-update"
                      >{t('card.update')}</button>
                    )}
                    <button
                      type="button"
                      className={record !== undefined ? styles.ghost : styles.primary}
                      disabled={busy || plugin.sourceUnsupported !== undefined}
                      title={key}
                      onClick={() => openModal(marketplace.id, plugin, record)}
                      data-testid="cc-add"
                    >{record !== undefined ? t('card.manage') : t('card.add')}</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {tab === 'marketplaces' && (
        <div className={styles.addRow}>
          <input
            className={styles.input}
            placeholder={t('marketplaces.placeholder')}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addMarketplace()
            }}
            data-testid="cc-add-input"
          />
          <button type="button" className={styles.primary} disabled={busy || spec.trim() === ''} onClick={() => void addMarketplace()}>{t('marketplaces.add')}</button>
          <button type="button" className={styles.ghost} disabled={busy || marketplaces.length === 0} onClick={() => void mutate('refreshMarketplaces')}>{t('marketplaces.refreshAll')}</button>
        </div>
      )}

      {tab === 'marketplaces' && (
        <div className={styles.hint}>{t('marketplaces.hint')}</div>
      )}

      {tab === 'marketplaces' && (marketplaces.length === 0 ? (
        <div className={styles.empty} data-testid="cc-empty">{t('empty.noMarketplacesSources')}</div>
      ) : marketplaces.map((m) => (
        <div key={m.id} className={styles.card} data-testid="cc-marketplace">
          <div className={styles.marketHead}>
            <div className={styles.headText}>
              <div className={styles.name}>{m.name}</div>
              <div className={styles.desc}>
                {m.spec}
                {m.description !== '' ? ` — ${m.description}` : ''}
                {m.owner !== '' ? ` ${t('marketplaces.by', { owner: m.owner })}` : ''}
                {` · ${countOf(t, m.plugins.length, 'marketplaces.pluginCount.one', 'marketplaces.pluginCount.many')}`}
                {` · ${t('marketplaces.lastSynced', { age: formatLastSync(m.lastSync, Date.now(), t) })}`}
              </div>
              {m.error !== undefined && <div className={styles.errText}>{m.error}</div>}
            </div>
            <button
              type="button"
              className={styles.ghostDanger}
              disabled={busy}
              onClick={() => void mutate('removeMarketplace', { marketplaceId: m.id })}
            >{t('marketplaces.remove')}</button>
          </div>
        </div>
      )))}

      {tab === 'models' && (
        <div className={styles.modelList} data-testid="cc-models">
          <div className={styles.hint}>
            {t('models.hint')}
          </div>
          {(state?.agentModelAliases ?? []).map((alias) => {
            const override = (state?.agentModelOverrides ?? {})[alias]
            const effective = state?.agentModelMap[alias] ?? ''
            // Display precedence: unsaved draft, then the saved override
            // (null shows as inherit), then the config baseline, then inherit.
            const current = modelDraft[alias] !== undefined
              ? modelDraft[alias]
              : override !== undefined ? (override ?? '') : effective
            const fromConfig = (state?.agentModelConfig ?? {})[alias] !== undefined && effective !== ''
            const known = uniqueModels.some((m) => m.id === current)
            return (
              <div key={alias} className={styles.optionRow} data-testid="cc-model-row">
                <span className={styles.optionLabel}>{alias}</span>
                {fromConfig && <span className={styles.configChip}>{t('models.config')}</span>}
                <select
                  className={styles.select}
                  aria-label={t('models.selectAria', { alias })}
                  data-testid="cc-model-select"
                  value={current}
                  onChange={(e) => setModelDraft({ ...modelDraft, [alias]: e.target.value })}
                >
                  <option value="">{t('models.inherit')}</option>
                  {uniqueModels.map((m) => (
                    <option key={`${m.provider}/${m.id}`} value={m.id}>{`${m.name} (${m.provider})`}</option>
                  ))}
                  {current !== '' && !known && <option value={current}>{current}</option>}
                </select>
              </div>
            )
          })}
          <div className={styles.addRow}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void saveModels()}
              data-testid="cc-model-save"
            >{t('models.save')}</button>
          </div>
        </div>
      )}

      {modalDialog()}
      {detailDialog()}
    </div>
  )
}
