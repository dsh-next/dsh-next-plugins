/**
 * Standalone tsdown config for the notifier plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts —
 * closure-factory artifact for window.__ModuleLoader__, CSS Modules inlined,
 * externals resolved through the loader module table). The node half builds
 * from src (tsdown compiles TS directly) and types ship from lib/types (tsc).
 *
 * The host peer SDK packages are kept external (never bundled): they resolve
 * at runtime from the DSH profile tree, and bundling them would duplicate
 * module identity (schemastery, settings service, etc.).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

const HOST_EXTERNALS = [
  '@deepseek-ai/schemastery',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-goal',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-scope',
]

export default clientBundle('@dsh-next/dsh-next-notifier', ['src/index.ts'], {
  libExternal: HOST_EXTERNALS,
})
