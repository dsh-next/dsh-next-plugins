/**
 * Host loader entry for the previews plugin — runs in the DSH host process.
 *
 * The host half is a cordis plugin loaded from the profile composition via
 * the row in cordis.patch.yml (id previews). Most GUI plugins have no host
 * behavior beyond a system-prompt announcement. The actual UI lives in the
 * browser half (src/client/index.ts).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the host half. */
export function apply(ctx: Context): void {
  // TODO(previews): host-side behavior, e.g.
  //   ctx.systemPrompt.section({ name: 'plugin:previews', order: 200, text: '...' })
  // A pure browser plugin needs nothing here.
}
