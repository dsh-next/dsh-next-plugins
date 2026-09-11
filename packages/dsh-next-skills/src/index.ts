/** Host wiring for global skill management. Native filesystem discovery owns
 * availability and frontmatter invocation; legacy scope settings are ignored. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { nodeFs } from './host/fs-adapter.ts'
import { registerRpc } from './host/rpc.ts'
import { SkillsService, type ConfigScopeFace } from './host/skills-service.ts'
import { SKILLS_NAMESPACE, skillsConfigSchema } from './core/schema.ts'
import { DEFAULT_PROVIDER_SPECS } from './core/defaults.ts'
import type { ExternalMutationResult, InstallExternalSkillsArgs, RemoveExternalSkillsArgs } from './core/types.ts'

export const inject = ['webServer', 'settings'] as const

/** Cordis service key the cc-plugins bridge resolves to drive external skills. */
export const EXTERNAL_SKILLS_SERVICE = 'cc-external-skills'

/**
 * The narrow cross-plugin service surface the cc-plugins bridge consumes.
 * Kept deliberately tiny and decoupled from claude-plugin internals: the
 * owning plugin rewrites references and hands off finished files; this
 * service only places and removes them globally.
 */
export interface ExternalSkillsService {
  installExternalSkills(args: InstallExternalSkillsArgs): Promise<ExternalMutationResult>
  removeExternalSkills(args: RemoveExternalSkillsArgs): Promise<ExternalMutationResult>
}

/** Delay of the boot sequence after mount (lets the host settle). */
const BOOT_DELAY_MS = 3 * 1000

export function apply(ctx: Context): void {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
  const fs = nodeFs()

  // Register the settings namespace (typed scope). The settings service is a
  // declared dependency; a host without it cannot run the settings model.
  const settings = ctx.get('settings') as { register?: (ns: unknown, schema: unknown, opts?: unknown) => SettingsScope<never> } | undefined
  const settingsScope = settings && typeof settings.register === 'function'
    ? settings.register(SKILLS_NAMESPACE, skillsConfigSchema, { applies: 'live' })
    : undefined
  if (settingsScope === undefined) {
    ctx.logger.warn('dsh-next-skills: settings service unavailable; configuration cannot persist')
    return
  }
  const configFace = settingsScope as unknown as ConfigScopeFace

  // Borrow the registry's supported invalidation capability without publishing
  // candidates or overriding native invocation policy. The native watcher is
  // asynchronous, so mutations must clear warm catalogs before returning to UI.
  let invalidateInstalled: (() => void) | undefined
  const registry = ctx.get('skills') as SkillRegistry | undefined
  if (registry && typeof registry.registerProvider === 'function') {
    const unregister = registry.registerProvider((control) => {
      invalidateInstalled = control.invalidate
      return {
        name: 'dsh-next-skills-invalidation',
        list: async () => [],
        get: async () => undefined,
      }
    })
    ctx.effect(() => () => {
      invalidateInstalled = undefined
      unregister()
    }, 'dsh-next-skills: native catalog invalidation')
  }

  const service = new SkillsService({
    fs,
    fetch: (url, init) => fetch(url, init),
    dshHome,
    agentsHome,
    logWarn: (message) => ctx.logger.warn(message),
    config: configFace,
    onInstalledChanged: () => invalidateInstalled?.(),
  })

  // Provide the cross-plugin external-skills surface (the cc-plugins bridge
  // resolves this via ctx.get). A composition without this plugin simply has
  // no service; the cc plugin degrades with a visible note.
  ctx.provide(EXTERNAL_SKILLS_SERVICE, {
    installExternalSkills: (args) => service.installExternalSkills(args),
    removeExternalSkills: (args) => service.removeExternalSkills(args),
  } satisfies ExternalSkillsService)

  registerRpc(ctx, service)

  // Boot sequence: seed defaults on a fresh install, sync the provider
  // caches, and reconcile recorded installs whose files are missing (what
  // makes a shared settings section portable).
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await service.ensureDefaultProviders(DEFAULT_PROVIDER_SPECS)
        } catch (error) {
          ctx.logger.warn(`dsh-next-skills boot (defaults): ${error instanceof Error ? error.message : String(error)}`)
        }
        try {
          const result = await service.refreshProviders()
          if (result.ok === false) ctx.logger.warn(`dsh-next-skills provider sync: ${result.error}`)
        } catch {
          // Network failures are surfaced on the provider rows; retry via Refresh.
        }
        try {
          const notes = await service.reconcileInstalled()
          if (notes.length > 0) ctx.logger.warn(`dsh-next-skills reconcile: ${notes.join('; ')}`)
        } catch (error) {
          ctx.logger.warn(`dsh-next-skills reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    }, BOOT_DELAY_MS)
    return () => clearTimeout(timer)
  }, 'dsh-next-skills: boot sequence (defaults, sync, reconcile)')
}
