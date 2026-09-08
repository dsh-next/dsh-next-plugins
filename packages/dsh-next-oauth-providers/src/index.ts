/**
 * Host loader for subscription OAuth providers.
 *
 * Instantiates official PiAiAdapter with plugin-scoped grants and alias
 * routes. Does not write llm-pi-ai settings and does not reuse llm-pi-ai
 * credential records.
 */
import type { Context } from '@deepseek-ai/cordis'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { AliasRoute } from './core/catalog.ts'
import { pluginConfigSchema, SETTINGS_NS } from './core/schema.ts'
import { AliasLlmAdapter } from './host/adapter.ts'
import { credentialStoreFrom, denyAmbientAuthContext } from './host/credentials.ts'
import { registerRpc } from './host/rpc.ts'
import { SubscriptionsService } from './host/service.ts'

export const inject = ['webServer', 'llm', 'credentials', 'settings'] as const

export function apply(ctx: Context): void {
  const settings = ctx.get('settings') as { register?: (ns: unknown, schema: unknown, opts?: unknown) => SettingsScope<never> } | undefined
  const settingsScope = settings && typeof settings.register === 'function'
    ? settings.register(SETTINGS_NS, pluginConfigSchema, { applies: 'live' })
    : undefined
  if (settingsScope === undefined) {
    ctx.logger.warn('dsh-next-oauth-providers: settings service unavailable; configuration cannot persist')
    return
  }
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    ctx.logger.warn('dsh-next-oauth-providers: credentials service unavailable')
    return
  }

  const store = credentialStoreFrom(credentials)
  const auth = { credentials: store, authContext: denyAmbientAuthContext() }

  let handle: AdapterRegistrationHandle | undefined
  let syncRoutes: (aliases: readonly AliasRoute[]) => void = () => {}

  const service = new SubscriptionsService({
    store,
    config: settingsScope,
    fetch: (url, init) => fetch(url, init),
    logWarn: (message) => ctx.logger.warn(message),
    onRoutesChanged: (aliases) => syncRoutes(aliases),
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
    void service.hydrate().catch((error: unknown) => {
      ctx.logger.warn(`dsh-next-oauth-providers hydrate: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      syncRoutes = () => {}
      service.dispose()
      handle?.()
    }
  }, 'dsh-next-oauth-providers: hydrate')
}
