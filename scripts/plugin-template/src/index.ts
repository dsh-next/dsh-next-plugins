/**
 * Host loader entry for the __NAME__ plugin — runs in the DSH host process.
 *
 * The host half is a cordis plugin loaded from the profile composition via
 * the row in cordis.patch.yml (id __NAME__). Most GUI plugins have no host
 * behavior beyond a system-prompt announcement. The actual UI lives in the
 * browser half (src/client/index.ts).
 *
 * Keep this entry thin. Put host-only logic in src/host/, pure shared logic
 * in src/core/, and browser logic in src/client/ (see docs/package-structure.md).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the host half. */
export function apply(ctx: Context): void {
  // TODO(__NAME__): host-side behavior, e.g.
  //   ctx.systemPrompt.section({ name: 'plugin:__NAME__', order: 200, text: '...' })
  // A pure browser plugin needs nothing here.
}
