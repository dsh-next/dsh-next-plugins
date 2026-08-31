/**
 * Stateful host implementation of the Claude Code plugin bridge.
 *
 * Responsibilities:
 *  - manage marketplace sources (GitHub repositories or local directories),
 *    each synced into a cached snapshot holding the parsed
 *    `.claude-plugin/marketplace.json` index (`.grok-plugin/` is honored as a
 *    Grok Build interop fallback);
 *  - install a marketplace plugin into DSH: its `skills/` components are
 *    copied verbatim into the DSH skills roots (the same roots the native
 *    filesystem skill provider scans, so installs go live through its
 *    watcher), its `.mcp.json` servers become managed `dsh-mcp-client` rows
 *    and its `agents/*.md` become managed `dsh-tool-subagent` rows spliced
 *    into `$DSH_HOME/cordis.patch.yml`, and its full file set is
 *    materialized under the plugin data root so the runtime bridge (slash
 *    commands, hooks) and hook scripts have stable local input;
 *  - uninstall (recoverable skill trash + managed-row removal) and update,
 *    both notifying the runtime bridge to re-register its live commands;
 *  - configuration gating: agent rows are only emitted while
 *    `runtime.agents` is enabled (Config in the host entry).
 *
 * All filesystem and network access flows through injected `fs`/`fetch`
 * faces so the service is fully testable with in-memory doubles.
 */
import { createHash } from 'node:crypto'
import { agentFrontmatter, resolveAgentModel, sanitizeModelMap, translateTools } from '../core/agents.ts'
import { parseFrontmatter } from '../core/frontmatter.ts'
import { applyManagedBlockText, expandMcpServerTemplates, normalizeMcpServers, renderManagedBlock, resolveServerName, type ManagedRow, type RawAgentRow, type RawMcpServer } from '../core/mcp.ts'
import { parseMarketplaceSpec } from '../core/source.ts'
import { classifyMirrorTarget, MIRROR_INHERIT, parseMirror, renderMirror, type SettingsMirror } from '../core/mirror.ts'
import { targetId, type TargetRequest } from '../core/targets.ts'
import { isSnapshotStale, isUpdateAvailable, manifestVersion } from '../core/versions.ts'
import { isSkillName, sanitizeIdentifier } from '../core/name.ts'
import { dirnamePath, isSafeRelativePath, joinPath } from '../core/path.ts'
import { dependencyNotes, pluginInventory, pluginLevelReferenceNotes, readManifestPaths, skillFiles, skillSemanticNotes, unbridgedNotes, type PluginFiles } from '../core/plugin-inventory.ts'
import { extractTarEntries } from './tarball.ts'
import { fetchRepoTarball } from './github-client.ts'
import { Store, safeDirId } from './store.ts'
import type {
  CcState,
  FetchLike,
  FsLike,
  InstalledAgentRow,
  InstalledMcpRow,
  InstalledPlugin,
  InstalledSkillRef,
  InstalledTarget,
  MarketplacePlugin,
  MarketplacePluginView,
  MarketplaceViewRow,
  MutationResult,
  PluginDetail,
  PluginInventory,
  PluginSource,
  RuntimeModel,
  SkillComponent,
} from '../core/types.ts'

/** What one {@link CcMarketplaceService.reconcileFromMirror} run adopted. */
export interface ReconcileReport {
  marketplacesAdded: string[]
  installed: string[]
  skipped: string[]
}

/** Marker written inside every skill directory this plugin installs. */
export const SOURCE_MARKER = '.dsh-next-cc-source.json'
/** Recoverable-delete directory inside every skill root (skipped by discovery). */
export const TRASH_DIR = '.trash'

export interface ServiceOptions {
  fs: FsLike
  fetch: FetchLike
  /** DSH config root (`$DSH_HOME` or `~/.dsh`). */
  dshHome: string
  /** Shared agent config root (`$DSH_AGENTS_HOME` or `~/.agents`). */
  agentsHome: string
  /** Home directory for `~` expansion. */
  home: string
  /** Override for tests; defaults to `<dshHome>/cordis.patch.yml`. */
  cordisPatchPath?: string
  /** Shared store (the runtime bridge reads the same persistence). */
  store?: Store
  /** Whether installs also emit agent delegation-tool rows (Config runtime.agents). */
  agentsEnabled?: boolean
  /** Claude model id to DSH model id map (Config runtime.agentModelMap). */
  agentModelMap?: Readonly<Record<string, string>>
  /** Live model discovery for the Models tab (host entry injects ctx.llm). */
  listRuntimeModels?: () => Promise<RuntimeModel[]>
  /** The settings-document mirror (host entry injects a registered scope). */
  settings?: SettingsMirror
  /** Resolve a mirrored workspace folder name to a local workspace path
   *  (host entry injects the workspace registry lookup). */
  resolveWorkspace?: (name: string) => Promise<string | undefined>
  /** Host environment for `${NAME}` expansion in MCP server definitions
   *  (the host entry passes `process.env`; tests inject doubles). */
  env?: Readonly<Record<string, string | undefined>>
  /** Diagnostics sink for best-effort mirror and reconcile reporting. */
  logger?: { warn?: (message: string) => void; info?: (message: string) => void }
  /** Notified after every install/uninstall/update persists (runtime refresh). */
  onInstalledChanged?: () => void
}

/** Render the composition row id for one plugin/server pair (stable). */
export function mcpRowId(pluginKey: string, claudeServerName: string): string {
  const key = pluginKey.replace(/[^A-Za-z0-9_-]+/g, '-')
  const server = claudeServerName.replace(/[^A-Za-z0-9_-]+/g, '-')
  return `cc-mcp-${key}-${server}`.slice(0, 100)
}

/** Render the composition row id for one plugin/agent pair (stable). */
export function agentRowId(pluginKey: string, claudeAgentName: string): string {
  const key = pluginKey.replace(/[^A-Za-z0-9_-]+/g, '-')
  const agent = claudeAgentName.replace(/[^A-Za-z0-9_-]+/g, '-')
  return `cc-agent-${key}-${agent}`.slice(0, 100)
}

export class CcMarketplaceService {
  private readonly store: Store
  /** The settings-document mirror; wireable late (the settings fiber may start after this service). */
  private settings: SettingsMirror | undefined
  /** Skip notes from the last settings import this machine could not fully satisfy. */
  private lastImportSkipped: string[] = []
  /** Serialized reconcile runs (boot + external settings edits). */
  private reconcileInFlight: Promise<ReconcileReport> | undefined

