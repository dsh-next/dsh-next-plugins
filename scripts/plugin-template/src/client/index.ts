/**
 * Browser-half entry for the __NAME__ plugin — runs inside the dsh web GUI.
 *
 * The GUI loads this half from the bundle at /plugins/__NAME__/client.js
 * through window.__ModuleLoader__; the plugin context exposes the client
 * runtime services (sessions, workspaces, ui slots, ...).
 *
 * Keep this entry thin. Put browser-only views, slots, hooks, and CSS Modules
 * under src/client/, and pure shared logic in src/core/ (see
 * docs/package-structure.md).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the browser half. */
export function apply(ctx: Context): void {
  // TODO(__NAME__): browser-side behavior — runtime service wiring, DOM
  // slots, React views. A bare skeleton does nothing.
}
