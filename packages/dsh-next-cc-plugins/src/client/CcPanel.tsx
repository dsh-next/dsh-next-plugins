/**
 * The Claude Plugins settings panel rendered in the `settings.section` slot:
 * a whole settings page with two tabs over the Host JSON RPC.
 *
 *  - Plugins: every plugin across all marketplaces in a two-column card grid
 *    (installed plugins first, each group alphabetical by name) with a
 *    provider (marketplace) filter, a search box, and an
 *    installed-only toggle. Installed cards carry their installed version and
 *    an Update button whenever the (auto-refreshed) marketplace snapshot
 *    offers a newer one. Each card opens the Add/Manage modal: pick any
 *    combination of the global root and workspaces as install targets
 *    (targets already holding the plugin are locked with an "added" badge
 *    and offer their own uninstall), plus Update everywhere.
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
 * Skills land per selected target; MCP servers, agent rows, commands, and
 * hooks are plugin-level and activate once regardless of target count — the
 * modal states this so the scope picker never over-promises.
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
import styles from './card.module.css'

export interface CcPanelDeps {
  rpc: (method: string, args?: unknown) => Promise<unknown>
  getWorkspaces: () => WorkspaceRow[]
  /** Signals the browser that the installed skill catalog changed. */
  notifyInstalledChanged?: () => void
}

type Tab = 'plugins' | 'marketplaces' | 'models'

/** Mutations whose success changes the installed skill set the chat UI surfaces. */
const CATALOG_MUTATIONS = new Set(['installPlugin', 'uninstallPlugin', 'updatePlugin'])

