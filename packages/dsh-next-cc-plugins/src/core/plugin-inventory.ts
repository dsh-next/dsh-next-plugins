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
    notes,
  }
  return inventory
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
const COMPONENT_ROOTS = new Set(['.claude-plugin', '.mcp.json', 'skills', 'commands', 'agents', 'hooks'])

/**
 * Notes for skills whose SKILL.md references plugin-level directories that
 * exist in the plugin but are not part of any skill directory (the
 * `references/` convention several marketplaces use, `assets/`, ...).
 * Claude Code runs skills from the plugin root, so those links resolve
 * there; in DSH each skill lands standalone in the skills root and they do
 * not. The detection is a path-shape match (`dir/...` or `../dir/...`) over
 * the SKILL.md text against directories that actually exist at the plugin
 * level, so prose mentions without a backing directory never note.
 */
export function pluginLevelReferenceNotes(files: PluginFiles, skills: readonly SkillComponent[]): string[] {
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
      const pattern = new RegExp(`(?:\\.\\./|(^|[^A-Za-z0-9_.-]))${dir}/[A-Za-z0-9_./-]`)
      if (pattern.test(text)) byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
    }
  }
  return [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, count]) =>
      `${count} skill(s) reference plugin-level "${dir}/"; those paths do not resolve from the installed skills root`)
}
