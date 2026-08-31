/**
 * Standalone tsdown config for the cc-plugins plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts —
 * closure-factory artifact for window.__ModuleLoader__, CSS Modules inlined,
 * externals resolved through the loader module table). The node half builds
 * from src (tsdown compiles TS directly) and types ship from lib/types (tsc).
 *
 * Every @deepseek-ai/* package is a peer service provided by the DSH profile
 * tree at runtime, so the host half keeps them external (never bundled). If a
 * future plugin intentionally bundles one of these, narrow this list.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

const HOST_EXTERNALS = [
  /^@deepseek-ai\//,
]

export default clientBundle('@dsh-next/dsh-next-cc-plugins', ['src/index.ts'], {
  libExternal: HOST_EXTERNALS,
})
