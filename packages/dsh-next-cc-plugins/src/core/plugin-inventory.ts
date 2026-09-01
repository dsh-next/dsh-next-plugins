/**
 * Extract a {@link PluginInventory} from a Claude Code plugin's file map
 * (plugin-relative paths to UTF-8 text contents).
 *
 * Component layout follows the Claude Code plugin reference, with the
 * optional `.claude-plugin/plugin.json` manifest able to redirect each
 * component — as a directory path, a single file path, or an array mixing
 * both:
 *   - skills:   `skills/<dir>/SKILL.md` (bundle) or `skills/<name>.md` (flat)
 *   - commands: `commands/**.md` (nested paths become `parent:child` names)
 *   - agents:   `agents/*.md`
 *   - hooks:    `hooks/hooks.json` — `{ "<event>": [matcher...] }`
 *   - MCP:      `.mcp.json` — `{ "mcpServers": { name: def } }`
 *
 * Every component is inventoried even when this bridge version cannot
 * activate it (commands, agents, hooks): the panel reports them as pending
 * so the user knows what the plugin would add elsewhere.
 */
import { parseFrontmatter } from './frontmatter.ts'
import { normalizeMcpServers } from './mcp.ts'
import type {
  AgentComponent,
  CommandComponent,
  McpServerComponent,
  PluginInventory,
  SkillComponent,
  UnbridgedComponents,
} from './types.ts'

/** A plugin's files: plugin-relative path to UTF-8 content. */
export type PluginFiles = Record<string, string>

/**
 * Component path overrides from `.claude-plugin/plugin.json`. Each entry is
 * the resolved list of paths (directories or single files) for that
 * component, in manifest order; `undefined` means "use the default root".
 */
export interface PluginManifestPaths {
  skills?: string[]
  commands?: string[]
  agents?: string[]
  hooks?: string[]
  mcpServers?: string[]
}

/** The component roots used when the manifest names none. */
export const DEFAULT_COMPONENT_PATHS = {
  skills: ['skills'],
  commands: ['commands'],
  agents: ['agents'],
  hooks: ['hooks/hooks.json'],
  mcpServers: ['.mcp.json'],
} as const

const MANIFEST_COMPONENT_KEYS = ['skills', 'commands', 'agents', 'hooks', 'mcpServers'] as const

/** Normalize one manifest override value: a path string or a list of them. */
function pathList(raw: unknown): string[] | undefined {
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t === '' ? undefined : [t]
  }
  if (!Array.isArray(raw)) return undefined
  const list = raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
  return list.length === 0 ? undefined : list
}

/** Read the optional `.claude-plugin/plugin.json` component path overrides. */
export function readManifestPaths(files: PluginFiles): PluginManifestPaths {
  const raw = files['.claude-plugin/plugin.json']
  if (raw === undefined) return {}
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    const out: PluginManifestPaths = {}
    for (const key of MANIFEST_COMPONENT_KEYS) {
      const list = pathList(data[key])
      if (list !== undefined) out[key] = list
    }
    return out
  } catch {
    return {}
  }
}

function trimDir(dir: string): string {
  let s = dir.replace(/\/{2,}/g, '/')
  while (s.startsWith('./')) s = s.slice(2)
  if (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1]
}

