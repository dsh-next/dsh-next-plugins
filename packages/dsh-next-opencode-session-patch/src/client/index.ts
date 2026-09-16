
/**
 * Browser-half entry for the opencode-session-patch plugin.
 *
 * This plugin is host-only: the fetch patch must run in the DSH host process
 * where LLM requests originate. The browser half does nothing.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the browser half (no-op). */
export function apply(ctx: Context): void {
  void ctx
}
