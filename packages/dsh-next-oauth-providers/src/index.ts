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
import { normalizeConfig, type PluginConfig } from './core/settings.ts'
import { AliasLlmAdapter } from './host/adapter.ts'
import { credentialStoreFrom, denyAmbientAuthContext } from './host/credentials.ts'
import { registerRpc } from './host/rpc.ts'
import { SubscriptionsService, type ConfigScopeFace } from './host/service.ts'

export const name = 'dsh-next-oauth-providers'

export const inject = ['webServer', 'llm', 'credentials', 'settings'] as const

/** The Loader reads the exported schema to build this plugin's settings form. */
export const Config = pluginConfigSchema

export type { PluginConfigShape }

/** Bound on waiting for a config write to reach the live fiber (100 x 20ms). */
const PUBLISH_ATTEMPTS = 100

/** Interval between publish checks while a config write settles. */
const PUBLISH_INTERVAL_MS = 20

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

/** The settings service's describe face, host side (no redaction). */
interface SettingsDescribeFace {
  describe(options?: { redactSecrets?: boolean }): Array<{ ns: string; revision: number; value?: unknown; user?: unknown }>
}

/** The `providers` section a settings value carries, or undefined when it carries none. */
function providersOf(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return 'providers' in value ? (value as { providers: unknown }).providers : undefined
}

/** Whether a providers section names anything: a row array or a profile dict. */
function listsProviders(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0
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
  const settings = ctx.get('settings') as SettingsDescribeFace | undefined

  const store = credentialStoreFrom(credentials)
  const auth = { credentials: store, authContext: denyAmbientAuthContext() }

  /**
   * The section to read. The settings service projects the *live* fiber's
   * config, which is what a `configEditor` write publishes; the resolved
   * volatile reference the plugin was handed can lag that commit, so it is
   * only a fallback.
   *
   * An empty resolved section does not always mean an empty configuration: a
   * pre-0.1.7 `settings.yaml` section stores `providers` as a row array, which
   * the dict schema cannot carry and resolves to its empty default. The raw
   * user layer still holds those rows, so it is read here — that is what lets
   * `hydrate()` rewrite the stored section into the dict shape once instead of
   * dropping an existing setup.
   */
  const readProviders = (): unknown => {
    let descriptor: { value?: unknown; user?: unknown } | undefined
    try {
      descriptor = settings?.describe?.().find((row) => row.ns === entryId)
    } catch {
      // A settings surface that cannot describe falls through to the fiber config.
    }
    if (descriptor !== undefined) {
      const resolved = providersOf(descriptor.value)
      if (listsProviders(resolved)) return resolved
      const stored = providersOf(descriptor.user)
      return listsProviders(stored) ? stored : resolved
    }
    const live = (entry as { options?: { config?: { providers?: unknown } } } | undefined)?.options?.config?.providers
    return live !== undefined ? live : providersRef.get()
  }

  /**
   * Wait for the write to reach the live fiber. The profile's own patch reload
   * publishes a `configEditor` write, so the running section can trail the
   * edit; answering an RPC before it lands would report the previous profile.
   */
  const awaitPublished = async (providers: unknown): Promise<void> => {
    const expected = JSON.stringify(normalizeConfig({ providers }))
    for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt += 1) {
      const live = (entry as { options?: { config?: { providers?: unknown } } } | undefined)?.options?.config?.providers
      if (JSON.stringify(normalizeConfig({ providers: live })) === expected) return
      await new Promise<void>((resolve) => { setTimeout(resolve, PUBLISH_INTERVAL_MS) })
    }
  }

  /** Persist the next provider section through the native profile patch. */
  const write = async (providers: unknown): Promise<void> => {
    if (editor === undefined || entry === undefined) return
    await editor.edit(entry, (current) => ({ ...current, providers }))
    await awaitPublished(providers)
  }

  const scope: ConfigScopeFace = {
    get: () => ({ providers: readProviders() }),
    update: async (patch) => {
      const next = asRecord(patch)
      const providers = 'providers' in next ? next.providers : readProviders()
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
