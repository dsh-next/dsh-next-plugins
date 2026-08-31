/**
 * Agent frontmatter translation: Claude Code's per-agent `tools:` and
 * `model:` fields have direct `dsh-tool-subagent` counterparts
 * (`toolFilter.allow` and `agentOptions.model`), but neither value can be
 * passed through verbatim:
 *
 *  - `tools:` names CLAUDE tools (Bash, Read, WebSearch, ...). A
 *    `toolFilter.allow` list matches exact DSH tool names, so an untranslated
 *    allowlist would hide every tool from the child. Every well-known Claude
 *    built-in maps onto a DSH tool here, and `mcp__`-qualified tool refs map
 *    onto DSH's MCP client tool names (DSH registers MCP tools under the same
 *    server-qualified shape; plugin-owned servers resolve through the
 *    installed registry rows so name dedupe is honored). Names with no DSH
 *    counterpart (NotebookEdit, an unresolvable plugin server ref, ...) are
 *    dropped with a note rather than silently narrowing the child's surface.
 *  - `model:` names a CLAUDE model (sonnet, opus, haiku, ...). DSH resolves
 *    child models against its own registry, so a Claude id would fail every
 *    delegation at child creation. Only values the user mapped in
 *    `runtime.agentModelMap` are passed on; `model: inherit` (and every
 *    unmapped value) resolves to "no override", which is exactly DSH's
 *    parent-inheritance default.
 */
import type { Frontmatter } from './frontmatter.ts'

/** Well-known Claude Code tool names to DSH tool names. */
export const CLAUDE_TOOL_MAP: Readonly<Record<string, string>> = {
  Agent: 'subagent',
  AskUserQuestion: 'ask_user_question',
  Bash: 'bash',
  Edit: 'edit',
  ExitPlanMode: 'exit_plan_mode',
  Glob: 'glob',
  Grep: 'grep',
  ListAgents: 'list_agents',
  MultiEdit: 'edit',
  Read: 'read',
  Skill: 'skill',
  Task: 'subagent',
  TodoWrite: 'todo_write',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  Write: 'write',
}

/** DeepSeek function-name contract the MCP client normalizes tool names to. */
const MAX_TOOL_NAME_LENGTH = 64
const INVALID_TOOL_NAME_CHARS = /[^A-Za-z0-9_-]/g
const TOOL_NAME_HASH_LENGTH = 12

/**
 * The DSH `dsh-mcp-client` public tool name for one MCP tool: the clean case
 * is `mcp__<serverName>__<rawName>` verbatim; when character replacement or
 * truncation to the 64-char `[A-Za-z0-9_-]` contract changes the name, the
 * client appends a 12-hex-char hash of `(serverName, rawName)`. That mirror
 * of the client's `publicToolName` needs a sha256 digest — provided by the
 * host (node:crypto); without one, lossy names resolve to undefined and the
 * tool ref is dropped with a note instead of guessing.
 */
export function dshMcpToolName(
  serverName: string,
  rawName: string,
  digest?: (input: string) => string,
): string | undefined {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_TOOL_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_TOOL_NAME_LENGTH) return normalized
  if (digest === undefined) return undefined
  const hash = digest(`${serverName}\0${rawName}`).slice(0, TOOL_NAME_HASH_LENGTH)
  return `${normalized.slice(0, MAX_TOOL_NAME_LENGTH - TOOL_NAME_HASH_LENGTH - 1)}_${hash}`
}

/** What `translateTools` needs to resolve `mcp__` tool refs. */
export interface McpToolContext {
  /** The plugin's registry name (Claude prefixes its servers with `plugin_<name>_`). */
  pluginName: string
  /** The plugin's installed MCP rows: Claude server key to resolved DSH serverName. */
  servers: ReadonlyArray<{ claudeName: string; serverName: string }>
  /** sha256 hex digest (host-provided) for lossy DSH tool-name normalization. */
  digest?: (input: string) => string
}

export interface ToolTranslation {
  /** DSH tool names for `toolFilter.allow`, or undefined for "no filter". */
  allow: string[] | undefined
  notes: string[]
}

/**
 * Translate a Claude agent's `tools:` frontmatter value. Accepts the
 * comma-separated and `[a, b]` flow forms and the permission-pattern form
 * (`Bash(git log:*)` — the argument pattern is noted as unenforced and the
 * base tool allowed). `*` (or an empty translation result after drops when
 * nothing was recognized) means no restriction at all, matching Claude's
 * default when `tools:` is absent. `mcp__`-qualified refs resolve through
 * `mcp` when given: refs naming one of the plugin's installed servers map to
 * that row's resolved serverName (so dedupe survives), other plain
 * `mcp__server__tool` refs pass through — DSH's MCP client uses Claude's
 * exact naming contract for user-configured servers.
 */
