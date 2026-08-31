/**
 * Host loader entry for the skills manager — runs in the DSH host process.
 *
 * Constructs the SkillsService over the DSH filesystem skill roots, serves
 * the settings section's JSON RPC route, and seeds the default providers on
 * first launch followed by an initial sync (so descriptions, stars, and
 * skill counts fill in without any click). Configured providers persist in
 * the plugin cache (`providers.json`). All behavior lives in `src/host/`
 * (stateful) and `src/core/` (pure); this entry stays thin.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { nodeFs } from './host/fs-adapter.ts'
import { registerRpc } from './host/rpc.ts'
import { SkillsService } from './host/skills-service.ts'

export const inject = ['webServer'] as const

/** Delay of the default-provider seed + first sync after boot (lets the host settle). */
const FIRST_SYNC_MS = 3 * 1000

export function apply(ctx: Context): void {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')

  const service = new SkillsService({
    fs: nodeFs(),
    fetch: (url, init) => fetch(url, init),
    dshHome,
    agentsHome,
  })

  registerRpc(ctx, service)

  // Seed defaults once, then run one initial sync so the Providers tab shows
  // descriptions, star counts, and skill counts without any click. Failures
  // are logged and surfaced on the provider rows; a later Refresh retries.
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void service.ensureDefaultProviders()
        .then(async () => {
          const result = await service.refreshProviders()
          if (result.ok === false) ctx.logger.warn(`dsh-next-skills initial provider sync: ${result.error}`)
        })
        .catch(() => {})
    }, FIRST_SYNC_MS)
    return () => clearTimeout(timer)
  }, 'dsh-next-skills: default providers seed + first sync')
}
