/**
 * CI gate for the derived workspace browser: re-derives into a scratch
 * file and asserts the committed derivation constants match the installed
 * official client. Runs the same gates the build runs (version + SHA-256)
 * so a dependency drift fails loudly and early, before any bundling.
 */
import { readOfficialWorkspaceClient, deriveWorkspaceBrowser, SEAMS } from './derive-workspace-browser.mjs'

// Throws on version or hash drift.
const official = readOfficialWorkspaceClient()
deriveWorkspaceBrowser()
console.log(
  `workspace browser gate: ok (ui-workspace official client verified, seams ${SEAMS.length}, `
  + `${official.source.length} bytes)`,
)