function extractSkills(files: PluginFiles, roots: readonly string[], notes: string[]): SkillComponent[] {
  const out: SkillComponent[] = []
  const seen = new Set<string>()
  const push = (skill: SkillComponent): void => {
    if (skill.name === '') return
    if (seen.has(skill.name)) {
      notes.push(`skill "${skill.name}" is listed more than once; kept the first`)
      return
    }
    seen.add(skill.name)
    out.push(skill)
  }
  for (const rootRaw of roots) {
    const root = trimDir(rootRaw)
    // A root that names an existing file is a single-file (flat) skill.
    if (files[root] !== undefined) {
      if (!root.endsWith('.md')) {
        notes.push(`skill path "${rootRaw}" is a file but not markdown; skipped`)
        continue
      }
      const parsed = parseFrontmatter(files[root])
      const name = parsed?.name !== undefined && parsed.name !== '' ? parsed.name : root.slice(0, -3).split('/').pop() ?? ''
      push({ name, description: parsed?.description ?? '', path: '', file: root })
      continue
    }
    const prefix = root === '' ? '' : `${root}/`
    const bundles = new Map<string, { path: string; content: string }>()
    const flats: Array<{ path: string; content: string }> = []
    for (const [path, content] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue
      const rel = path.slice(prefix.length)
      const segments = rel.split('/')
      const base = segments[segments.length - 1]
      if (base !== 'SKILL.md' && !(segments.length === 1 && base.endsWith('.md'))) continue
      if (segments.length === 1) flats.push({ path: rel, content })
      else bundles.set(segments.slice(0, -1).join('/'), { path: rel, content })
    }
    for (const [dirPath, entry] of [...bundles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (dirPath.split('/').some((segment) => segment.startsWith('.'))) {
        notes.push(`skill directory "${dirPath}" is hidden; skipped`)
        continue
      }
      const parsed = parseFrontmatter(entry.content)
      const name = parsed?.name !== undefined && parsed.name !== '' ? parsed.name : dirPath.split('/').pop() ?? ''
      // `dirPath` is relative to this root; the inventory reports the
      // plugin-relative path so `skillFiles` can slice the plugin file map.
      push({ name, description: parsed?.description ?? '', path: prefix === '' ? dirPath : `${prefix}${dirPath}` })
    }
    for (const entry of flats.sort((a, b) => a.path.localeCompare(b.path))) {
      const parsed = parseFrontmatter(entry.content)
      const name = parsed?.name !== undefined && parsed.name !== '' ? parsed.name : entry.path.replace(/\.md$/, '')
      push({ name, description: parsed?.description ?? '', path: '', file: `${prefix}${entry.path}` })
    }
  }
  return out
}

function extractCommands(files: PluginFiles, roots: readonly string[]): CommandComponent[] {
  const out: CommandComponent[] = []
  for (const rootRaw of roots) {
    const root = trimDir(rootRaw)
    if (files[root] !== undefined) {
      if (!root.endsWith('.md')) continue
      const rel = basename(root)
      const name = rel.slice(0, -3)
      if (name === '') continue
      const parsed = parseFrontmatter(files[root])
      out.push({ name, description: parsed?.description ?? '', path: rel, file: root })
      continue
    }
    const prefix = root === '' ? '' : `${root}/`
    for (const [path, content] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue
      const rel = path.slice(prefix.length)
      if (!rel.endsWith('.md') || rel.includes('/')) continue // nested commands: keep flat for now
      const name = rel.slice(0, -3)
      if (name === '') continue
      const parsed = parseFrontmatter(content)
      out.push({ name, description: parsed?.description ?? '', path: rel, file: path })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function extractAgents(files: PluginFiles, roots: readonly string[]): AgentComponent[] {
  const out: AgentComponent[] = []
  for (const rootRaw of roots) {
    const root = trimDir(rootRaw)
    if (files[root] !== undefined) {
      if (!root.endsWith('.md')) continue
      const rel = basename(root)
      const name = rel.slice(0, -3)
      if (name === '') continue
      const parsed = parseFrontmatter(files[root])
      out.push({
        name: parsed?.name !== undefined && parsed.name !== '' ? parsed.name : name,
        description: parsed?.description ?? '',
        path: rel,
        file: root,
        tools: parsed?.tools ?? '',
        model: parsed?.model ?? '',
      })
      continue
    }
    const prefix = root === '' ? '' : `${root}/`
    for (const [path, content] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue
      const rel = path.slice(prefix.length)
      if (!rel.endsWith('.md') || rel.includes('/')) continue
      const name = rel.slice(0, -3)
      if (name === '') continue
      const parsed = parseFrontmatter(content)
      out.push({
        name: parsed?.name !== undefined && parsed.name !== '' ? parsed.name : name,
        description: parsed?.description ?? '',
        path: rel,
        file: path,
        tools: parsed?.tools ?? '',
        model: parsed?.model ?? '',
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function extractHookEvents(files: PluginFiles, paths: readonly string[], explicit: boolean, notes: string[]): string[] {
  const events = new Set<string>()
  let anyFound = false
  for (const rawPath of paths) {
    const path = trimDir(rawPath)
    const raw = files[path]
    if (raw === undefined) {
      // The default location stays silent when absent (most plugins ship
      // none); a manifest-named file that is missing is a real problem.
      if (explicit) notes.push(`hooks file "${path}" listed in plugin.json was not found`)
      continue
    }
    anyFound = true
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      notes.push(`hooks file "${path}" is not valid JSON; its hooks were not inventoried`)
      continue
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      notes.push(`hooks file "${path}" has an unexpected shape; its hooks were not inventoried`)
      continue
    }
    for (const event of Object.keys(data as Record<string, unknown>)) events.add(event)
  }
  if (anyFound) return [...events].sort()
  return []
}

function manifestInlineMcpServers(files: PluginFiles): unknown {
  const manifest = files['.claude-plugin/plugin.json']
  if (manifest === undefined) return undefined
  try {
    const inline = JSON.parse(manifest) as Record<string, unknown>
    return inline.mcpServers
  } catch {
    return undefined
  }
}

function extractMcp(files: PluginFiles, paths: readonly string[], explicit: boolean, notes: string[]): McpServerComponent[] {
  const out: McpServerComponent[] = []
  const seen = new Set<string>()
  const merge = (raw: unknown, where: string): void => {
    const result = normalizeMcpServers(raw, notes)
    for (const server of result.servers) {
      if (seen.has(server.name)) {
        notes.push(`MCP server "${server.name}" is declared in more than one file; kept the first (${where})`)
        continue
      }
      seen.add(server.name)
      out.push(server)
    }
  }
  let anyFound = false
  for (const rawPath of paths) {
    const path = trimDir(rawPath)
    const raw = files[path]
    if (raw === undefined) {
      if (explicit) notes.push(`MCP file "${path}" listed in plugin.json was not found`)
      continue
    }
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      notes.push(`MCP file "${path}" is not valid JSON; servers not inventoried`)
      continue
    }
    const servers = (data !== null && typeof data === 'object' && !Array.isArray(data))
      ? (data as Record<string, unknown>).mcpServers
      : undefined
    if (servers === undefined) {
      notes.push(`MCP file "${path}" has no "mcpServers" object`)
      continue
    }
    anyFound = true
    merge(servers, path)
  }
  if (anyFound) return out
  // Claude Code also allows the MCP servers inline in
  // `.claude-plugin/plugin.json` under `mcpServers` (the form
  // ChromeDevTools/chrome-devtools-mcp ships) instead of a separate file.
  // Only the no-override path falls back to it, matching Claude: an explicit
  // mcpServers path list is authoritative.
  if (!explicit) {
    const inline = manifestInlineMcpServers(files)
    if (inline !== undefined) return normalizeMcpServers(inline, notes).servers
  }
  return out
}

/**
 * The plugin's declared dependencies (`dependencies` in plugin.json — Claude
 * Code auto-installs them; this bridge only reports them). Entries render as
 * `name` or `name@range`. Invalid entries drop out silently: a dependency
 * list must never block the install it decorates.
 */
export function manifestDependencies(files: PluginFiles): string[] {
  const manifest = readManifest(files)
  const raw = manifest?.dependencies
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const name = entry.trim()
      if (name !== '') out.push(name)
      continue
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    const name = typeof e.name === 'string' ? e.name.trim() : ''
    if (name === '') continue
    const version = typeof e.version === 'string' && e.version.trim() !== '' ? e.version.trim() : ''
    out.push(version === '' ? name : `${name}@${version}`)
  }
  return out
}

/** Install note for a plugin's declared dependencies (none -> no note). */
export function dependencyNotes(dependencies: readonly string[]): string[] {
  if (dependencies.length === 0) return []
  return [`requires plugin(s) ${dependencies.join(', ')}; this bridge does not auto-install dependencies`]
}

/**
 * SKILL.md frontmatter keys Claude Code acts on that DSH has no counterpart
 * for. DSH's skill runtime does honor `disable-model-invocation` and
 * `user-invocable` (same kebab-case names), so those pass through working;
 * these do not, and skills carrying them install with a note so the user
 * knows the semantics did not carry over.
 */
const UNBRIDGED_SKILL_KEYS = [
  'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks',
] as const

/** One note per skill whose frontmatter declares keys DSH does not act on. */
export function skillSemanticNotes(files: PluginFiles, skills: readonly SkillComponent[]): string[] {
  const notes: string[] = []
  for (const skill of skills) {
    const parsed = parseFrontmatter(skillFiles(files, skill)['SKILL.md'] ?? '')
    if (parsed === undefined) continue
    const keys = UNBRIDGED_SKILL_KEYS.filter((key) => parsed.scalars[key] !== undefined || (parsed.lists[key] ?? []).length > 0)
    if (keys.length > 0) {
      notes.push(`skill "${skill.name}" declares ${keys.join(', ')} which DSH skills do not act on`)
    }
  }
  return notes
}

/** Compute the full component inventory of a plugin's files. */
export function pluginInventory(files: PluginFiles): PluginInventory {
  const notes: string[] = []
  const paths = readManifestPaths(files)
  const inventory: PluginInventory = {
    skills: extractSkills(files, paths.skills ?? DEFAULT_COMPONENT_PATHS.skills, notes),
    commands: extractCommands(files, paths.commands ?? DEFAULT_COMPONENT_PATHS.commands),
    agents: extractAgents(files, paths.agents ?? DEFAULT_COMPONENT_PATHS.agents),
    hookEvents: extractHookEvents(files, paths.hooks ?? DEFAULT_COMPONENT_PATHS.hooks, paths.hooks !== undefined, notes),
    mcpServers: extractMcp(files, paths.mcpServers ?? DEFAULT_COMPONENT_PATHS.mcpServers, paths.mcpServers !== undefined, notes),
    unbridged: extractUnbridged(files, notes),
    dependencies: manifestDependencies(files),
    notes,
  }
  return inventory
}

// ---------------------------------------------------------------------------
// Recognized-but-unbridged component families (reported, never installed)
// ---------------------------------------------------------------------------

/** Parse a JSON file from the map, or undefined when absent/invalid. */
function parseJsonFile(files: PluginFiles, path: string, notes: string[], what: string): unknown {
  const raw = files[trimDir(path)]
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    notes.push(`${what} file "${trimDir(path)}" is not valid JSON; not counted`)
    return undefined
  }
}

/** The parsed manifest object, or undefined when absent/malformed. */
function readManifest(files: PluginFiles): Record<string, unknown> | undefined {
  const raw = files['.claude-plugin/plugin.json']
  if (raw === undefined) return undefined
  try {
    const data = JSON.parse(raw)
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function countObjectKeys(data: unknown): number {
  return data !== null && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).length : 0
}

/** Count files under one root directory matching a suffix filter. */
function countUnderRoot(files: PluginFiles, rootRaw: string, suffix: string): number {
  const root = trimDir(rootRaw)
  const prefix = root === '' ? '' : `${root}/`
  let count = 0
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue
    if (path.slice(prefix.length).endsWith(suffix)) count++
  }
  return count
}

/**
 * Detect the component families Claude Code ships that this bridge has no
 * DSH surface for (LSP servers, monitors, output styles, themes, workflows,
 * bin executables, plugin settings). They are counted so the panel can say
 * what an install deliberately leaves out; nothing here ever fails one.
 */
export function extractUnbridged(files: PluginFiles, notes: string[]): UnbridgedComponents {
  const manifest = readManifest(files)
  const experimental = (manifest?.experimental !== null && typeof manifest?.experimental === 'object' && !Array.isArray(manifest.experimental))
    ? manifest.experimental as Record<string, unknown>
    : {}
  const out: UnbridgedComponents = {}

  // LSP servers: `.lcp.json`/`.lsp.json` at the root, a manifest path, or an
  // inline manifest object, all keyed by server name.
  const lspRaw = manifest?.lspServers
  let lspCount = 0
  if (typeof lspRaw === 'string') {
    lspCount = countObjectKeys(parseJsonFile(files, lspRaw, notes, 'LSP servers'))
  } else if (lspRaw !== null && typeof lspRaw === 'object' && !Array.isArray(lspRaw)) {
    lspCount = countObjectKeys(lspRaw)
  } else {
    for (const candidate of ['.lsp.json', '.lcp.json']) {
      const data = parseJsonFile(files, candidate, notes, 'LSP servers')
      if (data !== undefined) {
        lspCount = countObjectKeys(data)
        break
      }
    }
  }
  if (lspCount > 0) out.lspServers = lspCount

  // Monitors: monitors/monitors.json (an array), a manifest path, or inline.
  const monitorsRaw = manifest?.monitors ?? experimental.monitors
  let monitors = 0
  if (typeof monitorsRaw === 'string') {
    const data = parseJsonFile(files, monitorsRaw, notes, 'Monitors')
    monitors = Array.isArray(data) ? data.length : 0
  } else if (Array.isArray(monitorsRaw)) {
    monitors = monitorsRaw.length
  } else {
    const data = parseJsonFile(files, 'monitors/monitors.json', notes, 'Monitors')
    monitors = Array.isArray(data) ? data.length : 0
  }
  if (monitors > 0) out.monitors = monitors

  // Output styles: a directory of markdown files (manifest path or default).
  const outputStylesRaw = manifest?.outputStyles
  const outputStyles = typeof outputStylesRaw === 'string'
    ? (files[trimDir(outputStylesRaw)] !== undefined ? 1 : countUnderRoot(files, outputStylesRaw, '.md'))
    : countUnderRoot(files, 'output-styles', '.md')
  if (outputStyles > 0) out.outputStyles = outputStyles

  // Themes: a directory of JSON files (experimental manifest path or default).
  const themesRaw = experimental.themes
  const themes = typeof themesRaw === 'string'
    ? (files[trimDir(themesRaw)] !== undefined ? 1 : countUnderRoot(files, themesRaw, '.json'))
    : countUnderRoot(files, 'themes', '.json')
  if (themes > 0) out.themes = themes

  // Workflows and bin executables: any file below the directory counts.
  const workflows = countUnderRoot(files, 'workflows', '')
  if (workflows > 0) out.workflows = workflows
  const executables = countUnderRoot(files, 'bin', '')
  if (executables > 0) out.executables = executables

  // Plugin settings.json: only the agent/subagentStatusLine keys exist.
  if (files['settings.json'] !== undefined) out.settings = 1
  return out
}

/** Human labels for {@link UnbridgedComponents} keys, singular and plural. */
export const UNBRIDGED_LABELS: Record<keyof UnbridgedComponents & string, [string, string]> = {
  lspServers: ['LSP server', 'LSP servers'],
  monitors: ['monitor', 'monitors'],
  outputStyles: ['output style', 'output styles'],
  themes: ['theme', 'themes'],
  workflows: ['workflow', 'workflows'],
  executables: ['executable', 'executables'],
  settings: ['settings file', 'settings files'],
}

/**
 * Install notes for the unbridged families one plugin ships, in a stable
 * order: each names the count and says plainly that this bridge does not
 * install it onto a DSH surface.
 */
export function unbridgedNotes(unbridged: UnbridgedComponents): string[] {
  const order: Array<keyof UnbridgedComponents & string> = ['lspServers', 'monitors', 'outputStyles', 'themes', 'workflows', 'executables', 'settings']
  const notes: string[] = []
  for (const key of order) {
    const count = unbridged[key]
    if (count === undefined || count <= 0) continue
    const [one, many] = UNBRIDGED_LABELS[key]
    const label = count === 1 ? one : many
    notes.push(`ships ${count} ${label}; no DSH bridge, not installed`)
  }
  return notes
}

/**
 * The sub-map of files belonging to one skill (its directory plus everything
 * below it), with paths rewritten relative to the skill directory.
 */
export function skillFiles(files: PluginFiles, skill: SkillComponent): PluginFiles {
  if (skill.file !== undefined) {
    return { 'SKILL.md': files[skill.file] ?? '' }
  }
  if (skill.path === '') {
    return { 'SKILL.md': files['skills/' + skill.name + '.md'] ?? '' }
  }
  const prefix = `${skill.path}/`
  const out: PluginFiles = {}
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith(prefix)) out[path.slice(prefix.length)] = content
  }
  return out
}

/**
 * The raw hooks document to activate: the first existing hooks file named by
 * the manifest (or the default `hooks/hooks.json`). '' when the plugin has
 * none.
 */
export function hooksDocument(files: PluginFiles): string {
  const paths = readManifestPaths(files).hooks ?? DEFAULT_COMPONENT_PATHS.hooks
  for (const rawPath of paths) {
    const raw = files[trimDir(rawPath)]
    if (raw !== undefined) return raw
  }
  return ''
}

/** Roots this bridge consumes as components; never counted as stray assets. */
const COMPONENT_ROOTS = new Set(['.claude-plugin', '.mcp.json', 'skills', 'commands', 'agents', 'hooks', 'output-styles', 'themes', 'workflows', 'monitors', 'bin'])

/**
 * Notes for skills whose SKILL.md references plugin-level directories that
 * exist in the plugin but are not part of any skill directory (the
 * `references/` convention several marketplaces use, `assets/`, ...).
 * Claude Code runs skills from the plugin root, so those links resolve
 * there; in DSH each skill lands standalone in the skills root and they do
 * not. The detection is a path-shape match (`dir/...` or `../dir/...`) over
 * the SKILL.md text against directories that actually exist at the plugin
 * level, so prose mentions without a backing directory never note. When
 * `readFrom` is given (the materialized plugin copy's absolute path), the
 * note names the directory the referenced files can actually be read from.
 */
export function pluginLevelReferenceNotes(files: PluginFiles, skills: readonly SkillComponent[], readFrom?: string): string[] {
  const roots = new Set<string>()
  for (const path of Object.keys(files)) {
    const segment = path.split('/')[0]
    if (segment === path) continue // a top-level file, not a directory
    if (!COMPONENT_ROOTS.has(segment)) roots.add(segment)
  }
  if (roots.size === 0) return []
  const byDir = new Map<string, number>()
  for (const skill of skills) {
    const map = skillFiles(files, skill)
    const text = map['SKILL.md'] ?? ''
    if (text === '') continue
    for (const dir of roots) {
      // The trailing path part is optional so bare directory links
      // (`[](../../references/)`) count as references too.
      const pattern = new RegExp(`(?:\\.\\./|(^|[^A-Za-z0-9_.-]))${dir}/[A-Za-z0-9_./-]*`)
      if (pattern.test(text)) byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
    }
  }
  return [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, count]) =>
      `${count} skill(s) reference plugin-level "${dir}/"; those paths do not resolve from the installed skills root${readFrom !== undefined ? `; read them from ${readFrom}/${dir} instead` : ''}`)
}
