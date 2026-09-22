/** Host wiring for global skill management. Native filesystem discovery owns
 * availability and frontmatter invocation; legacy scope settings are ignored.
 *
 * DeepSeek Harness 0.1.7 derives plugin settings from the owning Loader entry's
 * own config, so the provider and installation ledgers are this plugin's
 * `Config` rather than a registered namespace. Both fields are volatile, so a
 * write commits into the running fiber without a restart. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { nodeFs } from './host/fs-adapter.ts'
import { registerRpc } from './host/rpc.ts'
import { SkillsService, type ConfigScopeFace } from './host/skills-service.ts'
import { skillsConfigSchema, type SkillsConfigShape } from './core/schema.ts'
import { DEFAULT_PROVIDER_SPECS } from './core/defaults.ts'
import type { ExternalMutationResult, InstallExternalSkillsArgs, RemoveExternalSkillsArgs } from './core/types.ts'

export const name = 'dsh-next-skills'

export const inject = ['webServer', 'settings'] as const

/** The Loader reads the exported schema to build this plugin's settings form. */
export const Config = skillsConfigSchema

export type { SkillsConfigShape }

/** Structural face of the profile config editor this plugin writes through. */
interface ConfigEditorFace {
  edit(
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/** The skills service's config face over the volatile Loader config. */
function configFace(ctx: Context, config: SkillsConfigShape | undefined): ConfigScopeFace | undefined {
  const entry = (ctx as unknown as { fiber?: { entry?: unknown } }).fiber?.entry
  const editor = ctx.get('configEditor') as ConfigEditorFace | undefined
  if (config === undefined || entry === undefined || editor === undefined) return undefined
  return {
    get: () => ({ providers: config.providers.get(), installations: config.installations.get() }),
    replace: async (section) => {
      await editor.edit(entry, (raw) => ({ ...raw, ...section as Record<string, unknown> }))
    },
  }
}

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

export function apply(ctx: Context, config?: SkillsConfigShape): void {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
  const fs = nodeFs()

  // The plugin's configuration is its own Loader entry config; without a
  // profile config editor there is nowhere to persist the provider and
  // installation ledgers, so the plugin stays inert.
  const configFaceValue = configFace(ctx, config)
  if (configFaceValue === undefined) {
    ctx.logger.warn('dsh-next-skills: configuration is unavailable; the plugin cannot persist installs')
    return
  }

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
    config: configFaceValue,
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
