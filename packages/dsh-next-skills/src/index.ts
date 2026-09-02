/**
 * Host loader entry for the skills manager — runs in the DSH host process.
 *
 * The settings-backed model:
 *  - Registers the `dsh-next-skills` settings namespace, so providers,
 *    installed records, and per-name enablement scopes persist in the
 *    harness `settings.yaml` (readable and shareable between developers).
 *  - Registers the plugin's `ctx.skills` provider, which re-publishes the
 *    filesystem provider's candidates with rank lowered by one and applies
 *    the per-workspace scope policy — enable/disable is pure config and no
 *    skill file is ever written for it.
 *  - Migrates the legacy state (providers.json, frontmatter toggles,
 *    workspace shadows, workspace installs) once, seeds default providers on
 *    a fresh install, syncs the provider caches, and reconciles recorded
 *    installs whose files are missing (the sharing payoff).
 *
 * Skills install GLOBAL-ONLY into `<agentsHome>/skills`; projects keep only
 * hand-created, version-controlled skills. All behavior lives in
 * `src/host/` (stateful) and `src/core/` (pure); this entry stays thin.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { nodeFs } from './host/fs-adapter.ts'
import { registerRpc } from './host/rpc.ts'
import { SkillsService, type ConfigScopeFace } from './host/skills-service.ts'
import { createManagedSkillProvider, MANAGED_PROVIDER_NAME } from './host/skills-provider.ts'
import { SKILLS_NAMESPACE, skillsConfigSchema } from './core/schema.ts'
import { DEFAULT_PROVIDER_SPECS } from './core/defaults.ts'

export const inject = ['webServer', 'settings'] as const

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
    ? settings.register(settingsNamespace(SKILLS_NAMESPACE), skillsConfigSchema, { applies: 'live' })
    : undefined
  if (settingsScope === undefined) {
    ctx.logger.warn('dsh-next-skills: settings service unavailable; configuration cannot persist')
    return
  }
  const configFace = settingsScope as unknown as ConfigScopeFace

  const service = new SkillsService({
    fs,
    fetch: (url, init) => fetch(url, init),
    dshHome,
    agentsHome,
    logWarn: (message) => ctx.logger.warn(message),
    config: configFace,
  })

  // Register the ctx.skills provider override. Scope edits invalidate the
  // provider's catalog so a disable takes effect on the next lookup. The
  // registry is read as an optional service — a ctx.skills property access
  // without `inject` is rejected by the loader.
  const skillsRegistry = ctx.get('skills') as SkillRegistry | undefined
  if (skillsRegistry && typeof skillsRegistry.registerProvider === 'function') {
    const unregister = skillsRegistry.registerProvider((control) => {
      const disposeWatch = configFace.watch(() => control.invalidate())
      control.signal.addEventListener('abort', () => disposeWatch(), { once: true })
      return createManagedSkillProvider({ fs, dshHome, agentsHome, config: configFace })
    })
    ctx.effect(() => unregister, `dsh-next-skills: ${MANAGED_PROVIDER_NAME} provider`)
  } else {
    ctx.logger.warn('dsh-next-skills: ctx.skills registry unavailable; scope policy will not apply')
  }

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
