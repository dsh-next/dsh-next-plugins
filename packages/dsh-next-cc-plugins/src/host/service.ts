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
import { agentFrontmatter, resolveAgentModel, translateTools } from '../core/agents.ts'
import { parseFrontmatter } from '../core/frontmatter.ts'
import { applyManagedBlockText, normalizeMcpServers, renderManagedBlock, resolveServerName, type ManagedRow, type RawAgentRow, type RawMcpServer } from '../core/mcp.ts'
import { parseMarketplaceSpec } from '../core/source.ts'
import { isSkillName, sanitizeIdentifier } from '../core/name.ts'
import { dirnamePath, isSafeRelativePath, joinPath } from '../core/path.ts'
import { pluginInventory, pluginLevelReferenceNotes, readManifestPaths, skillFiles, type PluginFiles } from '../core/plugin-inventory.ts'
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
  MarketplacePlugin,
  MarketplacePluginView,
  MarketplaceViewRow,
  MutationResult,
  PluginDetail,
  PluginInventory,
  PluginSource,
  SkillComponent,
} from '../core/types.ts'

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

  constructor(private readonly opts: ServiceOptions) {
    this.store = opts.store ?? new Store({ fs: opts.fs, fetch: opts.fetch, root: joinPath(opts.dshHome, 'cc-plugins'), home: opts.home })
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

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  async state(): Promise<CcState> {
    const [marketplaces, installed] = await Promise.all([
      this.store.listMarketplaces(),
      this.store.readInstalled(),
    ])
    const rows: MarketplaceViewRow[] = []
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
      const installedKeys = new Set(installed.plugins.map((p) => p.key))
      const plugins: MarketplacePluginView[] = snapshot.index.plugins.map((plugin) => {
        const view: MarketplacePluginView = {
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          category: plugin.category,
          author: plugin.author,
          homepage: plugin.homepage,
          tags: plugin.tags,
          installed: installedKeys.has(`${m.id}/${plugin.name}`),
        }
        if (plugin.source.kind === 'unsupported') {
          view.sourceUnsupported = plugin.source.reason
        } else if (plugin.source.kind === 'relative') {
          const files = this.pluginSubMap(snapshot.files, plugin.source.path)
          if (files === undefined) {
            view.sourceUnsupported = `path "${plugin.source.path}" is missing from the marketplace snapshot`
          } else {
            view.inventory = pluginInventory(files)
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
    return { installed: installed.plugins, marketplaces: rows }
  }

  /** The sub-map of a marketplace snapshot below one plugin directory. */
  private pluginSubMap(files: Record<string, string>, dir: string): PluginFiles | undefined {
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
    scope: 'global' | 'workspace'
    workspacePath?: string
  }): Promise<MutationResult> {
    if (args.scope === 'workspace' && (args.workspacePath === undefined || args.workspacePath === '')) {
      return { ok: false, error: 'workspace scope requires a workspacePath' }
    }
    const key = `${args.marketplaceId}/${args.plugin}`
    const installed = await this.store.readInstalled()
    if (installed.plugins.some((p) => p.key === key)) {
      return { ok: false, error: `plugin "${args.plugin}" is already installed from this marketplace` }
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
    const root = this.skillsRoot(args.scope, args.workspacePath)
    if (root === undefined) return { ok: false, error: 'workspace scope requires a workspacePath' }

    // 1. Skills: copy each skill directory into the chosen skills root.
    const copiedDirs: string[] = []
    for (const skill of inventory.skills) {
      if (!isSkillName(skill.name)) {
        await this.rollbackDirs(copiedDirs)
        return { ok: false, error: `skill "${skill.name}" has a name the DSH skill registry rejects (kebab-case required)` }
      }
      const target = joinPath(root, skill.name)
      try {
        await this.opts.fs.access(target)
        await this.rollbackDirs(copiedDirs)
        return { ok: false, error: `skill "${skill.name}" already exists in the ${args.scope} skills root` }
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
    }

    // 2. MCP servers: managed dsh-mcp-client rows in the user patch file.
    const mcp = this.buildMcpRows(key, inventory, installed.plugins)

    // 3. Agent delegation tools: managed dsh-tool-subagent rows (persona from
    //    the agent markdown, translated tools/model frontmatter), only while
    //    runtime.agents is enabled.
    const agents = this.opts.agentsEnabled === true
      ? this.buildAgentRows(key, resolved.files, inventory, installed.plugins)
      : { rows: [] as InstalledAgentRow[], notes: [] as string[] }

    // 4. Materialize the plugin copy: the file cache drives the runtime
    //    bridge, and the on-disk copy gives hooks a real CLAUDE_PLUGIN_ROOT.
    await this.materializePlugin(key, resolved.files)

    // 5. Registry record + managed-block rewrite from the registry.
    const now = new Date().toISOString()
    const record: InstalledPlugin = {
      key,
      marketplaceId: args.marketplaceId,
      marketplaceSpec: resolved.marketplaceSpec,
      pluginName: args.plugin,
      version: resolved.entry.version,
      installedAt: now,
      updatedAt: now,
      scope: args.scope,
      ...(args.scope === 'workspace' && args.workspacePath !== undefined ? { workspacePath: args.workspacePath } : {}),
      skills: inventory.skills.map((s) => ({ name: s.name, directory: joinPath(root, s.name) })),
      mcpServers: mcp.rows,
      agents: agents.rows,
      pending: {
        commands: inventory.commands.map((c) => c.name),
        hookEvents: inventory.hookEvents,
      },
    }
    const plugins = [...installed.plugins, record]
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

    const pendingBits = [
      record.pending.commands.length > 0 ? `${record.pending.commands.length} command(s) registered` : '',
      agents.rows.length > 0 ? `${agents.rows.length} agent tool(s) written to cordis.patch.yml (reload to apply)` : '',
      record.pending.hookEvents.length > 0 ? `${record.pending.hookEvents.length} hook event(s) (enable runtime.hooks to activate)` : '',
    ].filter(Boolean)
    const parts = [
      inventory.skills.length > 0 ? `${inventory.skills.length} skill(s)` : '',
      mcp.rows.length > 0 ? `${mcp.rows.length} MCP server(s) written to cordis.patch.yml (restart DSH or reload the profile to attach)` : '',
      pendingBits.length > 0 ? pendingBits.join(', ') : '',
    ].filter(Boolean)
    const summary = parts.length > 0 ? parts.join('; ') : 'no installable components found'
    const notes = [...mcp.notes, ...agents.notes, ...pluginLevelReferenceNotes(resolved.files, inventory.skills)]
    const message = notes.length > 0 ? `installed "${args.plugin}": ${summary}; ${notes.join('; ')}` : `installed "${args.plugin}": ${summary}`
    return { ok: true, message, state: await this.state() }
  }

  async uninstallPlugin(key: string): Promise<MutationResult> {
    const installed = await this.store.readInstalled()
    const record = installed.plugins.find((p) => p.key === key)
    if (record === undefined) return { ok: false, error: `plugin "${key}" is not installed` }

    // 1. Skills -> recoverable trash inside each skill's root.
    for (const skill of record.skills) {
      await this.trashDir(skill.directory, skill.name)
    }

    // 2. The materialized plugin copy (hooks' CLAUDE_PLUGIN_ROOT) goes away.
    await this.removeMaterializedPlugin(key)

    // 3. Managed rows (MCP + agents): rebuild from the remaining records.
    const kept = installed.plugins.filter((p) => p.key !== key)
    await this.writeManagedRows(kept)
    await this.store.saveInstalled({ plugins: kept })
    this.opts.onInstalledChanged?.()
    return {
      ok: true,
      message: `uninstalled "${record.pluginName}" (${record.skills.length} skill(s) moved to .trash, ${record.mcpServers.length} MCP row(s) and ${record.agents.length} agent row(s) removed)`,
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
    const root = this.skillsRoot(record.scope, record.workspacePath)
    if (root === undefined) return { ok: false, error: 'stored install has no usable skills root' }

    const errors: string[] = []
    const skillDirs: Array<{ name: string; directory: string }> = []
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
    for (const old of record.skills) {
      if (seen.has(old.name)) continue
      await this.trashDir(old.directory, old.name)
    }
    if (errors.length > 0 && skillDirs.length === 0 && inventory.skills.length > 0) {
      return { ok: false, error: `update failed: ${errors.join('; ')}` }
    }

    // MCP rows keep previously resolved server names when the Claude server
    // key survives upstream, so model-visible tool names stay stable. The
    // plugin's own previous rows are excluded from the dedupe set.
    const others = installed.plugins.filter((p) => p.key !== key)
    const mcp = this.buildMcpRows(key, inventory, others, record.mcpServers)
    const agents = this.opts.agentsEnabled === true
      ? this.buildAgentRows(key, resolved.files, inventory, others, record.agents)
      : { rows: [] as InstalledAgentRow[], notes: [] as string[] }

    await this.materializePlugin(key, resolved.files)

    const updated: InstalledPlugin = {
      ...record,
      version: resolved.entry.version,
      updatedAt: new Date().toISOString(),
      skills: skillDirs,
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
    const versionText = resolved.entry.version !== '' ? resolved.entry.version : 'latest'
    const notes = [...mcp.notes, ...agents.notes, ...pluginLevelReferenceNotes(resolved.files, inventory.skills)]
    const message = notes.length > 0
      ? `updated "${record.pluginName}" to ${versionText}${skipped}; ${notes.join('; ')}`
      : `updated "${record.pluginName}" to ${versionText}${skipped}`
    return { ok: true, message, state: await this.state() }
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
   */
  private buildMcpRows(
    key: string,
    inventory: PluginInventory,
    others: readonly InstalledPlugin[],
    previous?: readonly InstalledMcpRow[],
  ): { rows: InstalledMcpRow[]; notes: string[] } {
    const notes: string[] = []
    const rows: InstalledMcpRow[] = []
    for (const server of inventory.mcpServers) {
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
   * (DSH tool names; unmapped Claude tools drop with a note) and `model:`
   * frontmatter is resolved through `agentModelMap` into `agentOptions.model`.
   * `previous` (update path) keeps stable tool names.
   */
  private buildAgentRows(
    key: string,
    files: PluginFiles,
    inventory: PluginInventory,
    others: readonly InstalledPlugin[],
    previous?: readonly InstalledAgentRow[],
  ): { rows: InstalledAgentRow[]; notes: string[] } {
    const notes: string[] = []
    if (inventory.agents.length === 0) return { rows: [], notes }
    const paths = readManifestPaths(files)
    const agentsDir = (paths.agents ?? 'agents').replace(/^\.\/+/, '').replace(/\/+$/, '')
    const taken = new Set(others.flatMap((p) => p.agents.map((a) => a.toolName)))
    const rows: InstalledAgentRow[] = []
    for (const agent of inventory.agents) {
      const persona = files[`${agentsDir}/${agent.path}`] ?? ''
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
      const translated = translateTools(tools)
      notes.push(...translated.notes.map((note) => `agent "${agent.name}": ${note}`))
      const resolved = resolveAgentModel(model, this.opts.agentModelMap ?? {})
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