  constructor(private readonly opts: ServiceOptions) {
    this.store = opts.store ?? new Store({ fs: opts.fs, fetch: opts.fetch, root: joinPath(opts.dshHome, 'cc-plugins'), home: opts.home })
    this.settings = opts.settings
  }

  /** Wire (or clear) the settings mirror — the host entry's settings fiber calls this. */
  setSettingsMirror(settings: SettingsMirror | undefined): void {
    this.settings = settings
  }

  /** The store shared with the runtime bridge. */
  getStore(): Store {
    return this.store
  }

  private patchPath(): string {
    return this.opts.cordisPatchPath ?? joinPath(this.opts.dshHome, 'cordis.patch.yml')
  }

  private skillsRoot(scope: 'global' | 'workspace', workspacePath?: string): string | undefined {
    if (scope === 'global') return joinPath(this.opts.agentsHome, 'skills')
    return workspacePath !== undefined && workspacePath !== '' ? joinPath(workspacePath, '.agents/skills') : undefined
  }

  /** Human label for an install target used in messages. */
  private scopeLabel(target: { scope: 'global' | 'workspace'; workspacePath?: string }): string {
    if (target.scope !== 'workspace') return 'the global root'
    const path = target.workspacePath ?? ''
    const base = path.split('/').filter(Boolean).pop() ?? path
    return base !== '' ? `workspace "${base}"` : 'a workspace'
  }

  /**
   * The effective Claude-alias to DSH-model map: the composition config
   * (`runtime.agentModelMap`) is the baseline; the panel's saved overrides
   * (`<root>/model-map.json`) layer on top key by key — a string replaces the
   * baseline value, `null` (the explicit inherit marker) suppresses it.
   */
  private effectiveModelMap(overrides: Record<string, string | null>): Record<string, string> {
    const effective: Record<string, string> = this.configModelMap()
    for (const [alias, model] of Object.entries(overrides)) {
      if (model === null) delete effective[alias]
      else effective[alias] = model
    }
    return effective
  }

  /**
   * The composition config baseline as a plain string map: a null value in
   * the composition (an empty yaml value) simply means "no mapping".
   */
  private configModelMap(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [alias, model] of Object.entries(sanitizeModelMap(this.opts.agentModelMap))) {
      if (model !== null) out[alias] = model
    }
    return out
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  /**
   * The panel's load entry (`getState` RPC): marketplace snapshots older than
   * the refresh TTL re-sync first (best effort, in parallel — a failed
   * refresh keeps the cached data and the manual Refresh all button reports
   * errors), then the pure state view answers. This is what makes catalog
   * versions and the update badge trustworthy without a background timer.
   */
  async getState(): Promise<CcState> {
    await this.refreshStaleMarketplaces()
    return this.state()
  }

  /** Re-sync every marketplace whose cached snapshot is older than the TTL. */
  private async refreshStaleMarketplaces(): Promise<void> {
    const marketplaces = await this.store.listMarketplaces()
    await Promise.all(marketplaces.map(async (m) => {
      const snapshot = await this.store.readSnapshot(m.id)
      if (snapshot !== undefined && !isSnapshotStale(snapshot.fetchedAt)) return
      const parsed = parseMarketplaceSpec(m.spec)
      if ('error' in parsed) return
      // Errors are swallowed on purpose: cached data still answers the panel.
      await this.store.sync(parsed.source, m.id)
    }))
  }

  async state(): Promise<CcState> {
    const [marketplaces, installed, overrides] = await Promise.all([
      this.store.listMarketplaces(),
      this.store.readInstalled(),
      this.store.readModelMap(),
    ])
    const configMap = this.configModelMap()
    const effective = this.effectiveModelMap(overrides)
    const rows: MarketplaceViewRow[] = []
    const byKey = new Map(installed.plugins.map((p) => [p.key, p]))
    for (const m of [...marketplaces].sort((a, b) => a.spec.localeCompare(b.spec))) {
      const snapshot = await this.store.readSnapshot(m.id)
      if (snapshot === undefined) {
        rows.push({
          id: m.id,
          spec: m.spec,
          name: m.spec,
          description: '',
          owner: '',
          lastSync: '',
          error: 'never synced',
          plugins: [],
        })
        continue
      }
      const plugins: MarketplacePluginView[] = snapshot.index.plugins.map((plugin) => {
        const record = byKey.get(`${m.id}/${plugin.name}`)
        // Claude's version precedence for the catalog side: the entry's
        // version, then the plugin's own plugin.json (resolvable only for
        // relative sources, whose files live inside the snapshot).
        const snapshotFiles = plugin.source.kind === 'relative'
          ? this.pluginSubMap(snapshot.files, plugin.source.path)
          : undefined
        const manifestVer = snapshotFiles !== undefined ? manifestVersion(snapshotFiles) : ''
        const catalogVersion = plugin.version !== '' ? plugin.version : manifestVer
        const view: MarketplacePluginView = {
          name: plugin.name,
          description: plugin.description,
          version: catalogVersion,
          category: plugin.category,
          author: plugin.author,
          homepage: plugin.homepage,
          tags: plugin.tags,
          installed: record !== undefined,
          ...(record !== undefined && record.version !== '' ? { installedVersion: record.version } : {}),
          ...(record !== undefined && isUpdateAvailable({
            installedVersion: record.version,
            entryVersion: plugin.version,
            manifestVersion: manifestVer,
            installedDigest: record.snapshotDigest,
            catalogDigest: snapshot.digest,
          }) ? { updateAvailable: true } : {}),
        }
        if (plugin.source.kind === 'unsupported') {
          view.sourceUnsupported = plugin.source.reason
        } else if (plugin.source.kind === 'relative') {
          if (snapshotFiles === undefined) {
            view.sourceUnsupported = `path "${plugin.source.path}" is missing from the marketplace snapshot`
          } else {
            view.inventory = pluginInventory(snapshotFiles)
          }
        }
        return view
      })
      rows.push({
        id: m.id,
        spec: m.spec,
        name: snapshot.index.name,
        description: snapshot.index.description,
        owner: snapshot.index.owner,
        lastSync: snapshot.fetchedAt,
        plugins,
      })
    }
    // Alias pickers cover the classic Claude families, every mapped alias,
    // and every model name installed agents actually reference.
    const aliases = new Set(['haiku', 'sonnet', 'opus'])
    for (const key of Object.keys(effective)) aliases.add(key)
    for (const record of installed.plugins) {
      for (const row of record.agents) {
        const { model } = agentFrontmatter(parseFrontmatter(row.persona))
        if (model !== '' && model !== 'inherit') aliases.add(model)
      }
    }
    let models: RuntimeModel[] = []
    try {
      models = this.opts.listRuntimeModels !== undefined ? await this.opts.listRuntimeModels() : []
    } catch {
      models = [] // best effort: the tab degrades to inherit-only pickers
    }
    return {
      installed: installed.plugins,
      marketplaces: rows,
      models,
      agentModelMap: effective,
      agentModelConfig: configMap,
      /** The panel's saved overrides verbatim (string, or null = inherit). */
      agentModelOverrides: overrides,
      agentModelAliases: [...aliases].sort(),
      importSkipped: [...this.lastImportSkipped],
    }
  }

