/**
 * Standalone tsdown config for the org plugin skeleton.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts —
 * closure-factory artifact for window.__ModuleLoader__, CSS Modules inlined,
 * externals resolved through the loader module table). The node half builds
 * from src (tsdown compiles TS directly) and types ship from lib/types (tsc).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@dsh-next/dsh-next-org', ['src/index.ts'])
