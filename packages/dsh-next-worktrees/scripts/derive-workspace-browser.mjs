/**
 * Derive this plugin's workspace browser from the OFFICIAL client bundle.
 *
 * Strategy B (docs/ideas/dsh-next-worktrees-sidebar-ux.md): the stock
 * `ui-workspace` loader row is disabled by cordis.patch.yml and this plugin
 * ships the official browser, wrapped. The official client source is read
 * from node_modules at build time — the DSH checkout itself is never
 * touched — and gated on the exact package version plus a SHA-256 of the
 * client bytes, so any upstream drift fails this build closed instead of
 * shipping a silently wrong browser. The pinned alpha includes upstream
 * search-result reveal and workspace-loading guards; the seams extend
 * those behaviors to nested worktree clusters.
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
export const WORKSPACE_UI_VERSION = '0.1.3-alpha.2'
export const WORKSPACE_CLIENT_SHA256 =
  '25e0d83cc93ccc51914b9a97346c013be45225e06986eff4934aafb3ed666ada'

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
 * Cluster seams (this set): pass worktree decorations through
 * groupByWorkspace / deriveGroups, nest those groups under the harbor,
 * render the cluster as a ProjectRow (branch icon, git folder menu,
 * stock +), and keep the repo-row create button. Session rows stay stock.
 */