  /**
   * The sub-map of a marketplace snapshot below one plugin directory. A
   * root-source plugin (`"./"` — the marketplace repository IS the plugin,
   * e.g. ChromeDevTools/chrome-devtools-mcp) maps to the whole snapshot.
   */
  private pluginSubMap(files: Record<string, string>, dir: string): PluginFiles | undefined {
    if (dir === '' || dir === '.') return Object.keys(files).length > 0 ? { ...files } : undefined
    const prefix = `${dir}/`
    const out: PluginFiles = {}
    let any = false
    for (const [path, content] of Object.entries(files)) {
      if (path.startsWith(prefix)) {
        out[path.slice(prefix.length)] = content
        any = true
      }
    }
    return any ? out : undefined
  }

  // -------------------------------------------------------------------------
  // Marketplace management
  // -------------------------------------------------------------------------

  async addMarketplace(spec: string): Promise<MutationResult> {
    const parsed = parseMarketplaceSpec(spec)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    const marketplaces = await this.store.listMarketplaces()
    if (marketplaces.some((m) => m.id === parsed.id)) {
      return { ok: false, error: `marketplace "${parsed.canonical}" is already added` }
    }
    const sync = await this.store.sync(parsed.source, parsed.id)
    if ('error' in sync) {
      return { ok: false, error: `adding "${parsed.canonical}" failed: ${sync.error}` }
    }
    await this.store.saveMarketplaces([...marketplaces, { id: parsed.id, spec: parsed.canonical, addedAt: new Date().toISOString() }])
    await this.mirrorCurrentState()
    return {
      ok: true,
      message: `added marketplace "${sync.snapshot.index.name}" (${sync.snapshot.index.plugins.length} plugins)`,
      state: await this.state(),
    }
  }

  async removeMarketplace(id: string): Promise<MutationResult> {
    const marketplaces = await this.store.listMarketplaces()
    if (!marketplaces.some((m) => m.id === id)) return { ok: false, error: `marketplace "${id}" is not configured` }
    const installed = await this.store.readInstalled()
    const fromHere = installed.plugins.filter((p) => p.marketplaceId === id).map((p) => p.pluginName)
    if (fromHere.length > 0) {
      return { ok: false, error: `uninstall its plugins first: ${fromHere.join(', ')}` }
    }
    await this.store.saveMarketplaces(marketplaces.filter((m) => m.id !== id))
    await this.mirrorCurrentState()
    return { ok: true, message: `removed marketplace "${id}"`, state: await this.state() }
  }

  async refreshMarketplaces(): Promise<MutationResult> {
    const marketplaces = await this.store.listMarketplaces()
    const failures: string[] = []
    for (const m of marketplaces) {
      const parsed = parseMarketplaceSpec(m.spec)
      if ('error' in parsed) {
        failures.push(`${m.spec}: ${parsed.error}`)
        continue
      }
      const sync = await this.store.sync(parsed.source, parsed.id)
      if ('error' in sync) failures.push(`${m.spec}: ${sync.error}`)
    }
    const state = await this.state()
    if (failures.length > 0) {
      return { ok: false, error: `refresh failed for ${failures.length} marketplace(s): ${failures.join('; ')}`, state }
    }
    return { ok: true, message: `refreshed ${marketplaces.length} marketplace(s)`, state }
  }

  // -------------------------------------------------------------------------
  // Plugin detail
  // -------------------------------------------------------------------------

  /** Resolve a plugin's files and compute its inventory (fetching when remote). */
  async getPluginDetail(args: { marketplaceId: string; plugin: string }): Promise<PluginDetail | undefined> {
    const resolved = await this.resolvePluginFiles(args.marketplaceId, args.plugin)
    if (resolved === undefined) return undefined
    return { name: args.plugin, description: resolved.entry.description, inventory: pluginInventory(resolved.files) }
  }

  // -------------------------------------------------------------------------
  // Install / uninstall / update
  // -------------------------------------------------------------------------

