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
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
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
    onInstalledChanged: () => void runtime.refresh(),
  })

  registerRpc(ctx, service)
  runtime.attach(ctx)
}