function isMutationError(result: unknown): result is { ok: false; error: string } {
  return !!result && typeof result === 'object' && (result as { ok?: unknown }).ok === false
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Component-count summary line, e.g. "2 skills, 1 MCP server, 3 commands pending". */
export function inventorySummary(inventory: PluginInventory): string {
  const parts = [
    inventory.skills.length > 0 ? `${inventory.skills.length} skill${inventory.skills.length === 1 ? '' : 's'}` : '',
    inventory.mcpServers.length > 0 ? `${inventory.mcpServers.length} MCP server${inventory.mcpServers.length === 1 ? '' : 's'}` : '',
    inventory.commands.length > 0 ? `${inventory.commands.length} command${inventory.commands.length === 1 ? '' : 's'}` : '',
    inventory.agents.length > 0 ? `${inventory.agents.length} agent tool${inventory.agents.length === 1 ? '' : 's'}` : '',
    inventory.hookEvents.length > 0 ? `${inventory.hookEvents.length} hook event${inventory.hookEvents.length === 1 ? '' : 's'} (enable runtime.hooks)` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'no components'
}

/** Where a plugin's skills are installed, across every target. */
export function presenceLabel(record: InstalledPlugin, workspaces: ReadonlyArray<WorkspaceRow>): string {
  const parts: string[] = []
  const global = record.targets.some((t) => t.scope === 'global')
  const ws = record.targets.filter((t) => t.scope === 'workspace')
  if (global) parts.push('global')
  if (ws.length > 0) {
    const titles = ws.map((t) => workspaces.find((w) => w.path === t.workspacePath)?.title ?? 'workspace')
    parts.push(...titles)
  }
  return parts.length > 0 ? `in ${parts.join(' + ')}` : 'installed'
}

/** Relative age of a marketplace's last sync, e.g. "3h ago" or "never". */
export function formatLastSync(iso: string, now: number = Date.now()): string {
  if (iso === '') return 'never'
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return 'unknown'
  const diff = now - at
  if (diff < 60_000) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return iso.slice(0, 10)
}

export function CcPanel(deps: CcPanelDeps): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>('plugins')
  const [state, setState] = React.useState<CcState | undefined>()
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | undefined>()
  const [spec, setSpec] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [providerFilter, setProviderFilter] = React.useState('')
  const [installedOnly, setInstalledOnly] = React.useState(false)
  /** The open Add/Manage modal's plugin (marketplace + catalog entry). */
  const [modal, setModal] = React.useState<{ marketplaceId: string; plugin: MarketplacePluginView } | undefined>()
  const [selection, setSelection] = React.useState<Set<string>>(new Set())
  /** Two-step uninstall confirm inside the modal, by target id. */
  const [confirmTarget, setConfirmTarget] = React.useState<string | undefined>()
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
    if (modal === undefined) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setModal(undefined); setSelection(new Set()); setConfirmTarget(undefined) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

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
        setConfirmTarget(undefined)
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

  const openModal = (marketplaceId: string, plugin: MarketplacePluginView): void => {
    setModal({ marketplaceId, plugin })
    setSelection(new Set())
    setConfirmTarget(undefined)
  }

  const toggleTarget = (id: string): void => {
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmInstall = (): void => {
    if (modal === undefined || selection.size === 0) return
    const targets = [...selection].map((id): { scope: 'global' | 'workspace'; workspacePath?: string } =>
      id === '' ? { scope: 'global' } : { scope: 'workspace', workspacePath: id })
    void mutate('installPlugin', { marketplaceId: modal.marketplaceId, plugin: modal.plugin.name, targets })
    setModal(undefined)
    setSelection(new Set())
  }

  const uninstallTarget = (key: string, id: string): void => {
    void mutate('uninstallPlugin', {
      key,
      target: id === '' ? { scope: 'global' } : { scope: 'workspace', workspacePath: id },
    })
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

  /** The Add/Manage modal: the skills panel's proven multi-target picker. */
  const modalDialog = (): React.ReactElement | null => {
    if (modal === undefined) return null
    const key = `${modal.marketplaceId}/${modal.plugin.name}`
    const record = byKey.get(key)
    const heldIds = new Set((record?.targets ?? []).map((t) => (t.scope === 'workspace' ? (t.workspacePath ?? '') : '')))
    const options: Array<{ id: string; label: string; installed: boolean }> = [
      { id: '', label: 'Global', installed: heldIds.has('') },
      ...workspaces.map((w) => ({ id: w.path, label: w.title, installed: heldIds.has(w.path) })),
    ]
    return (
      <div className={styles.overlay} role="presentation" onClick={() => { setModal(undefined); setSelection(new Set()); setConfirmTarget(undefined) }}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-label={`Manage plugin "${modal.plugin.name}"`}
          data-testid="cc-modal"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <p className={styles.modalTitle}>
            {`${modal.plugin.name}${record !== undefined && record.version !== '' ? ` (installed ${record.version})` : ''}${modal.plugin.updateAvailable === true && modal.plugin.version !== '' ? ` — ${modal.plugin.version} available` : ''}`}
          </p>
          <p className={styles.modalHint}>
            Choose where to add it. Skills install per target; MCP servers, agents, commands, and hooks activate globally once.
            Targets already holding the plugin are marked and locked.
          </p>
          <div className={styles.optionList}>
            {options.map((option) => (
              <label
                key={option.id === '' ? 'global' : option.id}
                className={styles.optionRow + (option.installed ? ` ${styles.optionLocked}` : '')}
                data-testid="cc-target"
              >
                <input
                  type="checkbox"
                  checked={option.installed || selection.has(option.id)}
                  disabled={busy || option.installed}
                  onChange={() => toggleTarget(option.id)}
                />
                <span className={styles.optionLabel}>{option.id === '' ? `Global ${option.label}` : option.label}</span>
                {option.installed && (
                  <>
                    <span className={styles.addedBadge}>added</span>
                    {confirmTarget === option.id ? (
                      <button
                        type="button"
                        className={`${styles.danger} ${styles.optionAction}`}
                        disabled={busy}
                        onClick={() => uninstallTarget(key, option.id)}
                      >Confirm</button>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.ghostDanger} ${styles.optionAction}`}
                        disabled={busy}
                        onClick={() => setConfirmTarget(option.id)}
                      >Uninstall</button>
                    )}
                  </>
                )}
              </label>
            ))}
          </div>
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.ghost}
              disabled={busy}
              onClick={() => { setModal(undefined); setSelection(new Set()); setConfirmTarget(undefined) }}
            >Cancel</button>
            {record !== undefined && (
              <button
                type="button"
                className={styles.ghost}
                disabled={busy}
                onClick={() => { void mutate('updatePlugin', { key }); setModal(undefined) }}
              >Update everywhere</button>
            )}
            <button
              type="button"
              className={styles.primary}
              disabled={busy || selection.size === 0}
              onClick={confirmInstall}
              data-testid="cc-modal-add"
            >{selection.size > 1 ? `Add to ${selection.size} targets` : 'Add'}</button>
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
        >Plugins</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'marketplaces'}
          className={tab === 'marketplaces' ? styles.tabActive : styles.tab}
          onClick={() => setTab('marketplaces')}
        >Marketplaces</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'models'}
          className={tab === 'models' ? styles.tabActive : styles.tab}
          onClick={() => setTab('models')}
        >Models</button>
      </div>

      {message !== undefined && (
        <div className={message.ok ? styles.noticeOk : styles.noticeErr} data-testid="cc-message">{message.text}</div>
      )}

      {tab === 'plugins' && (
        <div className={styles.filterRow}>
          <input
            type="search"
            className={styles.input}
            placeholder="Search plugins…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="cc-search"
          />
          <select
            className={styles.select}
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            aria-label="Marketplace"
            data-testid="cc-provider"
          >
            <option value="">All marketplaces</option>
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
            Installed only
          </label>
        </div>
      )}

      {tab === 'plugins' && (marketplaces.length === 0 ? (
        <div className={styles.empty} data-testid="cc-empty">
          No marketplaces added yet. Add one in the Marketplaces tab (owner/repo GitHub shorthand, a GitHub URL, or a local path).
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty} data-testid="cc-empty">No plugins match the current filters.</div>
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
                      {plugin.name}
                      {plugin.version !== '' && <span className={styles.version}> {plugin.version}</span>}
                    </div>
                    <div className={styles.desc}>{plugin.description !== '' ? plugin.description : 'no description'}</div>
                    <div className={styles.desc}>
                      {plugin.inventory !== undefined ? inventorySummary(plugin.inventory)
                        : plugin.sourceUnsupported !== undefined ? `not installable: ${plugin.sourceUnsupported}`
                          : 'components resolve on install'}
                    </div>
                  </div>
                  {record !== undefined && (
                    <div className={styles.badges}>
                      <span className={styles.presenceBadge}>{presenceLabel(record, workspaces)}</span>
                      {plugin.installedVersion !== undefined && (
                        <span className={styles.installedChip} data-testid="cc-installed-version">
                          {`installed ${plugin.installedVersion}`}
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
                        title={`update ${key} to ${plugin.version !== '' ? plugin.version : 'latest'}`}
                        onClick={() => { void mutate('updatePlugin', { key }) }}
                        data-testid="cc-update"
                      >Update</button>
                    )}
                    <button
                      type="button"
                      className={record !== undefined ? styles.ghost : styles.primary}
                      disabled={busy || plugin.sourceUnsupported !== undefined}
                      title={key}
                      onClick={() => openModal(marketplace.id, plugin)}
                      data-testid="cc-add"
                    >{record !== undefined ? 'Manage' : 'Add'}</button>
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
            placeholder="owner/repo, a GitHub URL, or a local path"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addMarketplace()
            }}
            data-testid="cc-add-input"
          />
          <button type="button" className={styles.primary} disabled={busy || spec.trim() === ''} onClick={() => void addMarketplace()}>Add marketplace</button>
          <button type="button" className={styles.ghost} disabled={busy || marketplaces.length === 0} onClick={() => void mutate('refreshMarketplaces')}>Refresh all</button>
        </div>
      )}

      {tab === 'marketplaces' && (
        <div className={styles.hint}>Snapshots older than 24 hours refresh automatically when this panel opens; Refresh all forces it now. Update buttons appear when a marketplace carries a newer version than the installed one.</div>
      )}

      {tab === 'marketplaces' && (marketplaces.length === 0 ? (
        <div className={styles.empty} data-testid="cc-empty">No marketplaces added yet. Add one with an owner/repo GitHub shorthand, a GitHub URL, or a local path.</div>
      ) : marketplaces.map((m) => (
        <div key={m.id} className={styles.card} data-testid="cc-marketplace">
          <div className={styles.marketHead}>
            <div className={styles.headText}>
              <div className={styles.name}>{m.name}</div>
              <div className={styles.desc}>
                {m.spec}
                {m.description !== '' ? ` — ${m.description}` : ''}
                {m.owner !== '' ? ` by ${m.owner}` : ''}
                {` · ${m.plugins.length} plugin${m.plugins.length === 1 ? '' : 's'}`}
                {` · last synced ${formatLastSync(m.lastSync)}`}
              </div>
              {m.error !== undefined && <div className={styles.errText}>{m.error}</div>}
            </div>
            <button
              type="button"
              className={styles.ghostDanger}
              disabled={busy}
              onClick={() => void mutate('removeMarketplace', { marketplaceId: m.id })}
            >Remove</button>
          </div>
        </div>
      )))}

      {tab === 'models' && (
        <div className={styles.modelList} data-testid="cc-models">
          <div className={styles.hint}>
            Map the Claude model names your agents use onto models this runtime offers. Unmapped names inherit the
            delegating session&apos;s model — the same default as Claude&apos;s `model: inherit` — and choosing inherit
            explicitly overrides a config-baseline mapping. Saving re-resolves installed agent rows without
            reinstalling; reload the profile to apply them.
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
                {fromConfig && <span className={styles.configChip}>config</span>}
                <select
                  className={styles.select}
                  aria-label={`Model for ${alias}`}
                  data-testid="cc-model-select"
                  value={current}
                  onChange={(e) => setModelDraft({ ...modelDraft, [alias]: e.target.value })}
                >
                  <option value="">Inherit session model</option>
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
            >Save model mappings</button>
          </div>
        </div>
      )}

      {modalDialog()}
    </div>
  )
}