  async installPlugin(args: {
    marketplaceId: string
    plugin: string
    targets: readonly TargetRequest[]
  }): Promise<MutationResult> {
    if (args.targets.length === 0) {
      return { ok: false, error: 'at least one install target is required (global or workspace)' }
    }
    for (const t of args.targets) {
      if (t.scope === 'workspace' && (t.workspacePath === undefined || t.workspacePath === '')) {
        return { ok: false, error: 'workspace targets require a workspacePath' }
      }
    }
    const key = `${args.marketplaceId}/${args.plugin}`
    const installed = await this.store.readInstalled()
    const existing = installed.plugins.find((p) => p.key === key)
    // Targets already holding the plugin are rejected; the UI locks them and
    // only offers the remaining ones. Fresh targets merge into the record.
    if (existing !== undefined) {
      const taken = args.targets.filter((t) => existing.targets.some((et) => targetId(et) === targetId(t)))
      if (taken.length > 0) {
        const labels = taken.map((t) => this.scopeLabel(t)).join(', ')
        return { ok: false, error: `plugin "${args.plugin}" is already installed in ${labels}` }
      }
    }
    let resolved
    try {
      resolved = await this.resolvePluginFiles(args.marketplaceId, args.plugin)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (resolved === undefined) return { ok: false, error: `plugin "${args.plugin}" not found in marketplace "${args.marketplaceId}"` }
    if (resolved.entry.source.kind === 'unsupported') {
      return { ok: false, error: `plugin "${args.plugin}" source is not installable: ${resolved.entry.source.reason}` }
    }
    const inventory = pluginInventory(resolved.files)

    // 1. Skills: copy each skill directory into every requested target's
    //    skills root. Any failure rolls back every target's copies.
    const copiedDirs: string[] = []
    const newTargets: InstalledTarget[] = []
    for (const t of args.targets) {
      const root = this.skillsRoot(t.scope, t.workspacePath)
      if (root === undefined) {
        await this.rollbackDirs(copiedDirs)
        return { ok: false, error: 'workspace targets require a workspacePath' }
      }
      const skillRefs: InstalledSkillRef[] = []
      for (const skill of inventory.skills) {
        if (!isSkillName(skill.name)) {
          await this.rollbackDirs(copiedDirs)
          return { ok: false, error: `skill "${skill.name}" has a name the DSH skill registry rejects (kebab-case required)` }
        }
        const target = joinPath(root, skill.name)
        try {
          await this.opts.fs.access(target)
          await this.rollbackDirs(copiedDirs)
          return { ok: false, error: `skill "${skill.name}" already exists in the ${this.scopeLabel(t)} skills root` }
        } catch {
          // not installed yet
        }
        const failure = await this.copySkill(resolved.files, skill, target, key)
        if (failure !== undefined) {
          await this.opts.fs.rm(target, { recursive: true, force: true }).catch(() => {})
          await this.rollbackDirs(copiedDirs)
          return { ok: false, error: failure }
        }
        copiedDirs.push(target)
        skillRefs.push({ name: skill.name, directory: target })
      }
      newTargets.push({
        scope: t.scope,
        ...(t.scope === 'workspace' && t.workspacePath !== undefined ? { workspacePath: t.workspacePath } : {}),
        skills: skillRefs,
      })
    }

    // 2. MCP servers: managed dsh-mcp-client rows (plugin-level, once).
    //    The plugin's own previous rows are excluded from the dedupe set so
    //    adding a target never renames its own servers.
    const others = installed.plugins.filter((p) => p.key !== key)
    const mcp = this.buildMcpRows(key, inventory, others, existing?.mcpServers)

    // 3. Agent delegation tools: managed dsh-tool-subagent rows (persona from
    //    the agent markdown, translated tools/model frontmatter), only while
    //    runtime.agents is enabled.
    const modelMap = this.effectiveModelMap(await this.store.readModelMap())
    const agents = this.opts.agentsEnabled === true
      ? this.buildAgentRows(key, args.plugin, resolved.files, inventory, others, mcp.rows, modelMap, existing?.agents)
      : { rows: [] as InstalledAgentRow[], notes: [] as string[] }

    // 4. Materialize the plugin copy: the file cache drives the runtime
    //    bridge, and the on-disk copy gives hooks a real CLAUDE_PLUGIN_ROOT.
    await this.materializePlugin(key, resolved.files)

    // 5. Registry record + managed-block rewrite from the registry.
    const now = new Date().toISOString()
    // Claude's precedence: the marketplace entry's version, then the
    // plugin's own plugin.json version; the snapshot digest is the update
    // signal when neither carries one.
    const effectiveVersion = resolved.entry.version !== '' ? resolved.entry.version : manifestVersion(resolved.files)
    const snapshotDigest = (await this.store.readSnapshot(args.marketplaceId))?.digest
    const base: InstalledPlugin = existing ?? {
      key,
      marketplaceId: args.marketplaceId,
      marketplaceSpec: resolved.marketplaceSpec,
      pluginName: args.plugin,
      version: effectiveVersion,
      installedAt: now,
      updatedAt: now,
      targets: [],
      mcpServers: [],
      agents: [],
      pending: { commands: [], hookEvents: [] },
    }
    const record: InstalledPlugin = {
      ...base,
      version: effectiveVersion,
      ...(snapshotDigest !== undefined ? { snapshotDigest } : {}),
      updatedAt: now,
      targets: [...base.targets, ...newTargets],
      mcpServers: mcp.rows,
      agents: agents.rows,
      pending: {
        commands: inventory.commands.map((c) => c.name),
        hookEvents: inventory.hookEvents,
      },
    }
    const plugins = existing === undefined
      ? [...installed.plugins, record]
      : installed.plugins.map((p) => (p.key === key ? record : p))
    try {
      await this.writeManagedRows(plugins)
    } catch (error) {
      await this.rollbackDirs(copiedDirs)
      await this.removeMaterializedPlugin(key).catch(() => {})
      return { ok: false, error: `writing managed rows failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    await this.store.saveCachedPluginFiles(args.marketplaceId, args.plugin, resolved.files)
    await this.store.saveInstalled({ plugins })
    this.opts.onInstalledChanged?.()
    await this.mirrorCurrentState()

    const pendingBits = [
      record.pending.commands.length > 0 ? `${record.pending.commands.length} command(s) registered` : '',
      agents.rows.length > 0 ? `${agents.rows.length} agent tool(s) written to cordis.patch.yml (reload to apply)` : '',
      record.pending.hookEvents.length > 0 ? `${record.pending.hookEvents.length} hook event(s) (enable runtime.hooks to activate)` : '',
    ].filter(Boolean)
    const parts = [
      inventory.skills.length > 0 ? `${inventory.skills.length} skill(s)` : '',
      mcp.rows.length > 0 ? `${mcp.rows.length} MCP server(s) written to cordis.patch.yml (restart DSH or reload the profile to attach)` : '',
      pendingBits.length > 0 ? pendingBits.join(', ') : '',
      `targets: ${args.targets.map((t) => this.scopeLabel(t)).join(' + ')}`,
    ].filter(Boolean)
    const summary = parts.join('; ')
    const notes = [...mcp.notes, ...agents.notes, ...unbridgedNotes(inventory.unbridged), ...dependencyNotes(inventory.dependencies), ...skillSemanticNotes(resolved.files, inventory.skills), ...pluginLevelReferenceNotes(resolved.files, inventory.skills)]
    const verb = existing === undefined ? 'installed' : 'added targets to'
    const message = notes.length > 0 ? `${verb} "${args.plugin}": ${summary}; ${notes.join('; ')}` : `${verb} "${args.plugin}": ${summary}`
    return { ok: true, message, state: await this.state() }
  }

  /** Uninstall one target's skills, or the whole plugin when no target is
   *  given (or the last target goes away). */
  async uninstallPlugin(key: string, target?: TargetRequest): Promise<MutationResult> {
    const installed = await this.store.readInstalled()
    const record = installed.plugins.find((p) => p.key === key)
    if (record === undefined) return { ok: false, error: `plugin "${key}" is not installed` }

    if (target !== undefined) {
      const id = targetId(target)
      const held = record.targets.find((et) => targetId(et) === id)
      if (held === undefined) {
        return { ok: false, error: `plugin "${record.pluginName}" is not installed in ${this.scopeLabel(target)}` }
      }
      for (const skill of held.skills) {
        await this.trashDir(skill.directory, skill.name)
      }
      const remaining = record.targets.filter((et) => targetId(et) !== id)
      if (remaining.length > 0) {
        const updated: InstalledPlugin = { ...record, targets: remaining, updatedAt: new Date().toISOString() }
        const plugins = installed.plugins.map((p) => (p.key === key ? updated : p))
        await this.writeManagedRows(plugins)
        await this.store.saveInstalled({ plugins })
        this.opts.onInstalledChanged?.()
        await this.mirrorCurrentState()
        return {
          ok: true,
          message: `removed "${record.pluginName}" from ${this.scopeLabel(target)} (${held.skills.length} skill(s) moved to .trash; ${remaining.length} target(s) remain)`,
          state: await this.state(),
        }
      }
      // The last target went away: fall through to a full uninstall.
    }

    // 1. Every target's skills -> recoverable trash inside each skill's root.
    for (const t of record.targets) {
      for (const skill of t.skills) {
        await this.trashDir(skill.directory, skill.name)
      }
    }

    // 2. The materialized plugin copy (hooks' CLAUDE_PLUGIN_ROOT) goes away.
    await this.removeMaterializedPlugin(key)

    // 3. Managed rows (MCP + agents): rebuild from the remaining records.
    const kept = installed.plugins.filter((p) => p.key !== key)
    await this.writeManagedRows(kept)
    await this.store.saveInstalled({ plugins: kept })
    this.opts.onInstalledChanged?.()
    await this.mirrorCurrentState()
    const skillCount = record.targets.reduce((sum, t) => sum + t.skills.length, 0)
    return {
      ok: true,
      message: `uninstalled "${record.pluginName}" (${skillCount} skill(s) moved to .trash, ${record.mcpServers.length} MCP row(s) and ${record.agents.length} agent row(s) removed)`,
      state: await this.state(),
    }
  }

  async updatePlugin(key: string): Promise<MutationResult> {
    const installed = await this.store.readInstalled()
    const record = installed.plugins.find((p) => p.key === key)
    if (record === undefined) return { ok: false, error: `plugin "${key}" is not installed` }

    // Refresh the marketplace snapshot first so the update sees upstream.
    const parsed = parseMarketplaceSpec(record.marketplaceSpec)
    if ('error' in parsed) return { ok: false, error: `stored marketplace spec is invalid: ${parsed.error}` }
    const sync = await this.store.sync(parsed.source, record.marketplaceId)
    if ('error' in sync) return { ok: false, error: `refreshing "${record.marketplaceSpec}" failed: ${sync.error}` }

    let resolved
    try {
      resolved = await this.resolvePluginFiles(record.marketplaceId, record.pluginName)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (resolved === undefined) return { ok: false, error: `plugin "${record.pluginName}" disappeared from "${record.marketplaceSpec}"` }
    if (resolved.entry.source.kind === 'unsupported') {
      return { ok: false, error: `plugin "${record.pluginName}" source became non-installable: ${resolved.entry.source.reason}` }
    }
    const inventory = pluginInventory(resolved.files)

    // Skills refresh in every target's root; per-skill failures skip that
    // skill, and skills removed upstream are trashed per target.
    const errors: string[] = []
    const updatedTargets: InstalledTarget[] = []
    for (const t of record.targets) {
      const root = this.skillsRoot(t.scope, t.workspacePath)
      if (root === undefined) {
        errors.push(`target ${this.scopeLabel(t)} has no usable skills root`)
        updatedTargets.push(t)
        continue
      }
      const skillDirs: InstalledSkillRef[] = []
      const seen = new Set<string>()
      for (const skill of inventory.skills) {
        if (!isSkillName(skill.name)) {
          errors.push(`skill "${skill.name}" has an invalid name`)
          continue
        }
        seen.add(skill.name)
        const target = joinPath(root, skill.name)
        const failure = await this.copySkill(resolved.files, skill, target, key)
        if (failure !== undefined) {
          errors.push(failure)
          continue
        }
        skillDirs.push({ name: skill.name, directory: target })
      }
      // Skills removed upstream are trashed; new skills were added above.
      for (const old of t.skills) {
        if (seen.has(old.name)) continue
        await this.trashDir(old.directory, old.name)
      }
      updatedTargets.push({ ...t, skills: skillDirs })
    }
    if (errors.length > 0 && updatedTargets.every((t) => t.skills.length === 0) && inventory.skills.length > 0) {
      return { ok: false, error: `update failed: ${errors.join('; ')}` }
    }

    // MCP rows keep previously resolved server names when the Claude server
    // key survives upstream, so model-visible tool names stay stable. The
    // plugin's own previous rows are excluded from the dedupe set.
    const others = installed.plugins.filter((p) => p.key !== key)
    const mcp = this.buildMcpRows(key, inventory, others, record.mcpServers)
    const modelMap = this.effectiveModelMap(await this.store.readModelMap())
    const agents = this.opts.agentsEnabled === true
      ? this.buildAgentRows(key, record.pluginName, resolved.files, inventory, others, mcp.rows, modelMap, record.agents)
      : { rows: [] as InstalledAgentRow[], notes: [] as string[] }

    await this.materializePlugin(key, resolved.files)

    const effectiveVersion = resolved.entry.version !== '' ? resolved.entry.version : manifestVersion(resolved.files)
    const snapshotDigest = (await this.store.readSnapshot(record.marketplaceId))?.digest
    const updated: InstalledPlugin = {
      ...record,
      version: effectiveVersion,
      ...(snapshotDigest !== undefined ? { snapshotDigest } : {}),
      updatedAt: new Date().toISOString(),
      targets: updatedTargets,
      mcpServers: mcp.rows,
      agents: agents.rows,
      pending: {
        commands: inventory.commands.map((c) => c.name),
        hookEvents: inventory.hookEvents,
      },
    }
    const plugins = installed.plugins.map((p) => (p.key === key ? updated : p))
    await this.writeManagedRows(plugins)
    await this.store.saveCachedPluginFiles(record.marketplaceId, record.pluginName, resolved.files)
    await this.store.saveInstalled({ plugins })
    this.opts.onInstalledChanged?.()

    const skipped = errors.length > 0 ? `; skipped: ${errors.join('; ')}` : ''
    const versionText = effectiveVersion !== '' ? effectiveVersion : 'latest'
    const notes = [...mcp.notes, ...agents.notes, ...unbridgedNotes(inventory.unbridged), ...dependencyNotes(inventory.dependencies), ...skillSemanticNotes(resolved.files, inventory.skills), ...pluginLevelReferenceNotes(resolved.files, inventory.skills)]
    const message = notes.length > 0
      ? `updated "${record.pluginName}" to ${versionText}${skipped}; ${notes.join('; ')}`
      : `updated "${record.pluginName}" to ${versionText}${skipped}`
    return { ok: true, message, state: await this.state() }
  }

  // -------------------------------------------------------------------------
  // Agent model mapping (Models tab)
  // -------------------------------------------------------------------------

  /**
   * Save the panel's Claude-alias to DSH-model overrides (wholesale replace
   * of model-map.json, sanitized — `null` marks an alias as explicitly
   * inheriting the session model, suppressing a config-baseline value), then
   * re-resolve every installed agent row's `model:` against the new effective
   * map. Managed rows rewrite when anything changed; a profile reload applies
   * them.
   */
  async setAgentModelOverrides(raw: unknown): Promise<MutationResult> {
    const overrides = sanitizeModelMap(raw)
    await this.store.saveModelMap(overrides)
    const effective = this.effectiveModelMap(overrides)

    const installed = await this.store.readInstalled()
    const changes: string[] = []
    const plugins = installed.plugins.map((record): InstalledPlugin => {
      let changed = false
      const agents = record.agents.map((row): InstalledAgentRow => {
        const { model } = agentFrontmatter(parseFrontmatter(row.persona))
        const resolved = resolveAgentModel(model, effective).model
        if (resolved === row.model) return row
        changed = true
        changes.push(`agent "${row.claudeName}" ${resolved === undefined ? 'inherits the session model' : `-> ${resolved}`}`)
        if (resolved === undefined) {
          const next = { ...row }
          delete next.model
          return next
        }
        return { ...row, model: resolved }
      })
      return changed ? { ...record, agents } : record
    })

    if (changes.length > 0) {
      await this.writeManagedRows(plugins)
      await this.store.saveInstalled({ plugins })
      this.opts.onInstalledChanged?.()
    }
    await this.mirrorCurrentState()
    const saved = Object.entries(overrides).map(([alias, model]) => `${alias} -> ${model ?? 'inherit'}`)
    const message = [
      saved.length > 0
        ? `saved model overrides: ${saved.join(', ')}`
        : 'cleared model overrides; unmapped names inherit the session model',
      changes.length > 0 ? `${changes.length} agent row(s) re-resolved (${changes.join('; ')}); reload the profile to apply` : '',
    ].filter(Boolean).join('; ')
    return { ok: true, message, state: await this.state() }
  }

  // -------------------------------------------------------------------------
  // Settings-document mirror (shareable setup)
  // -------------------------------------------------------------------------

  /** Write the whole setup into the settings document; best effort. */
  private async mirrorCurrentState(): Promise<void> {
    if (this.settings === undefined) return
    try {
      const [marketplaces, installed, models] = await Promise.all([
        this.store.listMarketplaces(),
        this.store.readInstalled(),
        this.store.readModelMap(),
      ])
      await this.settings.write(renderMirror({ marketplaces, installed: installed.plugins, models }))
    } catch (error) {
      this.opts.logger?.warn?.(`dsh-next-cc-plugins settings mirror write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Adopt what the settings document carries that this machine lacks:
   * missing marketplaces are added, missing plugins installed into their
   * recorded targets (workspace targets only when the path exists on this
   * machine), and model mappings adopted when nothing is saved locally.
   * Removals are never inferred — uninstalls stay explicit through the
   * panel. Runs at boot and on hot-published external edits; concurrent
   * calls share one run.
   */
  async reconcileFromMirror(): Promise<ReconcileReport> {
    if (this.reconcileInFlight !== undefined) return this.reconcileInFlight
    const run = this.runReconcile()
      .then((report) => {
        // The panel surfaces these as "could not import here" notes.
        this.lastImportSkipped = report.skipped
        return report
      })
      .finally(() => {
        if (this.reconcileInFlight === run) this.reconcileInFlight = undefined
      })
    this.reconcileInFlight = run
    return run
  }

  private async runReconcile(): Promise<ReconcileReport> {
    const report: ReconcileReport = { marketplacesAdded: [], installed: [], skipped: [] }
    if (this.settings === undefined) return report
    let section
    try {
      section = parseMirror(this.settings.read())
    } catch (error) {
      this.opts.logger?.warn?.(`dsh-next-cc-plugins settings mirror read failed: ${error instanceof Error ? error.message : String(error)}`)
      return report
    }

    // 1. Marketplaces listed in the document but not configured locally.
    const marketplaces = await this.store.listMarketplaces()
    const bySpec = new Map(marketplaces.map((m) => [m.spec, m.id]))
    for (const spec of section.marketplaces) {
      if (bySpec.has(spec)) continue
      const result = await this.addMarketplace(spec)
      if (result.ok) {
        report.marketplacesAdded.push(spec)
        const parsed = parseMarketplaceSpec(spec)
        if (!('error' in parsed)) bySpec.set(spec, parsed.id)
      } else {
        report.skipped.push(`marketplace ${spec}: ${result.error ?? 'add failed'}`)
      }
    }

    // 2. Installs present in the document but not on this machine. A missing
    //    marketplace that could not be added skips its plugins.
    const installed = await this.store.readInstalled()
    const installedKeys = new Set(installed.plugins.map((p) => p.key))
    for (const entry of section.installs) {
      const id = bySpec.get(entry.marketplace)
      if (id === undefined) {
        report.skipped.push(`plugin ${entry.marketplace}/${entry.plugin}: marketplace not configured`)
        continue
      }
      const key = `${id}/${entry.plugin}`
      if (installedKeys.has(key)) continue
      const targets: TargetRequest[] = []
      for (const raw of entry.targets) {
        const t = classifyMirrorTarget(raw)
        if (t === undefined) continue
        if (t.kind === 'global') {
          targets.push({ scope: 'global' })
          continue
        }
        if (t.kind === 'workspace-name') {
          // Portable form: resolve the folder name against this machine's
          // workspace registry (the host entry injects the resolver).
          let resolved: string | undefined
          try {
            resolved = this.opts.resolveWorkspace !== undefined ? await this.opts.resolveWorkspace(t.name) : undefined
          } catch {
            resolved = undefined
          }
          if (resolved === undefined) {
            report.skipped.push(`plugin ${entry.plugin} target ${raw}: no workspace "${t.name}" registered on this machine`)
            continue
          }
          targets.push({ scope: 'workspace', workspacePath: resolved })
          continue
        }
        // Absolute path form: used only when the directory exists locally.
        try {
          const stat = await this.opts.fs.stat(t.path)
          if (!stat.isDirectory()) throw new Error('not a directory')
        } catch {
          report.skipped.push(`plugin ${entry.plugin} target ${raw}: workspace path missing on this machine`)
          continue
        }
        targets.push({ scope: 'workspace', workspacePath: t.path })
      }
      if (targets.length === 0) {
        report.skipped.push(`plugin ${entry.marketplace}/${entry.plugin}: no usable targets`)
        continue
      }
      const result = await this.installPlugin({ marketplaceId: id, plugin: entry.plugin, targets })
      if (result.ok) report.installed.push(key)
      else report.skipped.push(`plugin ${entry.plugin}: ${result.error ?? 'install failed'}`)
    }

    // 3. Model mappings seed a machine that has none saved locally.
    const models = Object.entries(section.models)
    if (models.length > 0 && Object.keys(await this.store.readModelMap()).length === 0) {
      const decoded: Record<string, string | null> = {}
      for (const [alias, model] of models) decoded[alias] = model === MIRROR_INHERIT ? null : model
      const adopted = await this.setAgentModelOverrides(decoded)
      if (adopted.ok) this.opts.logger?.info?.('dsh-next-cc-plugins adopted model mappings from the settings document')
    }

    // 4. A document with nothing to say backfills from local state, so the
    //    mirror exists before the first panel mutation. (Deleting the section
    //    does not uninstall; the mirror simply refills.)
    if (section.marketplaces.length === 0 && section.installs.length === 0 && Object.keys(section.models).length === 0) {
      const [marketplaces, installed, saved] = await Promise.all([
        this.store.listMarketplaces(),
        this.store.readInstalled(),
        this.store.readModelMap(),
      ])
      if (marketplaces.length > 0 || installed.plugins.length > 0 || Object.keys(saved).length > 0) {
        await this.mirrorCurrentState()
      }
    }

    if (report.marketplacesAdded.length + report.installed.length + report.skipped.length > 0) {
      this.opts.logger?.info?.(`dsh-next-cc-plugins settings reconcile: ${report.marketplacesAdded.length} marketplace(s) added, ${report.installed.length} plugin(s) installed, ${report.skipped.length} skipped`)
    }
    return report
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Copy one skill's files into `target`; returns an error message on failure. */
  private async copySkill(
    files: PluginFiles,
    skill: SkillComponent,
    target: string,
    pluginKey: string,
  ): Promise<string | undefined> {
    const skillFileMap = skillFiles(files, skill)
    if (skillFileMap['SKILL.md'] === undefined) return `skill "${skill.name}" has no SKILL.md`
    try {
      for (const [rel, content] of Object.entries(skillFileMap)) {
        if (!isSafeRelativePath(rel)) return `unsafe file path "${rel}" in skill "${skill.name}"`
        const dest = joinPath(target, rel)
        await this.opts.fs.mkdir(dirnamePath(dest), { recursive: true })
        await this.opts.fs.writeFile(dest, content)
      }
      await this.opts.fs.writeFile(joinPath(target, SOURCE_MARKER), JSON.stringify({ pluginKey }, null, 2))
    } catch (error) {
      await this.opts.fs.rm(target, { recursive: true, force: true }).catch(() => {})
      return `failed to install skill "${skill.name}": ${error instanceof Error ? error.message : String(error)}`
    }
    return undefined
  }

  private async trashDir(directory: string, name: string): Promise<void> {
    const root = dirnamePath(directory)
    const trashDir = joinPath(root, TRASH_DIR)
    try {
      await this.opts.fs.mkdir(trashDir, { recursive: true })
      await this.opts.fs.rename(directory, joinPath(trashDir, `${Date.now()}-${name}`))
    } catch {
      // A missing or already-moved directory is not fatal on removal paths.
    }
  }

  private async rollbackDirs(dirs: readonly string[]): Promise<void> {
    for (const dir of dirs) {
      await this.opts.fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Build the MCP rows for one plugin from its inventory. `previous` (update
   * path) preserves already-resolved server names for unchanged Claude keys.
   * Each definition's `${...}` templates are expanded against this plugin's
   * materialized root and the host environment first (Claude expands them at
   * load time; DSH's MCP client does not).
   */
  private buildMcpRows(
    key: string,
    inventory: PluginInventory,
    others: readonly InstalledPlugin[],
    previous?: readonly InstalledMcpRow[],
  ): { rows: InstalledMcpRow[]; notes: string[] } {
    const notes: string[] = []
    const rows: InstalledMcpRow[] = []
    for (const raw of inventory.mcpServers) {
      const expanded = expandMcpServerTemplates(raw, {
        pluginRoot: this.pluginRootOf(key),
        pluginData: this.pluginDataOf(key),
        env: this.opts.env ?? {},
      })
      notes.push(...expanded.notes)
      const server = expanded.server
      const { name: resolvedName, sanitized } = resolveServerName(server.name)
      let name = resolvedName
      if (sanitized) notes.push(`MCP server "${server.name}" renamed to "${name}" (invalid serverName characters)`)
      if (previous !== undefined) {
        const kept = previous.find((p) => p.claudeName === server.name && p.serverName !== name)
        if (kept !== undefined) name = kept.serverName
      }
      const unique = this.dedupeServerName(name, others)
      if (unique !== name) notes.push(`MCP server name "${name}" already in use; installed as "${unique}"`)
      rows.push({ rowId: mcpRowId(key, server.name), serverName: unique, claudeName: server.name, def: server.def })
    }
    return { rows, notes }
  }

  /** Ensure a serverName is unique across other installed plugins' servers. */
  private dedupeServerName(base: string, others: readonly InstalledPlugin[]): string {
    if (base === '') base = 'cc-server'
    const taken = new Set(others.flatMap((p) => p.mcpServers.map((s) => s.serverName)))
    if (!taken.has(base)) return base
    for (let i = 2; i < 100; i++) {
      const suffix = `-${i}`
      const candidate = base.slice(0, 32 - suffix.length) + suffix
      if (!taken.has(candidate)) return candidate
    }
    return base
  }

  /**
   * Build the agent delegation-tool rows for one plugin: each agents/*.md
   * becomes a `dsh-tool-subagent` row whose child runs the agent markdown as
   * its persona. `tools:` frontmatter is translated into `toolFilter.allow`
   * over DSH tool names — Claude built-ins through the well-known map,
   * `mcp__` refs through this plugin's installed MCP rows (so name dedupe
   * survives) — and `model:` frontmatter is resolved through
   * `agentModelMap` into `agentOptions.model`. `previous` (update path)
   * keeps stable tool names.
   */
  private buildAgentRows(
    key: string,
    pluginName: string,
    files: PluginFiles,
    inventory: PluginInventory,
    others: readonly InstalledPlugin[],
    mcpRows: readonly InstalledMcpRow[],
    modelMap: Readonly<Record<string, string>>,
    previous?: readonly InstalledAgentRow[],
  ): { rows: InstalledAgentRow[]; notes: string[] } {
    const notes: string[] = []
    if (inventory.agents.length === 0) return { rows: [], notes }
    const taken = new Set(others.flatMap((p) => p.agents.map((a) => a.toolName)))
    const rows: InstalledAgentRow[] = []
    for (const agent of inventory.agents) {
      const persona = agent.file !== undefined ? files[agent.file] ?? '' : ''
      if (persona === '') continue
      let toolName = `cc-agent-${sanitizeIdentifier(agent.name).toLowerCase()}`
      const kept = previous?.find((p) => p.claudeName === agent.name)
      if (kept !== undefined) toolName = kept.toolName
      if (toolName === '' || toolName === 'cc-agent-') toolName = `cc-agent-${sanitizeIdentifier(key).toLowerCase()}`
      if (taken.has(toolName)) {
        for (let i = 2; i < 100; i++) {
          const candidate = `${toolName.slice(0, 60)}-${i}`
          if (!taken.has(candidate)) { toolName = candidate; break }
        }
      }
      taken.add(toolName)
      const { tools, model } = agentFrontmatter(parseFrontmatter(persona))
      const translated = translateTools(tools, {
        pluginName,
        servers: mcpRows.map((row) => ({ claudeName: row.claudeName, serverName: row.serverName })),
        digest: (input) => createHash('sha256').update(input).digest('hex'),
      })
      notes.push(...translated.notes.map((note) => `agent "${agent.name}": ${note}`))
      const resolved = resolveAgentModel(model, modelMap)
      if (resolved.note !== undefined) notes.push(`agent "${agent.name}": ${resolved.note}`)
      rows.push({
        rowId: agentRowId(key, agent.name),
        toolName,
        claudeName: agent.name,
        persona,
        ...(translated.allow !== undefined ? { toolFilter: translated.allow } : {}),
        ...(resolved.model !== undefined ? { model: resolved.model } : {}),
      })
    }
    return { rows, notes }
  }

  /**
   * Write the plugin's files under the plugin data root: `<root>/plugins/<key>`.
   * This on-disk copy is the CLAUDE_PLUGIN_ROOT hook commands see.
   */
  private async materializePlugin(key: string, files: PluginFiles): Promise<void> {
    const dir = joinPath(this.pluginDataRoot(), 'plugins', safeDirId(key))
    await this.opts.fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    for (const [rel, content] of Object.entries(files)) {
      if (!isSafeRelativePath(rel)) continue
      const dest = joinPath(dir, rel)
      await this.opts.fs.mkdir(dirnamePath(dest), { recursive: true })
      await this.opts.fs.writeFile(dest, content)
    }
  }

  private async removeMaterializedPlugin(key: string): Promise<void> {
    const dir = joinPath(this.pluginDataRoot(), 'plugins', safeDirId(key))
    await this.opts.fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  private pluginDataRoot(): string {
    return joinPath(this.opts.dshHome, 'cc-plugins')
  }

  /** The materialized plugin copy's absolute path (CLAUDE_PLUGIN_ROOT twin). */
  private pluginRootOf(key: string): string {
    return joinPath(this.pluginDataRoot(), 'plugins', safeDirId(key))
  }

  /** The plugin's writable data directory (CLAUDE_PLUGIN_DATA twin). */
  private pluginDataOf(key: string): string {
    return joinPath(this.pluginDataRoot(), 'data', safeDirId(key))
  }

  /** Re-render the managed block from the full registry and splice the patch file. */
  private async writeManagedRows(plugins: readonly InstalledPlugin[]): Promise<void> {
    const rows: ManagedRow[] = plugins.flatMap((plugin) => [
      ...plugin.mcpServers.map((row): RawMcpServer => ({ rowId: row.rowId, serverName: row.serverName, def: row.def })),
      ...plugin.agents.map((row): RawAgentRow => ({
        rowId: row.rowId,
        toolName: row.toolName,
        persona: row.persona,
        ...(row.toolFilter !== undefined ? { toolFilter: row.toolFilter } : {}),
        ...(row.model !== undefined ? { model: row.model } : {}),
      })),
    ])
    const path = this.patchPath()
    let existing = ''
    try {
      existing = await this.opts.fs.readFile(path)
    } catch {
      // No patch file yet; the managed block creates it.
    }
    const next = applyManagedBlockText(existing, renderManagedBlock(rows))
    await this.opts.fs.mkdir(dirnamePath(path), { recursive: true })
    await this.opts.fs.writeFile(path, next)
  }

  /** Resolve one marketplace plugin's file map, fetching remote sources. */
  private async resolvePluginFiles(
    marketplaceId: string,
    pluginName: string,
  ): Promise<{ files: PluginFiles; entry: MarketplacePlugin; marketplaceSpec: string } | undefined> {
    const marketplaces = await this.store.listMarketplaces()
    const marketplace = marketplaces.find((m) => m.id === marketplaceId)
    if (marketplace === undefined) return undefined
    const snapshot = await this.store.readSnapshot(marketplaceId)
    if (snapshot === undefined) return undefined
    const entry = snapshot.index.plugins.find((p) => p.name === pluginName)
    if (entry === undefined) return undefined

    const source: PluginSource = entry.source
    if (source.kind === 'relative') {
      const files = this.pluginSubMap(snapshot.files, source.path)
      return files === undefined ? undefined : { files, entry, marketplaceSpec: marketplace.spec }
    }
    if (source.kind === 'github') {
      let tarball: Uint8Array
      try {
        tarball = await fetchRepoTarball(this.opts.fetch, source.owner, source.repo, source.ref)
      } catch (error) {
        throw new Error(`downloading ${source.owner}/${source.repo}: ${error instanceof Error ? error.message : String(error)}`)
      }
      const files: PluginFiles = {}
      for (const e of extractTarEntries(tarball)) {
        if (isSafeRelativePath(e.path)) files[e.path] = e.content
      }
      return { files, entry, marketplaceSpec: marketplace.spec }
    }
    return { files: {}, entry, marketplaceSpec: marketplace.spec }
  }
}

export { normalizeMcpServers }
