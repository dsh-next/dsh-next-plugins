/**
 * Derive this plugin's workspace browser from the OFFICIAL client bundle.
 *
 * Strategy B (docs/ideas/dsh-next-worktrees-sidebar-ux.md): the stock
 * `ui-workspace` loader row is disabled by cordis.patch.yml and this plugin
 * ships the official browser, wrapped. The official client source is read
 * from node_modules at build time — the DSH checkout itself is never
 * touched — and gated on the exact package version plus a SHA-256 of the
 * client bytes, so any upstream drift fails this build closed instead of
 * shipping a silently wrong browser. This is the same contract the wloops
 * incumbent uses (independently derived; the shared hash below is expected
 * — both pin 0.1.2-rc.1's exact build).
 *
 * Output: src/generated/workspace-browser.generated.mjs exporting
 * `runOfficialWorkspaceClient(require)`, plus its .d.mts declaration. The
 * generated folder is gitignored; every build regenerates it.
 *
 * Why a `require` parameter instead of static imports: the shared tsdown
 * preset wraps our whole client bundle in `window.__ModuleLoader__.load`
 * with `factory: (require) => {...}`, so at runtime the loader-provided
 * require is in scope. Feeding it to the official factory body resolves
 * its platform dependencies (cordis, dsh-client-store, ui-primitives,
 * react) through the shell's own module table — the identical resolution
 * the official module gets when the shell loads it. Static imports would
 * instead hit the preset's bundle purity gate, which forbids value
 * imports of module-table packages.
 *
 * Fallback if a future bundler ever reinterprets the free `require` in
 * ESM input: rename the body's whole-word `require` to a private alias
 * (verified safe at derive time by asserting every occurrence appears as
 * a call or the parameter declaration).
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
export const WORKSPACE_UI_VERSION = '0.1.2-rc.1'
export const WORKSPACE_CLIENT_SHA256 =
  '53c40660195c42cde709b802e239f473dd721f45bc329684af31c01fdb73282a'

export const OFFICIAL_VIRTUAL_SOURCE = 'virtual:dsh-official-workspace-client'

/** Read and gate the official client. Throws on any drift. */
export function readOfficialWorkspaceClient() {
  const require = createRequire(resolvePath(PKG_ROOT, 'package.json'))
  const packagePath = require.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json')
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (manifest.version !== WORKSPACE_UI_VERSION) {
    throw new Error(
      `Unsupported @deepseek-ai/dsh-client-ui-workspace ${manifest.version}; expected ${WORKSPACE_UI_VERSION}. `
      + 'Re-derive the seam set against the new client and update WORKSPACE_UI_VERSION/WORKSPACE_CLIENT_SHA256.',
    )
  }
  const clientPath = require.resolve('@deepseek-ai/dsh-client-ui-workspace/client')
  const source = readFileSync(clientPath, 'utf8')
  const digest = createHash('sha256').update(source).digest('hex')
  if (digest !== WORKSPACE_CLIENT_SHA256) {
    throw new Error(
      `Official Workspace Client hash drifted: ${digest}; expected ${WORKSPACE_CLIENT_SHA256}. `
      + 'The upstream build changed without a version bump — re-derive before shipping.',
    )
  }
  return { source, clientPath }
}

function replaceExactlyOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle)
  const last = source.lastIndexOf(needle)
  if (first < 0 || first !== last) {
    throw new Error(`Unable to derive official Workspace Client ${label}: expected one stable seam`)
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length)
}

/**
 * The seam set. Each entry is an exact-string replacement that must occur
 * exactly once in the gated source; drift anywhere makes derivation fail
 * closed. The current set is empty: Phase 1 ships the official browser
 * verbatim (ownership proven) and the nesting seams land next, one
 * concern per change, each with its own probe.
 */
export const SEAMS = []

/** Apply the seam set to the gated source. */
export function decorateOfficialWorkspaceClient(source) {
  let derived = source
  for (const seam of SEAMS) {
    derived = replaceExactlyOnce(derived, seam.needle, seam.replacement, seam.label)
  }
  return derived
}

/** Extract the module-loader factory body from the official bundle. */
export function extractFactoryBody(source) {
  const open = 'factory: (require) => {'
  const close = '\n\t}\n});'
  const start = source.indexOf(open)
  if (start < 0) throw new Error('Official client factory opening anchor missing')
  const end = source.lastIndexOf(close)
  if (end < 0 || end <= start) throw new Error('Official client factory closing anchor missing')
  return source.slice(start + open.length, end)
}

function renderGeneratedModule(body) {
  return `// Generated by scripts/derive-workspace-browser.mjs — DO NOT EDIT.
// Source: @deepseek-ai/dsh-client-ui-workspace/client ${WORKSPACE_UI_VERSION}
// SHA-256: ${WORKSPACE_CLIENT_SHA256}
// Seams: ${SEAMS.length}
//
// Runs the official Workspace Browser factory against the loader-provided
// require (see the derive script header for the resolution story).
export function runOfficialWorkspaceClient(require) {
${body}
}
`
}

function renderDeclaration() {
  return `// Generated by scripts/derive-workspace-browser.mjs — DO NOT EDIT.
/** The official workspace client module (apply + inject), materialized. */
export interface OfficialWorkspaceClientModule {
  apply(ctx: unknown): void
  inject: readonly string[]
}
/** Run the official factory body against the loader's require. */
export declare function runOfficialWorkspaceClient(
  require: (specifier: string) => unknown,
): OfficialWorkspaceClientModule
`
}

/** Derive and write the generated module. Returns the output paths. */
export function deriveWorkspaceBrowser() {
  const official = readOfficialWorkspaceClient()
  const derived = decorateOfficialWorkspaceClient(official.source)
  const body = extractFactoryBody(derived)
  const outDir = resolvePath(PKG_ROOT, 'src', 'generated')
  const modulePath = resolvePath(outDir, 'workspace-browser.generated.mjs')
  const declPath = resolvePath(outDir, 'workspace-browser.generated.d.mts')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(modulePath, renderGeneratedModule(body))
  writeFileSync(declPath, renderDeclaration())
  return { modulePath, declPath }
}

const invokedDirectly = process.argv[1] !== undefined
  && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const paths = deriveWorkspaceBrowser()
  const fresh = existsSync(paths.modulePath)
  console.log(
    `derived workspace browser: ${WORKSPACE_UI_VERSION} `
    + `${WORKSPACE_CLIENT_SHA256.slice(0, 12)} (seams: ${SEAMS.length}, written: ${fresh ? 'yes' : 'no'})`,
  )
}
