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
 * closed. Every needle below was verified against the pinned bytes (and
 * one differs from the wloops incumbent's published form — their
 * deriveGroups site carried a trailing comma this build does not; the
 * hash gate is exactly what makes such drift loud instead of silent).
 *
 * Phase 2 seams (this set): session-node metadata pass-through (grouped
 * and search projections), the worktree identity row decoration (branch
 * icon + title + status), the indent class and row data attributes, and
 * the unsafe-mutation suppressions (drag-reorder and fork) for
 * re-parented rows.
 */
export const SEAMS = [
  {
    label: 'grouped session node metadata',
    needle: '\t\t\t\tupdatedAt: s.updatedAt,\n\t\t\t\t...pendingInteraction === void 0 ? {} : { pendingInteraction }\n\t\t\t};',
    replacement: '\t\t\t\tupdatedAt: s.updatedAt,\n\t\t\t\t...pendingInteraction === void 0 ? {} : { pendingInteraction },\n\t\t\t\t...s.__dshNextWorktrees === void 0 ? {} : { __dshNextWorktrees: s.__dshNextWorktrees }\n\t\t\t};',
  },
  {
    label: 'search session node metadata',
    needle: '\t\t\t\t\t\trunningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,\n\t\t\t\t\t\t...pendingInteraction === void 0 ? {} : { pendingInteraction },',
    replacement: '\t\t\t\t\t\trunningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,\n\t\t\t\t\t\t...pendingInteraction === void 0 ? {} : { pendingInteraction },\n\t\t\t\t\t\t...summary.__dshNextWorktrees === void 0 ? {} : { __dshNextWorktrees: summary.__dshNextWorktrees },',
  },
  {
    label: 'worktree identity helper',
    needle: '\t\t/** Hover-card body: full title, relative time, and every relevant live status. */\n\t\tfunction SessionHoverContent',
    replacement: [
      '\t\tfunction dshNextWorktreesDecoration(node) {',
      '\t\t\tconst value = node === void 0 ? void 0 : node.__dshNextWorktrees;',
      '\t\t\tif (value === void 0 || value === null || value.kind !== "dsh-next-worktrees") return void 0;',
      '\t\t\treturn value;',
      '\t\t}',
      '\t\tfunction dshNextWorktreesState(decoration) {',
      '\t\t\tif (decoration.conflict) return "conflict";',
      '\t\t\tif (decoration.merged) return "merged";',
      '\t\t\tif (decoration.dirty) return "dirty";',
      '\t\t\tif (decoration.ahead > 0) return "ahead";',
      '\t\t\treturn "clean";',
      '\t\t}',
      '\t\tfunction DshNextWorktreesIdentity({ decoration }) {',
      '\t\t\tconst state = dshNextWorktreesState(decoration);',
      '\t\t\tconst facts = window.__dshNextWorktreesBridge === void 0 ? [decoration.branch] : window.__dshNextWorktreesBridge.worktreeFacts(decoration);',
      '\t\t\treturn (0, react_jsx_runtime.jsxs)("span", {',
      '\t\t\t\tclassName: "dshx-worktree-identity",',
      '\t\t\t\t"data-dshx-worktree": decoration.slug,',
      '\t\t\t\t"data-dshx-state": state,',
      '\t\t\t\ttitle: facts.join("\\n"),',
      '\t\t\t\tchildren: [',
      '\t\t\t\t\t(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {}),',
      '\t\t\t\t\tdecoration.ahead > 0 ? (0, react_jsx_runtime.jsx)("span", { className: "dshx-worktree-ahead", children: decoration.ahead }) : null',
      '\t\t\t\t]',
      '\t\t\t});',
      '\t\t}',
      '\t\tfunction dshNextWorktreesHoverRows(decoration) {',
      '\t\t\treturn window.__dshNextWorktreesBridge === void 0 ? [decoration.title, decoration.branch] : window.__dshNextWorktreesBridge.worktreeFacts(decoration);',
      '\t\t}',
      '\t\t/** Hover-card body: full title, relative time, and every relevant live status. */',
      '\t\tfunction SessionHoverContent',
    ].join('\n'),
  },
  {
    label: 'session hover worktree facts',
    needle: '\t\t\t\t\t!node.blank && (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\tclassName: Rows_module_css_default.hoverTime,\n\t\t\t\t\t\tchildren: hoverTimeLabel(node.updatedAt, now, t)\n\t\t\t\t\t}),',
    replacement: '\t\t\t\t\t!node.blank && (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\tclassName: Rows_module_css_default.hoverTime,\n\t\t\t\t\t\tchildren: hoverTimeLabel(node.updatedAt, now, t)\n\t\t\t\t\t}),\n\t\t\t\t\t...(() => { const d = dshNextWorktreesDecoration(node); return d === void 0 ? [] : dshNextWorktreesHoverRows(d).map((label) => (0, react_jsx_runtime.jsx)("div", { className: Rows_module_css_default.hoverStatus, children: label }, label)); })(),',
  },
  {
    label: 'session row decoration hook',
    needle: '\t\t\tconst showStatus = statuses[0].state !== "done" || row.completed;\n\t\t\tconst [menuOpen, setMenuOpen]',
    replacement: '\t\t\tconst showStatus = statuses[0].state !== "done" || row.completed;\n\t\t\tconst worktreeDecoration = dshNextWorktreesDecoration(row);\n\t\t\tconst [menuOpen, setMenuOpen]',
  },
  {
    label: 'session row class and data',
    needle: '\t\t\t\t\tclassName: clsx(Rows_module_css_default.sessionRow, selected && Rows_module_css_default.selected, menuOpen && Rows_module_css_default.menuOpen, flat && !showStatus && Rows_module_css_default.flatSessionRowWithoutStatus, drag?.marker === "before" && Rows_module_css_default.dropBefore, drag?.marker === "after" && Rows_module_css_default.dropAfter),\n\t\t\t\t\trole: "treeitem",',
    replacement: '\t\t\t\t\tclassName: clsx(Rows_module_css_default.sessionRow, worktreeDecoration !== void 0 && "dshx-sessionRow--worktree", selected && Rows_module_css_default.selected, menuOpen && Rows_module_css_default.menuOpen, flat && !showStatus && Rows_module_css_default.flatSessionRowWithoutStatus, drag?.marker === "before" && Rows_module_css_default.dropBefore, drag?.marker === "after" && Rows_module_css_default.dropAfter),\n\t\t\t\t\trole: "treeitem",',
  },
  {
    label: 'session row drag suppression',
    needle: '"aria-selected": selected,\n\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\tonOpen(node.id);\n\t\t\t\t\t},\n\t\t\t\t\tdraggable: drag !== void 0,',
    replacement: '"aria-selected": selected,\n\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\tonOpen(node.id);\n\t\t\t\t\t},\n\t\t\t\t\tdraggable: worktreeDecoration === void 0 && drag !== void 0,',
  },
  {
    label: 'session row identity slot',
    needle: '\t\t\t\t\t\t(!flat || showStatus) && (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.slot,\n\t\t\t\t\t\t\tchildren: showStatus && (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses })\n\t\t\t\t\t\t}),\n\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {',
    replacement: '\t\t\t\t\t\tworktreeDecoration !== void 0 && (0, react_jsx_runtime.jsx)(DshNextWorktreesIdentity, { decoration: worktreeDecoration }),\n\t\t\t\t\t\t(!flat || showStatus) && (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.slot,\n\t\t\t\t\t\t\tchildren: showStatus && (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses })\n\t\t\t\t\t\t}),\n\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {',
  },
  {
    label: 'session fork filter define',
    needle: '\t\t\t];\n\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {',
    replacement: '\t\t\t];\n\t\t\tconst visibleSessionMenuItems = worktreeDecoration === void 0 ? sessionMenuItems : [...sessionMenuItems.filter((item) => item.id !== "fork"), {\n\t\t\t\tid: "dshx-refresh",\n\t\t\t\tlabel: window.__dshNextWorktreesBridge === void 0 ? "Refresh" : window.__dshNextWorktreesBridge.menuLabel("row.refresh"),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {})\n\t\t\t}, {\n\t\t\t\tid: "dshx-update",\n\t\t\t\tlabel: window.__dshNextWorktreesBridge === void 0 ? "Update" : window.__dshNextWorktreesBridge.menuLabel("row.update", worktreeDecoration),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})\n\t\t\t}, {\n\t\t\t\tid: "dshx-merge",\n\t\t\t\tlabel: window.__dshNextWorktreesBridge === void 0 ? "Merge" : window.__dshNextWorktreesBridge.menuLabel("row.merge"),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})\n\t\t\t}, {\n\t\t\t\tid: "dshx-delete",\n\t\t\t\tlabel: window.__dshNextWorktreesBridge === void 0 ? "Delete worktree" : window.__dshNextWorktreesBridge.menuLabel("row.delete"),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {})\n\t\t\t}];\n\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {',
  },
  {
    label: 'session fork filter use',
    needle: '\t\t\t\t\t\t\t\titems: sessionMenuItems,',
    replacement: '\t\t\t\t\t\t\t\titems: visibleSessionMenuItems,',
  },
  {
    label: 'session menu worktree dispatch',
    needle: 'if (id === "archive") onArchive(node.id);',
    replacement: 'if (id === "archive") onArchive(node.id);\n\t\t\t\t\t\t\tif (id.startsWith("dshx-") && worktreeDecoration !== void 0 && window.__dshNextWorktreesBridge !== void 0) window.__dshNextWorktreesBridge.requestMenu(id.slice(5), worktreeDecoration, node.id);',
  },
  {
    label: 'repo row worktree button',
    needle: '\t\t\t\t\t\t\t"aria-label": t("actions.newSession.aria", { name: label }),\n\t\t\t\t\t\t\tonClick: (e) => {\n\t\t\t\t\t\t\t\te.stopPropagation();\n\t\t\t\t\t\t\t\tonCreate();\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})\n\t\t\t\t\t\t})]',
    replacement: '\t\t\t\t\t\t\t"aria-label": t("actions.newSession.aria", { name: label }),\n\t\t\t\t\t\t\tonClick: (e) => {\n\t\t\t\t\t\t\t\te.stopPropagation();\n\t\t\t\t\t\t\t\tonCreate();\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})\n\t\t\t\t\t\t}), (window.__dshNextWorktreesBridge === void 0 ? false : window.__dshNextWorktreesBridge.canCreate(row.cwd)) && (0, react_jsx_runtime.jsx)("button", {\n\t\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.iconButton,\n\t\t\t\t\t\t\t"aria-label": window.__dshNextWorktreesBridge === void 0 ? "New worktree" : window.__dshNextWorktreesBridge.createLabel(label),\n\t\t\t\t\t\t\t"data-dshx-create": row.cwd,\n\t\t\t\t\t\t\ttitle: row.cwd,\n\t\t\t\t\t\t\tonClick: (e) => {\n\t\t\t\t\t\t\t\te.stopPropagation();\n\t\t\t\t\t\t\t\tif (window.__dshNextWorktreesBridge !== void 0) window.__dshNextWorktreesBridge.requestCreate(row.cwd, label);\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})\n\t\t\t\t\t\t})]',
  },
]

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
