/**
 * Host loader entry for the worktrees plugin — runs in the DSH host process.
 *
 * The host half is a cordis plugin loaded from the profile composition via
 * the row in cordis.patch.yml (id worktrees). Most GUI plugins have no host
 * behavior beyond a system-prompt announcement. The actual UI lives in the
 * browser half (src/client/index.ts).
 *
 * Keep this entry thin. Put host-only logic in src/host/, pure shared logic
 * in src/core/, and browser logic in src/client/ (see docs/package-structure.md).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the host half. */
export function apply(ctx: Context): void {
  // TODO(worktrees): host-side behavior, e.g.
  //   ctx.systemPrompt.section({ name: 'plugin:worktrees', order: 200, text: '...' })
  // A pure browser plugin needs nothing here.
}
