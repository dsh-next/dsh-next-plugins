
/**
 * Host entry for the opencode-session-patch plugin — runs in the DSH host process.
 *
 * The OpenCode Go provider rejects requests without `x-opencode-session` and
 * no SDK layer exposes a per-request header seam, so this plugin patches the
 * host-process `globalThis.fetch` and stamps the header with the current dsh
 * session id for every request to that endpoint. The patch is effect scoped:
 * disposal restores the original fetch.
 *
 * This plugin has no browser half; src/client/index.ts is a no-op stub.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { applySessionHeaderPatch } from './host/session-header.ts'

/** Cordis plugin name. */
export const name = 'dsh-next-opencode-session-patch'

/** Required services: the agent registry (initiator scope). */
export const inject = ['agents'] as const

/** Apply the host half. */
export function apply(ctx: Context): void {
  const restore = applySessionHeaderPatch(ctx.agents, (message) => {
    console.info(`[dsh-next-opencode-session-patch] ${message}`)
  })
  ctx.effect((): (() => void) => restore, 'dsh-next-opencode-session-patch: restore globalThis.fetch')
}
