/**
 * Host loader entry for the cc-plugins plugin — runs in the DSH host
 * process.
 *
 * Constructs the shared store, the CcMarketplaceService (marketplaces,
 * installs, managed composition rows) over the DSH roots, and the runtime
 * bridge (slash commands from installed plugins, Claude-compatible hooks
 * behind `runtime.hooks`), then serves the settings section's JSON RPC
 * route. Installs and uninstalls notify the runtime so commands re-register
 * without a reload. All behavior lives in `src/host/` (stateful) and
 * `src/core/` (pure); this entry stays thin.
 */
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
// Type-only: declares the `llm` service on Context for the Models tab's
// live model discovery.
import type {} from '@deepseek-ai/dsh-llm'
// Loads the `settings` service declaration on Context (the shareable
// user-settings document) plus the namespace brand helper.
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: declares the `workspaceRegistry` service on Context for the
// portable mirror-target resolver.
import type {} from '@deepseek-ai/dsh-workspace'
import type { SettingsMirror } from './core/mirror.ts'
import { nodeFs } from './host/fs-adapter.ts'
import { nodeHookRunner } from './host/hook-runner.ts'
import { registerRpc } from './host/rpc.ts'
import { CcRuntime } from './host/runtime.ts'
import { CcMarketplaceService } from './host/service.ts'
import { Store } from './host/store.ts'
import { dirnamePath, joinPath } from './core/path.ts'

export const inject = ['webServer'] as const

/** The shape `Config` resolves; the loader passes it as apply's second arg. */
export interface PluginConfig {
  runtime?: {
    commands?: boolean
    agents?: boolean
    hooks?: boolean
    /** Claude model id to DSH model id map for agent `model:` frontmatter. */
    agentModelMap?: Record<string, string>
  }
}

export const Config = Schema.object({
  runtime: Schema.object({
    commands: Schema.boolean().default(true).description('Register slash commands from installed Claude Code plugins'),
    agents: Schema.boolean().default(true).description('Expose installed plugins\' agents as delegation tools (composition rows; reload to apply)'),
    hooks: Schema.boolean().default(false).description('Run installed plugins\' hook commands (executes third-party shell; Claude-compatible stdin and env; includes prompt-observing events)'),
    // Cast to the global schema-instance interface so declaration emit can
    // name the member's type without a transitive cosmokit reference (TS2742).
    agentModelMap: (Schema.dict(Schema.string()) as Schemastery<Record<string, string>>).description('Claude model id to DSH model id map used for installed agents\' model: frontmatter (unmapped models inherit the parent\'s model)'),
  }),
})

/**
 * The `cc-plugins` settings-document section: the shareable mirror of this
 * plugin's setup, written through on every panel mutation and read back at
 * boot / on external edits (missing marketplaces and installs are adopted;
 * removals are never inferred).
 */
const MirrorSettingsSchema = Schema.object({
  marketplaces: Schema.array(Schema.string()).default([]).description('Marketplace specs (owner/repo shorthand, GitHub URL, or local path)'),
  installs: Schema.array(Schema.object({
    marketplace: Schema.string().description('The marketplace spec the plugin came from'),
    plugin: Schema.string().description('Plugin name inside the marketplace index'),
    workspaces: Schema.array(Schema.string()).default([]).description('Workspace folder names the plugin is scoped to; empty means global'),
  })).default([]).description('Installed plugins (presence only; versions follow upstream)'),
  // Cast as above: dict schemas trip declaration emit otherwise.
  models: (Schema.dict(Schema.string()) as Schemastery<Record<string, string>>).description('Claude model alias to DSH model id; "inherit" = the delegating session\'s model'),
})

export function apply(ctx: Context, config: PluginConfig = {}): void {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
  const dataRoot = joinPath(dshHome, 'cc-plugins')

  const store = new Store({ fs: nodeFs(), fetch: (url, init) => fetch(url, init), root: dataRoot, home: homedir() })

  const runtime = new CcRuntime({
    store,
    config: {
      commands: config.runtime?.commands !== false,
      hooks: config.runtime?.hooks === true,
    },
    runHook: nodeHookRunner(),
    pluginRoot: (key) => joinPath(dataRoot, 'plugins', key.replace(/[^A-Za-z0-9_.-]+/g, '_')),
    pluginData: (key) => {
      const dir = joinPath(dataRoot, 'data', key.replace(/[^A-Za-z0-9_.-]+/g, '_'))
      void nodeFs().mkdir(dirnamePath(dir), { recursive: true }).catch(() => {})
      return dir
    },
    logger: { warn: (message) => ctx.logger.warn(message) },
  })

  const service = new CcMarketplaceService({
    fs: nodeFs(),
    fetch: (url, init) => fetch(url, init),
    dshHome,
    agentsHome,
    home: homedir(),
    store,
    agentsEnabled: config.runtime?.agents !== false,
    agentModelMap: config.runtime?.agentModelMap,
    logger: {
      warn: (message) => { ctx.logger.warn(message) },
      info: (message) => { ctx.logger.info(message) },
    },
    listRuntimeModels: async () => {
      // Best effort: a composition without the llm service (or a provider
      // whose listing fails) degrades the Models tab to inherit-only pickers.
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.listProviders !== 'function') return []
      const providers = llm.listProviders()
      const lists = await Promise.all(providers.map(async (provider) => {
        try {
          return await llm.listModels(provider.id)
        } catch {
          return []
        }
      }))
      return lists.flat().map((model) => ({ provider: model.provider, id: model.id, name: model.name }))
    },
    resolveWorkspace: async (name) => {
      // Portable mirror targets carry a folder name; this machine's
      // workspace registry resolves it. Ambiguous or unknown names resolve
      // to undefined and reconcile skips the target with a note. Read at
      // call time: the registry may activate after this plugin.
      const registry = ctx.get('workspaceRegistry')
      if (registry === undefined || typeof registry.list !== 'function') return undefined
      try {
        const matches = (await registry.list()).filter((w) => basename(w.path) === name)
        return matches.length === 1 ? matches[0].path : undefined
      } catch {
        return undefined
      }
    },
    env: process.env,
    onInstalledChanged: () => void runtime.refresh(),
  })

  registerRpc(ctx, service)
  // Fresh installs seed the official Claude marketplace so the panel lists
  // plugins immediately; existing registries are never touched (the first
  // panel open then syncs the seeded marketplace best effort).
  void service.seedDefaultMarketplaces().catch(() => { /* seeding is best effort */ })
  runtime.attach(ctx)

  // The shareable settings mirror. The settings service usually activates
  // after this plugin, so the wiring lives on a scoped inject fiber: it
  // starts once settings is available, re-runs if the service bounces, and
  // disposes (clearing the mirror) with it. Compositions without the
  // service simply run unmirrored.
  ctx.inject(['settings'], (sctx) => {
    const provider = sctx.settings
    if (typeof provider.register !== 'function') return
    const scope = provider.register(settingsNamespace('cc-plugins'), MirrorSettingsSchema)
    const mirror: SettingsMirror = {
      read: () => scope.get(),
      write: async (section) => { await scope.replace(section as unknown as Record<string, unknown>) },
    }
    service.setSettingsMirror(mirror)
    sctx.effect(() => () => { service.setSettingsMirror(undefined) })
    // Adopt what a shared settings document carries (boot + hot-published
    // external edits); self-writes re-enter as no-op reconciles.
    sctx.effect(() => scope.watch(() => { void service.reconcileFromMirror() }))
    void service.reconcileFromMirror()
  })
}