export function translateTools(raw: string, mcp?: McpToolContext): ToolTranslation {
  const notes: string[] = []
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '*') return { allow: undefined, notes }
  const items = trimmed.replace(/^\[/, '').replace(/\]$/, '').split(',')
  const allow: string[] = []
  for (const item of items) {
    const entry = item.trim()
    if (entry === '' || entry === '*') continue
    if (entry.startsWith('mcp__')) {
      const note = translateMcpRef(entry, mcp, allow)
      if (note !== undefined) notes.push(note)
      continue
    }
    const base = /^([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(entry)
    const claudeName = base !== null ? base[1] : entry
    if (base !== null) notes.push(`tool pattern "${entry}" maps to "${claudeName}"; argument patterns are not enforced by DSH toolFilter`)
    const mapped = CLAUDE_TOOL_MAP[claudeName]
    if (mapped === undefined) {
      notes.push(`tool "${claudeName}" has no DSH counterpart; dropped from the agent's toolFilter`)
      continue
    }
    if (!allow.includes(mapped)) allow.push(mapped)
  }
  if (allow.length === 0) return { allow: undefined, notes }
  return { allow: [...allow].sort(), notes }
}

/**
 * Resolve one `mcp__<server-ref>__<tool>` entry. Plugin-owned refs
 * (`plugin_<pluginName>_<server>` or a bare server key the plugin ships)
 * resolve through the installed rows; foreign refs pass through under DSH's
 * identical naming. Returns a note string when the ref was dropped.
 */
function translateMcpRef(entry: string, mcp: McpToolContext | undefined, allow: string[]): string | undefined {
  const split = entry.lastIndexOf('__')
  const serverRef = entry.slice('mcp__'.length, split)
  const rawName = entry.slice(split + 2)
  if (rawName === '' || serverRef === '') return `tool ref "${entry}" is malformed; dropped from the agent's toolFilter`

  let serverName: string | undefined
  if (mcp !== undefined) {
    const row = mcp.servers.find((s) => s.claudeName === serverRef)
      ?? mcp.servers.find((s) => `plugin_${mcp.pluginName}_${s.claudeName}` === serverRef)
    serverName = row?.serverName
  }
  if (serverName === undefined) {
    // A plugin_-prefixed ref naming no shipped server cannot be attributed to
    // a user-configured server either: drop it rather than guess.
    if (serverRef.startsWith('plugin_')) {
      return `tool "${entry}" has no DSH counterpart; dropped from the agent's toolFilter`
    }
    // A ref we cannot attribute to this plugin's servers still names a
    // user-configured server, and DSH's MCP client exposes exactly that name.
    serverName = serverRef
  }
  const dshName = dshMcpToolName(serverName, rawName, mcp?.digest)
  if (dshName === undefined) {
    return `tool "${entry}" has an exotic name the DSH MCP client renames; dropped from the agent's toolFilter`
  }
  if (!allow.includes(dshName)) allow.push(dshName)
  return undefined
}

export interface ModelResolution {
  /** A DSH model id for `agentOptions.model`, or undefined for "inherit". */
  model: string | undefined
  note?: string
}

/**
 * Resolve a Claude agent's `model:` frontmatter value against the user's
 * `runtime.agentModelMap` (Claude name or full Claude model id to DSH model
 * id; keys match case-insensitively). `model: inherit`, an absent value, or
 * an unmapped value resolves to undefined: the child then inherits the
 * delegating parent's model, which is DSH's default and Claude's `inherit`
 * semantics. Unmapped values produce a note so installs stay honest about
 * what was not applied.
 */
export function resolveAgentModel(
  raw: string | undefined,
  map: Readonly<Record<string, string>>,
): ModelResolution {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed === '' || trimmed === 'inherit') return { model: undefined }
  const hit = map[trimmed]
  if (hit !== undefined && hit.trim() !== '') return { model: hit.trim() }
  const lower = trimmed.toLowerCase()
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() === lower && value.trim() !== '') return { model: value.trim() }
  }
  return { model: undefined, note: `agent model "${trimmed}" has no mapping in runtime.agentModelMap; the child inherits the parent's model` }
}

/** Parse an agent file's frontmatter into the raw fields this bridge reads. */
export function agentFrontmatter(parsed: Frontmatter | undefined): { tools: string; model: string } {
  return {
    tools: parsed?.tools ?? '',
    model: parsed?.model ?? '',
  }
}
