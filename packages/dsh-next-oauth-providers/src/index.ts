/**
 * Host loader for subscription OAuth providers.
 *
 * DeepSeek Harness 0.1.7 derives plugin settings from the owning Loader entry's
 * own config, so the provider section is this plugin's `Config` rather than a
 * registered settings namespace. Every configured family is also declared to
 * the native configurable-provider directory at `providers.<nativeId>`, which
 * gives it a native Models row; the plugin keeps its own adapter, grants, and
 * same-origin RPC.
 *
 * Instantiates official PiAiAdapter with plugin-scoped grants and alias
 * routes. Does not write the `llm-pi-ai` section and does not reuse its
 * credential records.
 */
import type { Context } from '@deepseek-ai/cordis'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {
  AdapterRegistrationHandle,
  DirectoryRegistrationHandle,
  LlmConfigurableProvider,
} from '@deepseek-ai/dsh-llm'
import { FAMILIES } from './core/catalog.ts'
import { pluginConfigSchema, SETTINGS_NS, type PluginConfigShape } from './core/schema.ts'
import type { PluginConfig } from './core/settings.ts'
import { AliasLlmAdapter } from './host/adapter.ts'
import { credentialStoreFrom, denyAmbientAuthContext } from './host/credentials.ts'
import { registerRpc } from './host/rpc.ts'
import { SubscriptionsService, type ConfigScopeFace } from './host/service.ts'

export const name = 'dsh-next-oauth-providers'

export const inject = ['webServer', 'llm', 'credentials'] as const

/** The Loader reads the exported schema to build this plugin's settings form. */
export const Config = pluginConfigSchema

export type { PluginConfigShape }

/** The volatile section this plugin reads and writes. */
interface ProvidersRef {
  get(): unknown
}

/** Structural face of the profile config editor this plugin writes through. */
interface ConfigEditorFace {
  edit(
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function apply(ctx: Context, config?: PluginConfigShape): void {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    ctx.logger.warn('dsh-next-oauth-providers: credentials service unavailable')
    return
  }

  const providersRef = (config?.providers ?? { get: () => [] }) as unknown as ProvidersRef
  const entry = (ctx as unknown as { fiber?: { entry?: unknown } }).fiber?.entry
  const entryId = (entry as { options?: { id?: string } } | undefined)?.options?.id ?? SETTINGS_NS
  const editor = ctx.get('configEditor') as ConfigEditorFace | undefined

  const store = credentialStoreFrom(credentials)
  const auth = { credentials: store, authContext: denyAmbientAuthContext() }

  /** Persist the next provider section through the native profile patch. */
  const write = async (providers: unknown): Promise<void> => {
    if (editor === undefined || entry === undefined) return
    await editor.edit(entry, (current) => ({ ...current, providers }))
  }

  const scope: ConfigScopeFace = {
    get: () => ({ providers: providersRef.get() }),
    update: async (patch) => {
      const next = asRecord(patch)
      const providers = 'providers' in next ? next.providers : providersRef.get()
      await write(providers)
    },
    replace: async (section) => {
      await write(asRecord(section).providers ?? [])
    },
    watch: () => () => {},
  }

  let handle: AdapterRegistrationHandle | undefined
  let directory: DirectoryRegistrationHandle | undefined
  let syncRoutes: (aliases: readonly (typeof FAMILIES)[number]['alias'][]) => void = () => {}

  /** Declare every configured family to the native provider directory. */
  const syncDirectory = (stored: PluginConfig): void => {
    const entries: LlmConfigurableProvider[] = []
    for (const family of FAMILIES) {
      if (stored.providers[family.nativeId] === undefined) continue
      entries.push({
        provider: family.alias,
        displayName: family.displayName,
        settingsNs: entryId,
        settingsPath: ['providers', family.nativeId],
      })
    }
    try {
      if (entries.length === 0) {
        directory?.()
        directory = undefined
        return
      }
      if (directory === undefined) directory = ctx.llm.registerConfigurableProviders(entries)
      else directory.replace(entries)
    } catch (error) {
      ctx.logger.warn(`dsh-next-oauth-providers: provider directory update failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const service = new SubscriptionsService({
    store,
    config: scope,
    fetch: (url, init) => fetch(url, init),
    logWarn: (message) => ctx.logger.warn(message),
    onRoutesChanged: (aliases) => syncRoutes(aliases),
    onConfigChanged: (reason) => {
      void (async () => {
        // A user edit is the only signal that a family left the configuration;
        // hydration's shape rewrite preserves the listed set.
        if (reason === 'user') await service.pruneUnlisted()
        syncDirectory(service.configValue())
      })().catch((error: unknown) => {
        ctx.logger.warn(`dsh-next-oauth-providers: config sync failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    },
  })

  const inner = new PiAiAdapter({
    profiles: () => service.profiles(),
    resolveApiKey: async () => undefined,
    auth,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      (hostPath) => ctx.get('fs')?.processPathFromHostPath?.(hostPath),
      ref,
    ),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(`dsh-next-oauth-providers: unusable replay state for ${provider}/${model} (${reason})`)
    },
  })
  const alias = new AliasLlmAdapter(inner)

  syncRoutes = (aliases) => {
    const routes = [...aliases]
    try {
      if (handle === undefined) {
        if (routes.length === 0) return
        handle = ctx.llm.registerAdapter(routes, alias)
        return
      }
      handle.replace(routes)
    } catch (error) {
      ctx.logger.warn(`dsh-next-oauth-providers: route update failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  registerRpc(ctx, service)

  ctx.effect(() => {
    void service.hydrate().then(() => {
      syncDirectory(service.configValue())
    }).catch((error: unknown) => {
      ctx.logger.warn(`dsh-next-oauth-providers hydrate: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      syncRoutes = () => {}
      service.dispose()
      handle?.()
      directory?.()
      directory = undefined
    }
  }, 'dsh-next-oauth-providers: hydrate')
}
