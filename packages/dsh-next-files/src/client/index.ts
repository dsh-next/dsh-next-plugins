/**
 * Browser-half entry for the files plugin — runs inside the dsh web GUI.
 *
 * The GUI loads this half from the bundle at /plugins/files/client.js
 * through window.__ModuleLoader__; the plugin context exposes the client
 * runtime services (sessions, workspaces, ui slots, ...).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the browser half. */
export function apply(ctx: Context): void {
  // TODO(files): browser-side behavior — runtime service wiring, DOM
  // slots, React views. A bare skeleton does nothing.
}
