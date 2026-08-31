/**
 * The Claude Plugins settings panel rendered in the `settings.section` slot:
 * a whole settings page with two tabs (Marketplaces, Installed) over the
 * Host JSON RPC. The Marketplaces tab lists every configured marketplace and
 * its plugins with per-plugin install controls; the Installed tab lists the
 * installed records with update and uninstall actions.
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

type Tab = 'marketplaces' | 'installed'

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

export function CcPanel(deps: CcPanelDeps): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>('marketplaces')
  const [state, setState] = React.useState<CcState | undefined>()
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | undefined>()
  const [spec, setSpec] = React.useState('')
  const [scope, setScope] = React.useState<'global' | 'workspace'>('global')
  const [workspacePath, setWorkspacePath] = React.useState('')
  const [confirmKey, setConfirmKey] = React.useState<string | undefined>()
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

  // Keep the selected workspace valid as workspaces come and go.
  React.useEffect(() => {
    if (scope === 'workspace' && workspacePath !== '' && !workspaces.some((w) => w.path === workspacePath)) {
      setWorkspacePath(workspaces[0]?.path ?? '')
    }
  }, [scope, workspacePath, workspaces])

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
        setConfirmKey(undefined)
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

  return (
    <div className={styles.page}>
      <div className={styles.tabs} role="tablist">
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
          aria-selected={tab === 'installed'}
          className={tab === 'installed' ? styles.tabActive : styles.tab}
          onClick={() => setTab('installed')}
        >Installed</button>
      </div>

      {message !== undefined && (
        <div className={message.ok ? styles.noticeOk : styles.noticeErr} data-testid="cc-message">{message.text}</div>
      )}

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
        <div className={styles.scopeRow}>
          <span className={styles.scopeLabel}>Install scope:</span>
          <select className={styles.select} value={scope} onChange={(e) => setScope(e.target.value === 'workspace' ? 'workspace' : 'global')}>
            <option value="global">Global</option>
            {workspaces.length > 0 && <option value="workspace">Workspace</option>}
          </select>
          {scope === 'workspace' && (
            <select className={styles.select} value={workspacePath} onChange={(e) => setWorkspacePath(e.target.value)}>
              {workspaces.map((w) => (
                <option key={w.path} value={w.path}>{w.title}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {tab === 'marketplaces' && (marketplaces.length === 0 ? (
        <div className={styles.empty} data-testid="cc-empty">No marketplaces added yet. Add one with an owner/repo GitHub shorthand, a GitHub URL, or a local path.</div>
      ) : marketplaces.map((m) => (
        <div key={m.id} className={styles.card} data-testid="cc-plugins">
          <div className={styles.marketHead}>
            <div className={styles.headText}>
              <div className={styles.name}>{m.name}</div>
              <div className={styles.desc}>{m.spec}{m.description !== '' ? ` — ${m.description}` : ''}{m.owner !== '' ? ` by ${m.owner}` : ''}</div>
              {m.error !== undefined && <div className={styles.errText}>{m.error}</div>}
            </div>
            <button
              type="button"
              className={styles.ghostDanger}
              disabled={busy}
              onClick={() => void mutate('removeMarketplace', { marketplaceId: m.id })}
            >Remove</button>
          </div>
          {m.plugins.length > 0 && (
            <div className={styles.pluginList}>
              {m.plugins.map((p) => (
                <PluginRow
                  key={p.name}
                  marketplaceId={m.id}
                  plugin={p}
                  busy={busy}
                  scope={scope}
                  workspacePath={scope === 'workspace' ? workspacePath : undefined}
                  onInstall={() => void mutate('installPlugin', {
                    marketplaceId: m.id,
                    plugin: p.name,
                    scope,
                    ...(scope === 'workspace' ? { workspacePath } : {}),
                  })}
                  onUninstall={() => void mutate('uninstallPlugin', { key: `${m.id}/${p.name}` })}
                  onUpdate={() => void mutate('updatePlugin', { key: `${m.id}/${p.name}` })}
                />
              ))}
            </div>
          )}
        </div>
      )))}

      {tab === 'installed' && (installed.length === 0 ? (
        <div className={styles.empty} data-testid="cc-installed-empty">No Claude Code plugins installed yet.</div>
      ) : installed.map((record) => (
        <div key={record.key} className={styles.card} data-testid="cc-installed">
          <div className={styles.marketHead}>
            <div className={styles.headText}>
              <div className={styles.name}>{record.pluginName}{record.version !== '' ? ` ${record.version}` : ''}</div>
              <div className={styles.desc}>
                from {record.marketplaceSpec} · {record.scope}{record.scope === 'workspace' && record.workspacePath !== undefined ? ` (${record.workspacePath})` : ''}
              </div>
              <div className={styles.desc}>{installedSummary(record)}</div>
            </div>
            <div className={styles.rowActions}>
              <button type="button" className={styles.ghost} disabled={busy} onClick={() => void mutate('updatePlugin', { key: record.key })}>Update</button>
              {confirmKey === record.key ? (
                <button type="button" className={styles.danger} disabled={busy} onClick={() => void mutate('uninstallPlugin', { key: record.key })}>Confirm uninstall</button>
              ) : (
                <button type="button" className={styles.ghostDanger} disabled={busy} onClick={() => setConfirmKey(record.key)}>Uninstall</button>
              )}
            </div>
          </div>
        </div>
      )))}
    </div>
  )
}

/** One plugin row inside a marketplace card. */
function PluginRow(props: {
  marketplaceId: string
  plugin: MarketplacePluginView
  busy: boolean
  scope: 'global' | 'workspace'
  workspacePath?: string
  onInstall: () => void
  onUninstall: () => void
  onUpdate: () => void
}): React.ReactElement {
  const p = props.plugin
  const key = `${props.marketplaceId}/${p.name}`
  const [confirm, setConfirm] = React.useState(false)
  return (
    <div className={styles.pluginRow} data-testid="cc-plugin">
      <div className={styles.headText}>
        <div className={styles.pluginName}>
          {p.name}
          {p.version !== '' && <span className={styles.version}> {p.version}</span>}
          {p.category !== '' && <span className={styles.chip}> {p.category}</span>}
        </div>
        <div className={styles.desc}>{p.description !== '' ? p.description : 'no description'}</div>
        <div className={styles.desc}>
          {p.inventory !== undefined ? inventorySummary(p.inventory)
            : p.sourceUnsupported !== undefined ? `not installable: ${p.sourceUnsupported}`
              : 'components resolve on install'}
        </div>
      </div>
      <div className={styles.rowActions}>
        {p.installed ? (
          <>
            <button type="button" className={styles.ghost} disabled={props.busy} onClick={props.onUpdate}>Update</button>
            {confirm ? (
              <button type="button" className={styles.danger} disabled={props.busy} onClick={props.onUninstall}>Confirm uninstall</button>
            ) : (
              <button type="button" className={styles.ghostDanger} disabled={props.busy} onClick={() => setConfirm(true)}>Uninstall</button>
            )}
          </>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={props.busy || p.sourceUnsupported !== undefined || (props.scope === 'workspace' && (props.workspacePath === undefined || props.workspacePath === ''))}
            title={key}
            onClick={props.onInstall}
          >Install</button>
        )}
      </div>
    </div>
  )
}

/** Summary line for an installed record. */
function installedSummary(record: InstalledPlugin): string {
  const parts = [
    record.skills.length > 0 ? `${record.skills.length} skill${record.skills.length === 1 ? '' : 's'} (${record.skills.map((s) => s.name).join(', ')})` : '',
    record.mcpServers.length > 0 ? `${record.mcpServers.length} MCP server${record.mcpServers.length === 1 ? '' : 's'} (${record.mcpServers.map((s) => s.serverName).join(', ')})` : '',
    record.agents.length > 0 ? `${record.agents.length} agent tool${record.agents.length === 1 ? '' : 's'} (${record.agents.map((a) => a.toolName).join(', ')})` : '',
    record.pending.commands.length > 0 ? `${record.pending.commands.length} command${record.pending.commands.length === 1 ? '' : 's'} registered` : '',
    record.pending.hookEvents.length > 0 ? `${record.pending.hookEvents.length} hook event${record.pending.hookEvents.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'no components'
}
