/**
 * Extract a {@link PluginInventory} from a Claude Code plugin's file map
 * (plugin-relative paths to UTF-8 text contents).
 *
 * Component layout follows the Claude Code plugin reference, with the
 * optional `.claude-plugin/plugin.json` manifest able to redirect each
 * component directory:
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

export interface PluginManifestPaths {
  skills?: string
  commands?: string
  agents?: string
  hooks?: string
  mcpServers?: string
}

/** Read the optional `.claude-plugin/plugin.json` component path overrides. */
export function readManifestPaths(files: PluginFiles): PluginManifestPaths {
  const raw = files['.claude-plugin/plugin.json']
  if (raw === undefined) return {}
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    const out: PluginManifestPaths = {}
    for (const key of ['skills', 'commands', 'agents', 'hooks', 'mcpServers'] as const) {
      const value = data[key]
      if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim()
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

function extractSkills(files: PluginFiles, dir: string, notes: string[]): SkillComponent[] {
  const root = trimDir(dir)
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
  const out: SkillComponent[] = []
  for (const [dirPath, entry] of [...bundles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (dirPath.split('/').some((segment) => segment.startsWith('.'))) {
      notes.push(`skill directory "${dirPath}" is hidden; skipped`)
      continue
    }
    const parsed = parseFrontmatter(entry.content)
    const name = parsed?.name !== undefined && parsed.name !== '' ? parsed.name : dirPath.split('/').pop() ?? ''
    if (name === '') {
      notes.push(`skill directory "${dirPath}" has no derivable name; skipped`)
      continue
    }
    // `dirPath` is relative to the skills root; the inventory reports the
    // plugin-relative path so `skillFiles` can slice the plugin file map.
    out.push({ name, description: parsed?.description ?? '', path: prefix === '' ? dirPath : `${prefix}${dirPath}` })
  }
  for (const entry of flats.sort((a, b) => a.path.localeCompare(b.path))) {
    const parsed = parseFrontmatter(entry.content)
    const name = parsed?.name !== undefined && parsed.name !== '' ? parsed.name : entry.path.replace(/\.md$/, '')
    if (name === '') continue
    out.push({ name, description: parsed?.description ?? '', path: '' })
  }
  return out
}

function extractCommands(files: PluginFiles, dir: string): CommandComponent[] {
  const root = trimDir(dir)
  const prefix = root === '' ? '' : `${root}/`
  const out: CommandComponent[] = []
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue
    const rel = path.slice(prefix.length)
    if (!rel.endsWith('.md') || rel.includes('/')) continue // nested commands: keep flat for now
    const name = rel.slice(0, -3)
    if (name === '') continue
    const parsed = parseFrontmatter(content)
    out.push({ name, description: parsed?.description ?? '', path: rel })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function extractAgents(files: PluginFiles, dir: string): AgentComponent[] {
  const root = trimDir(dir)
  const prefix = root === '' ? '' : `${root}/`
  const out: AgentComponent[] = []
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue
    const rel = path.slice(prefix.length)
    if (!rel.endsWith('.md') || rel.includes('/')) continue
    const name = rel.slice(0, -3)
    if (name === '') continue
    const parsed = parseFrontmatter(content)
    const outName = parsed?.name !== undefined && parsed.name !== '' ? parsed.name : name
    out.push({
      name: outName,
      description: parsed?.description ?? '',
      path: rel,
      tools: parsed?.tools ?? '',
      model: parsed?.model ?? '',
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function extractHookEvents(files: PluginFiles, path: string, notes: string[]): string[] {
  const raw = files[trimDir(path)]
  if (raw === undefined) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    notes.push(`hooks file "${path}" is not valid JSON; hooks not inventoried`)
    return []
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    notes.push(`hooks file "${path}" has an unexpected shape; hooks not inventoried`)
    return []
  }
  return Object.keys(data as Record<string, unknown>).sort()
}

function extractMcp(files: PluginFiles, path: string, notes: string[]): McpServerComponent[] {
  const raw = files[trimDir(path)]
  if (raw === undefined) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    notes.push(`MCP file "${path}" is not valid JSON; servers not inventoried`)
    return []
  }
  const servers = (data !== null && typeof data === 'object' && !Array.isArray(data))
    ? (data as Record<string, unknown>).mcpServers
    : undefined
  if (servers === undefined) {
    notes.push(`MCP file "${path}" has no "mcpServers" object`)
    return []
  }
  const result = normalizeMcpServers(servers, notes)
  return result.servers
}

/** Compute the full component inventory of a plugin's files. */
export function pluginInventory(files: PluginFiles): PluginInventory {
  const notes: string[] = []
  const paths = readManifestPaths(files)
  const inventory: PluginInventory = {
    skills: extractSkills(files, paths.skills ?? 'skills', notes),
    commands: extractCommands(files, paths.commands ?? 'commands'),
    agents: extractAgents(files, paths.agents ?? 'agents'),
    hookEvents: extractHookEvents(files, paths.hooks ?? 'hooks/hooks.json', notes),
    mcpServers: extractMcp(files, paths.mcpServers ?? '.mcp.json', notes),
    notes,
  }
  return inventory
}

/**
 * The sub-map of files belonging to one skill (its directory plus everything
 * below it), with paths rewritten relative to the skill directory.
 */
export function skillFiles(files: PluginFiles, skill: SkillComponent): PluginFiles {
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