export const SEAMS = [
  {
    label: 'groupByWorkspace decoration pass-through',
    needle: '\t\t\t\tgroups.push(buildGroup(workspace.workspaceId, workspace.workspaceId, workspace.path, Date.parse(workspace.createdAt), workspace.title, members, "account"));',
    replacement: '\t\t\t\tgroups.push({\n\t\t\t\t\t...buildGroup(workspace.workspaceId, workspace.workspaceId, workspace.path, Date.parse(workspace.createdAt), workspace.title, members, "account"),\n\t\t\t\t\t...workspace.__dshNextWorktrees === void 0 ? {} : { __dshNextWorktrees: workspace.__dshNextWorktrees }\n\t\t\t\t});',
  },
  {
    label: 'deriveGroups nest worktree clusters',
    needle: '\t\t\t\t\tsessions: expanded ? g.sessions.map((session) => sessionNode(session, descendants, pendingInteractions)) : []\n\t\t\t\t});\n\t\t\t}\n\t\t\treturn groups;\n\t\t}',
    replacement: '\t\t\t\t\tsessions: expanded ? g.sessions.map((session) => sessionNode(session, descendants, pendingInteractions)) : [],\n\t\t\t\t\t...g.__dshNextWorktrees === void 0 ? {} : { __dshNextWorktrees: g.__dshNextWorktrees }\n\t\t\t\t});\n\t\t\t}\n\t\t\treturn window.__dshNextWorktreesBridge === void 0 ? groups : window.__dshNextWorktreesBridge.nestGroups(groups);\n\t\t}',
  },
  {
    label: 'worktree identity helper',
    needle: '\t\tfunction ProjectRowItem({ group, onToggle, onCreate, actions, drag, home, t }) {',
    replacement: [
      '\t\tfunction dshNextWorktreesDecoration(node) {',
      '\t\t\tconst value = node === void 0 ? void 0 : node.__dshNextWorktrees;',
      '\t\t\tif (value === void 0 || value === null || value.kind !== "dsh-next-worktrees") return void 0;',
      '\t\t\treturn value;',
      '\t\t}',
      '\t\tfunction dshNextWorktreesState(decoration) {',
      '\t\t\tif (decoration.settingUp) return "setting-up";',
      '\t\t\tif (window.__dshNextWorktreesBridge !== void 0 && window.__dshNextWorktreesBridge.isSettingUp(decoration.slug)) return "setting-up";',
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
      '\t\tfunction dshNextWorktreesClusterMenu(decoration) {',
      '\t\t\tconst label = (key) => window.__dshNextWorktreesBridge === void 0 ? key : window.__dshNextWorktreesBridge.menuLabel(key, decoration);',
      '\t\t\treturn [{',
      '\t\t\t\tid: "rename",',
      '\t\t\t\tlabel: void 0,',
      '\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})',
      '\t\t\t}, {',
      '\t\t\t\tid: "dshx-refresh",',
      '\t\t\t\tlabel: label("row.refresh"),',
      '\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {})',
      '\t\t\t}, {',
      '\t\t\t\tid: "dshx-update",',
      '\t\t\t\tlabel: label("row.update"),',
      '\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})',
      '\t\t\t}, {',
      '\t\t\t\tid: "dshx-merge",',
      '\t\t\t\tlabel: label("row.merge"),',
      '\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})',
      '\t\t\t}, {',
      '\t\t\t\tid: "dshx-delete",',
      '\t\t\t\tlabel: label("row.delete"),',
      '\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),',
      '\t\t\t\tdanger: true',
      '\t\t\t}];',
      '\t\t}',
      '\t\tfunction ProjectRowItem({ group, onToggle, onCreate, actions, drag, home, t }) {',
    ].join('\n'),
  },
  {
    label: 'project row cluster decoration',
    needle: '\t\t\tconst [menuOpen, setMenuOpen] = (0, react.useState)(false);\n\t\t\tconst workspaceMenuItems = [{\n\t\t\t\tid: "rename",\n\t\t\t\tlabel: t("rename"),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})\n\t\t\t}, {\n\t\t\t\tid: "delete",\n\t\t\t\tlabel: t("delete.workspace"),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),\n\t\t\t\tdanger: true\n\t\t\t}];',
    replacement: '\t\t\tconst [menuOpen, setMenuOpen] = (0, react.useState)(false);\n\t\t\tconst worktreeDecoration = dshNextWorktreesDecoration(row);\n\t\t\tconst workspaceMenuItems = worktreeDecoration === void 0 ? [{\n\t\t\t\tid: "rename",\n\t\t\t\tlabel: t("rename"),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})\n\t\t\t}, {\n\t\t\t\tid: "delete",\n\t\t\t\tlabel: t("delete.workspace"),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),\n\t\t\t\tdanger: true\n\t\t\t}] : dshNextWorktreesClusterMenu(worktreeDecoration).map((item) => item.id === "rename" ? { ...item, label: t("rename") } : item);',
  },
  {
    label: 'project row cluster class',
    needle: '\t\t\t\tclassName: clsx(Rows_module_css_default.projectRow, menuOpen && Rows_module_css_default.menuOpen),\n\t\t\t\trole: "treeitem",\n\t\t\t\t"aria-expanded": row.expanded,\n\t\t\t\tonClick: onToggle,\n\t\t\t\tdraggable: drag !== void 0,',
    replacement: '\t\t\t\tclassName: clsx(Rows_module_css_default.projectRow, worktreeDecoration !== void 0 && "dshx-clusterRow", menuOpen && Rows_module_css_default.menuOpen),\n\t\t\t\trole: "treeitem",\n\t\t\t\t"aria-expanded": row.expanded,\n\t\t\t\tonClick: onToggle,\n\t\t\t\tdraggable: worktreeDecoration === void 0 && drag !== void 0,',
  },
  {
    label: 'project row cluster icon',
    needle: '\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\tclassName: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder, active && Rows_module_css_default.folderActive),\n\t\t\t\t\t\tchildren: row.expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {})\n\t\t\t\t\t}),',
    replacement: '\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\tclassName: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder, worktreeDecoration === void 0 && active && Rows_module_css_default.folderActive),\n\t\t\t\t\t\tchildren: worktreeDecoration !== void 0 ? (0, react_jsx_runtime.jsx)(DshNextWorktreesIdentity, { decoration: worktreeDecoration }) : row.expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {})\n\t\t\t\t\t}),',
  },
  {
    label: 'project row cluster menu dispatch',
    needle: '\t\t\t\t\t\t\t\t/* v8 ignore next -- Menu can emit only the rename and delete rows supplied above. */\n\t\t\t\t\t\t\t\tif (id !== "rename" && id !== "delete") return;\n\t\t\t\t\t\t\t\tif (id === "rename") actions.rename();\n\t\t\t\t\t\t\t\telse actions.delete();',
    replacement: '\t\t\t\t\t\t\t\tif (id === "rename") actions.rename();\n\t\t\t\t\t\t\t\telse if (id === "delete") actions.delete();\n\t\t\t\t\t\t\t\telse if (id.startsWith("dshx-") && worktreeDecoration !== void 0 && window.__dshNextWorktreesBridge !== void 0) window.__dshNextWorktreesBridge.requestMenu(id.slice(5), worktreeDecoration);',
  },
  {
    label: 'project row cluster hover',
    needle: '\t\t\t\tcontent: (0, react_jsx_runtime.jsx)(WorkspaceHoverContent, {\n\t\t\t\t\tlabel: row.label,\n\t\t\t\t\tcwd: row.cwd === void 0 ? void 0 : abbreviateHomePath(row.cwd, home),\n\t\t\t\t\tcreatedAt: row.createdAt,\n\t\t\t\t\tt\n\t\t\t\t}),',
    replacement: '\t\t\t\tcontent: worktreeDecoration === void 0 ? (0, react_jsx_runtime.jsx)(WorkspaceHoverContent, {\n\t\t\t\t\tlabel: row.label,\n\t\t\t\t\tcwd: row.cwd === void 0 ? void 0 : abbreviateHomePath(row.cwd, home),\n\t\t\t\t\tcreatedAt: row.createdAt,\n\t\t\t\t\tt\n\t\t\t\t}) : (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\tclassName: Rows_module_css_default.hoverContent,\n\t\t\t\t\tchildren: dshNextWorktreesHoverRows({ ...worktreeDecoration, title: row.label }).map((line) => (0, react_jsx_runtime.jsx)("div", { className: Rows_module_css_default.hoverStatus, children: line }, line))\n\t\t\t\t}),',
  },
  {
    label: 'auto-expand harbor with nested current',
    needle: '\t\t\tconst currentGroup = current === void 0 || !workspaceReady ? void 0 : owningGroupKey(workspaces, current);\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tif (current === void 0 || currentGroup === void 0 || Object.hasOwn(groupExpansion, currentGroup)) return;\n\t\t\t\tsetGroupExpanded(currentGroup, true);\n\t\t\t}, [\n\t\t\t\tcurrent,\n\t\t\t\tcurrentGroup,\n\t\t\t\tsetGroupExpanded,\n\t\t\t\tgroupExpansion\n\t\t\t]);',
    replacement: '\t\t\tconst currentGroup = current === void 0 || !workspaceReady ? void 0 : owningGroupKey(workspaces, current);\n\t\t\tconst currentHarbor = current === void 0 || !workspaceReady ? void 0 : dshNextWorktreesDecoration(workspaces.find((w) => w.sessionIds.includes(current)))?.harborWorkspaceId;\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tif (current === void 0) return;\n\t\t\t\tif (currentGroup !== void 0 && !Object.hasOwn(groupExpansion, currentGroup)) setGroupExpanded(currentGroup, true);\n\t\t\t\tif (currentHarbor !== void 0 && currentHarbor !== "" && !Object.hasOwn(groupExpansion, currentHarbor)) setGroupExpanded(currentHarbor, true);\n\t\t\t}, [\n\t\t\t\tcurrent,\n\t\t\t\tcurrentGroup,\n\t\t\t\tcurrentHarbor,\n\t\t\t\tsetGroupExpanded,\n\t\t\t\tgroupExpansion\n\t\t\t]);',
  },
  {
    label: 'search reveal expands harbor and worktree',
    needle: '\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tif (revealGroup === void 0 || groupExpansion[revealGroup] === true) return;\n\t\t\t\tsetGroupExpanded(revealGroup, true);\n\t\t\t}, [\n\t\t\t\tgroupExpansion,\n\t\t\t\trevealGroup,\n\t\t\t\tsetGroupExpanded\n\t\t\t]);',
    replacement: [
      '\t\t\tconst revealHarbor = revealGroup === void 0 ? void 0 : dshNextWorktreesDecoration(workspaces.find((w) => w.workspaceId === revealGroup))?.harborWorkspaceId;',
      '\t\t\t(0, react.useEffect)(() => {',
      '\t\t\t\tif (revealGroup === void 0) return;',
      '\t\t\t\tif (groupExpansion[revealGroup] !== true) setGroupExpanded(revealGroup, true);',
      '\t\t\t\tif (revealHarbor !== void 0 && revealHarbor !== "" && groupExpansion[revealHarbor] !== true) setGroupExpanded(revealHarbor, true);',
      '\t\t\t}, [groupExpansion, revealGroup, revealHarbor, setGroupExpanded]);',
    ].join('\n'),
  },
  {
    label: 'search reveal locates nested overflow',
    needle: '\t\t\t\tconst group = groups.find((candidate) => candidate.key === revealGroup);',
    replacement: '\t\t\t\tconst group = groups.flatMap((candidate) => [candidate, ...(candidate.children ?? [])]).find((candidate) => candidate.key === revealGroup);',
  },
  {
    label: 'session row cluster class',
    needle: '\t\tfunction SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, t }) {',
    replacement: '\t\tfunction SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, clusterSession = false, t }) {',
  },
  {
    label: 'session row cluster className',
    needle: '\t\t\t\t\tclassName: clsx(Rows_module_css_default.sessionRow, selected && Rows_module_css_default.selected, menuOpen && Rows_module_css_default.menuOpen, flat && !showStatus && Rows_module_css_default.flatSessionRowWithoutStatus, drag?.marker === "before" && Rows_module_css_default.dropBefore, drag?.marker === "after" && Rows_module_css_default.dropAfter),',
    replacement: '\t\t\t\t\tclassName: clsx(Rows_module_css_default.sessionRow, clusterSession && "dshx-clusterSession", selected && Rows_module_css_default.selected, menuOpen && Rows_module_css_default.menuOpen, flat && !showStatus && Rows_module_css_default.flatSessionRowWithoutStatus, drag?.marker === "before" && Rows_module_css_default.dropBefore, drag?.marker === "after" && Rows_module_css_default.dropAfter),',
  },
  {
    label: 'nested cluster rows under harbor',
    needle: '\t\t\t\t\t\t\t\t\tcollapsed.hiddenCount > 0 && (0, react_jsx_runtime.jsx)("button", {\n\t\t\t\t\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.sessionOverflowButton,\n\t\t\t\t\t\t\t\t\t\t"aria-expanded": sessionsExpanded,\n\t\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\t\tsetExpandedSessionGroups((keys) => toggled(keys, group.key));\n\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\tchildren: sessionsExpanded ? t("sessions.collapse") : t("sessions.expand", { n: collapsed.hiddenCount })\n\t\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t}, group.key);',
    replacement: '\t\t\t\t\t\t\t\t\tcollapsed.hiddenCount > 0 && (0, react_jsx_runtime.jsx)("button", {\n\t\t\t\t\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.sessionOverflowButton,\n\t\t\t\t\t\t\t\t\t\t"aria-expanded": sessionsExpanded,\n\t\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\t\tsetExpandedSessionGroups((keys) => toggled(keys, group.key));\n\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\tchildren: sessionsExpanded ? t("sessions.collapse") : t("sessions.expand", { n: collapsed.hiddenCount })\n\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t...(group.expanded && group.children !== void 0 ? group.children : []).flatMap((child) => {\n\t\t\t\t\t\t\t\t\t\tconst childCollapsed = collapsedSessionRows(child.sessions);\n\t\t\t\t\t\t\t\t\t\tconst childSessionsExpanded = expandedSessionGroups.includes(child.key);\n\t\t\t\t\t\t\t\t\t\tconst childDecoration = dshNextWorktreesDecoration(child);\n\t\t\t\t\t\t\t\t\t\tconst childNodes = [(0, react_jsx_runtime.jsx)(ProjectRowItem, {\n\t\t\t\t\t\t\t\t\t\t\tgroup: child,\n\t\t\t\t\t\t\t\t\t\t\thome,\n\t\t\t\t\t\t\t\t\t\t\tt,\n\t\t\t\t\t\t\t\t\t\t\tonToggle: () => {\n\t\t\t\t\t\t\t\t\t\t\t\tsetGroupExpanded(child.key, !child.expanded);\n\t\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\t\tonCreate: () => {\n\t\t\t\t\t\t\t\t\t\t\t\tif (child.workspaceId !== void 0) {\n\t\t\t\t\t\t\t\t\t\t\t\t\tsetGroupExpanded(child.key, true);\n\t\t\t\t\t\t\t\t\t\t\t\t\tstartSession(child.workspaceId);\n\t\t\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\t\tactions: child.workspaceId === void 0 ? void 0 : {\n\t\t\t\t\t\t\t\t\t\t\t\trename: () => {\n\t\t\t\t\t\t\t\t\t\t\t\t\tif (child.workspaceId !== void 0) onRenameRequest(child.workspaceId, child.label);\n\t\t\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\t\t\tdelete: () => {\n\t\t\t\t\t\t\t\t\t\t\t\t\tif (childDecoration !== void 0 && window.__dshNextWorktreesBridge !== void 0) window.__dshNextWorktreesBridge.requestMenu("delete", childDecoration);\n\t\t\t\t\t\t\t\t\t\t\t\t\telse if (child.workspaceId !== void 0) onDeleteRequest(child.workspaceId, child.label);\n\t\t\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\t}, child.key + ":header"), ...(child.expanded ? childSessionsExpanded ? child.sessions : childCollapsed.rows : []).map((node) => {\n\t\t\t\t\t\t\t\t\t\t\tconst childDrag = drag !== null && drag.accountKey === child.key;\n\t\t\t\t\t\t\t\t\t\t\treturn (0, react_jsx_runtime.jsx)(SessionNodeItem, {\n\t\t\t\t\t\t\t\t\t\t\t\tnode,\n\t\t\t\t\t\t\t\t\t\t\t\tcurrentId: current,\n\t\t\t\t\t\t\t\t\t\t\t\tnow,\n\t\t\t\t\t\t\t\t\t\t\t\tonOpen: open,\n\t\t\t\t\t\t\t\t\t\t\t\tonRename: onSessionRename,\n\t\t\t\t\t\t\t\t\t\t\t\tonFork: forkSession,\n\t\t\t\t\t\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\t\t\t\t\t\tdrag: {\n\t\t\t\t\t\t\t\t\t\t\t\t\tstart: () => {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tsessionDropCommitted.current = false;\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tsetDrag({\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\taccountKey: child.key,\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tsessionId: node.id,\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tover: null\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\t\t\t\tactive: childDrag,\n\t\t\t\t\t\t\t\t\t\t\t\t\tmarker: childDrag && drag.over?.id === node.id ? drag.over.half : null,\n\t\t\t\t\t\t\t\t\t\t\t\t\thover: (half) => {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tsetDrag((d) => d === null ? d : {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t...d,\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tover: {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tid: node.id,\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\thalf\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\t\t\t\tdrop: (half) => {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tif (drag === null) return;\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tcommitSessionDrag(drag, {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tid: node.id,\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\thalf\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\t\t\t\tend: () => {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tif (drag?.over !== null && drag?.over !== void 0) commitSessionDrag(drag, drag.over);\n\t\t\t\t\t\t\t\t\t\t\t\t\t\telse setDrag(null);\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tsessionDropCommitted.current = false;\n\t\t\t\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\t\t\tonReveal: node.id === revealSessionId && child.key === revealGroup ? () => { onSessionRevealed(node.id); } : void 0,\n\t\t\t\t\t\t\t\t\t\t\t\tclusterSession: true,\n\t\t\t\t\t\t\t\t\t\t\t\tt\n\t\t\t\t\t\t\t\t\t\t\t}, node.id);\n\t\t\t\t\t\t\t\t\t\t})];\n\t\t\t\t\t\t\t\t\t\treturn childCollapsed.hiddenCount > 0 ? [...childNodes, (0, react_jsx_runtime.jsx)("button", {\n\t\t\t\t\t\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\t\t\t\t\t\tclassName: clsx(WorkspaceBrowser_module_css_default.sessionOverflowButton, "dshx-clusterSession"),\n\t\t\t\t\t\t\t\t\t\t\t"aria-expanded": childSessionsExpanded,\n\t\t\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\t\t\tsetExpandedSessionGroups((keys) => toggled(keys, child.key));\n\t\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\t\tchildren: childSessionsExpanded ? t("sessions.collapse") : t("sessions.expand", { n: childCollapsed.hiddenCount })\n\t\t\t\t\t\t\t\t\t\t}, child.key + ":overflow")] : childNodes;\n\t\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t}, group.key);',
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
