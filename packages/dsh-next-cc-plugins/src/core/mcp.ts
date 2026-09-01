/**
 * MCP bridge: normalize Claude Code `.mcp.json` server definitions into
 * `dsh-mcp-client` configuration, and render/replace the managed rows this
 * plugin maintains inside `$DSH_HOME/cordis.patch.yml`.
 *
 * The user-level patch file may contain hand-written rows and loader-specific
 * tags (`!!js`), so it is NEVER parsed as YAML here. The managed region is a
 * marker-delimited text block this plugin owns wholesale: it is re-rendered
 * from the install registry on every change and everything outside the
 * markers is preserved byte-for-byte.
 */
import { isMcpServerName, sanitizeIdentifier } from './name.ts'
import type { McpServerComponent, McpTransport } from './types.ts'

export const MANAGED_BEGIN = '# BEGIN dsh-next-cc-plugins managed MCP rows (do not edit inside)'
export const MANAGED_END = '# END dsh-next-cc-plugins managed MCP rows'

export interface RawMcpServer {
  rowId: string
  serverName: string
  def: McpTransport
  /** Working directory for stdio servers (the plugin's install root). */
  cwd?: string
}

export interface NormalizeMcpResult {
  servers: McpServerComponent[]
  notes: string[]
}

/**
 * Normalize the `mcpServers` object of a `.mcp.json`. Recognizes the Claude
 * Code shapes: stdio (`command`/`args`/`env`, with or without
 * `"type": "stdio"`) and remote (`"type": "http"|"sse"` with `url`/`headers`,
 * mapped to dsh-mcp-client's `streamable-http`). Unrecognized shapes are
 * reported in notes rather than failing the whole plugin.
 */
export function normalizeMcpServers(raw: unknown, notes: string[]): NormalizeMcpResult {
  const out: McpServerComponent[] = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    notes.push('"mcpServers" is not an object; no MCP servers installed')
    return { servers: out, notes }
  }
  for (const [name, def] of Object.entries(raw as Record<string, unknown>)) {
    if (def === null || typeof def !== 'object' || Array.isArray(def)) {
      notes.push(`MCP server "${name}" has an invalid definition; skipped`)
      continue
    }
    const d = def as Record<string, unknown>
    const type = typeof d.type === 'string' ? d.type.toLowerCase() : ''
    const command = typeof d.command === 'string' ? d.command : ''
    const url = typeof d.url === 'string' ? d.url : ''
    if (type === 'http' || type === 'sse' || type === 'streamable-http') {
      if (url === '') {
        notes.push(`MCP server "${name}" is a remote server without a url; skipped`)
        continue
      }
      const headers: Record<string, string> = {}
      if (d.headers !== null && typeof d.headers === 'object' && !Array.isArray(d.headers)) {
        for (const [k, v] of Object.entries(d.headers as Record<string, unknown>)) {
          if (typeof v === 'string') headers[k] = v
        }
      }
      out.push({ name, def: { transport: 'streamable-http', url, headers } })
      continue
    }
    if (command !== '') {
      const args = Array.isArray(d.args) ? d.args.filter((a): a is string => typeof a === 'string') : []
      const env: Record<string, string> = {}
      if (d.env !== null && typeof d.env === 'object' && !Array.isArray(d.env)) {
        for (const [k, v] of Object.entries(d.env as Record<string, unknown>)) {
          if (typeof v === 'string') env[k] = v
        }
      }
      out.push({ name, def: { transport: 'stdio', command, args, env } })
      continue
    }
    notes.push(`MCP server "${name}" uses an unsupported shape (no command, no url); skipped`)
  }
  return { servers: out, notes }
}

// ---------------------------------------------------------------------------
// YAML emission (fixed shape, flow-style collections, single-quoted scalars)
// ---------------------------------------------------------------------------

/** Quote a scalar as a single-quoted YAML string ('' escapes a quote). */
function yamlScalar(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function yamlStringList(values: readonly string[]): string {
  if (values.length === 0) return '[]'
  return `[${values.map((v) => yamlScalar(v)).join(', ')}]`
}

function yamlStringMap(map: Record<string, string>): string {
  const keys = Object.keys(map).sort()
  if (keys.length === 0) return '{}'
  return `{ ${keys.map((k) => `${yamlScalar(k)}: ${yamlScalar(map[k])}`).join(', ')} }`
}

/**
 * Render arbitrary multiline text as a YAML block scalar (`|-` strips the
 * trailing newline) indented by `indent` spaces. Every line is indented, so
 * no content can escape the scalar; empty lines stay empty.
 */
function yamlBlockScalar(text: string, indent: number): string {
  const pad = ' '.repeat(indent)
  const lines = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')
  return `|-\n${lines.map((line) => (line === '' ? '' : pad + line)).join('\n')}`
}

/** Render the dsh-mcp-client config mapping for one server (2-space indent).
 *  `cwd` (stdio only) mirrors Claude Code: plugin MCP servers run with the
 *  plugin's install root as their working directory, so relative command
 *  paths like `./cli/server.js` resolve. */
export function renderMcpConfig(serverName: string, def: McpTransport, cwd?: string): string[] {
  const lines = [
    `        serverName: ${yamlScalar(serverName)}`,
    `        transport: ${yamlScalar(def.transport)}`,
  ]
  if (def.transport === 'stdio') {
    lines.push(`        command: ${yamlScalar(def.command)}`)
    lines.push(`        args: ${yamlStringList(def.args)}`)
    if (Object.keys(def.env).length > 0) lines.push(`        env: ${yamlStringMap(def.env)}`)
    if (cwd !== undefined && cwd !== '') lines.push(`        cwd: ${yamlScalar(cwd)}`)
  } else {
    lines.push(`        url: ${yamlScalar(def.url)}`)
    if (Object.keys(def.headers).length > 0) lines.push(`        headers: ${yamlStringMap(def.headers)}`)
  }
  return lines
}

/**
 * Render one managed MCP row. Row ids use the sanitized
 * `<marketplace>-<plugin>-<server>` join key so uninstalls remove exactly
 * what an install added.
 */
export function renderMcpRow(row: RawMcpServer): string {
  return [
    `    - id: ${yamlScalar(row.rowId)}`,
    `      name: '@deepseek-ai/dsh-mcp-client'`,
    `      config:`,
    ...renderMcpConfig(row.serverName, row.def, row.cwd),
  ].join('\n')
}

/** A managed agent delegation tool row (persona from the Claude agent .md). */
export interface RawAgentRow {
  rowId: string
  toolName: string
  /** Full agent definition text used as the child persona. */
  persona: string
  /** Translated DSH tool names for `toolFilter.allow`; omit for no filter. */
  toolFilter?: string[]
  /** Resolved DSH model id for `agentOptions.model`; omit to inherit. */
  model?: string
}

/**
 * Render one managed agent row as a `dsh-tool-subagent` instance: one
 * distinctly named delegation tool whose child runs the Claude agent's
 * markdown as its persona. The persona is a block scalar so arbitrary
 * multiline text never needs escaping. A translated `tools:` frontmatter
 * becomes `toolFilter.allow` (the child then sees only those global tools)
 * and a mapped `model:` becomes `agentOptions.model`.
 */
export function renderAgentRow(row: RawAgentRow): string {
  // Config keys sit at 8 spaces; block-scalar content must sit one level deeper.
  const persona = yamlBlockScalar(row.persona, 10)
  const lines = [
    `    - id: ${yamlScalar(row.rowId)}`,
    `      name: '@deepseek-ai/dsh-tool-subagent'`,
    `      config:`,
    `        provider: 'spawn'`,
    `        toolName: ${yamlScalar(row.toolName)}`,
  ]
  if (row.toolFilter !== undefined && row.toolFilter.length > 0) {
    lines.push(`        toolFilter:`)
    lines.push(`          allow: ${yamlStringList(row.toolFilter)}`)
  }
  if (row.model !== undefined && row.model !== '') {
    lines.push(`        agentOptions:`)
    lines.push(`          model: ${yamlScalar(row.model)}`)
  }
  lines.push(`        persona: ${persona}`)
  return lines.join('\n')
}

/** Every row kind the managed block can hold. */
export type ManagedRow = RawMcpServer | RawAgentRow

/** Render the complete managed block (including markers). */
export function renderManagedBlock(rows: readonly ManagedRow[]): string {
  if (rows.length === 0) return ''
  const body = rows
    .map((row) => ('toolName' in row ? renderAgentRow(row) : renderMcpRow(row)))
    .join('\n')
  return [MANAGED_BEGIN, '- insert:', body, MANAGED_END].join('\n')
}

/** Extract the current managed block's inner text (null when absent). */
export function extractManagedBlock(text: string): string | null {
  const begin = text.indexOf(MANAGED_BEGIN)
  if (begin === -1) return null
  const end = text.indexOf(MANAGED_END, begin)
  if (end === -1) return null
  return text.slice(begin, end + MANAGED_END.length)
}

/**
 * Splice a pre-rendered managed block into a patch file's text: replaces the
 * existing block in place, appends a fresh one at the end (with a separating
 * blank line), or removes the block when `blockText` is empty. Content
 * outside the markers is untouched.
 */
export function applyManagedBlockText(text: string, blockText: string): string {
  const existing = extractManagedBlock(text)
  if (existing === null) {
    if (blockText === '') return text
    const base = text.replace(/\s+$/, '')
    // `[]` is the canonical empty-array placeholder (see the removal path):
    // the first appended block replaces it, never concatenates after it.
    if (base === '' || base === '[]') return `${blockText}\n`
    return `${base}\n\n${blockText}\n`
  }
  if (blockText === '') {
    // Drop the block plus the blank line that separated it from prior content.
    const before = text.slice(0, text.indexOf(existing)).replace(/\n\n$/, '\n')
    const after = text.slice(text.indexOf(existing) + existing.length).replace(/^\n/, '')
    const next = `${before}${after}`
    // The loader requires a top-level YAML array: a file the removal emptied
    // must become the canonical empty array, never an empty document.
    return next.trim() === '' ? '[]\n' : next
  }
  return text.replace(existing, blockText)
}

/**
 * Splice the managed block into a patch file's text: replaces the existing
 * block in place, appends a fresh one at the end (with a separating blank
 * line), or removes the block when `rows` is empty. Content outside the
 * markers is untouched.
 */
export function applyManagedBlock(text: string, rows: readonly ManagedRow[]): string {
  return applyManagedBlockText(text, renderManagedBlock(rows))
}

/**
 * Pick the MCP serverName for a newly installed server: Claude's own name
 * when already valid, else its sanitized form. The caller resolves
 * collisions against already-installed rows.
 */
export function resolveServerName(claudeName: string): { name: string; sanitized: boolean } {
  if (isMcpServerName(claudeName)) return { name: claudeName, sanitized: false }
  return { name: sanitizeIdentifier(claudeName), sanitized: true }
}

// ---------------------------------------------------------------------------
// ${VAR} template expansion (Claude's MCP substitution surface)
// ---------------------------------------------------------------------------

/** Values Claude Code expands inside plugin MCP server definitions. */
export interface McpTemplateVars {
  /** This plugin's materialized install root (`${CLAUDE_PLUGIN_ROOT}`). */
  pluginRoot: string
  /** This plugin's writable data directory (`${CLAUDE_PLUGIN_DATA}`). */
  pluginData: string
  /** User-provided plugin configuration (`${user_config.<key>}`). */
  userConfig: Readonly<Record<string, string>>
  /** Host environment every other `${NAME}` resolves from. */
  env: Readonly<Record<string, string | undefined>>
}

export interface ExpandedMcpServer {
  server: McpServerComponent
  notes: string[]
}

/** The prefix marking Claude Code's user-provided plugin configuration. */
const USER_CONFIG_PREFIX = 'user_config.'

const TEMPLATE_TOKEN = /\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g

/**
 * Expand `${NAME}` templates in one server definition the way Claude Code
 * does at load time: `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` resolve to
 * this plugin's install paths on this machine, `user_config.<key>` names
 * resolve from the user's plugin configuration map, and every other name
 * resolves from the host environment. `${CLAUDE_PROJECT_DIR}` and names
 * that are not set stay as written, each with a note: DSH's MCP client
 * performs no substitution, so an unexpanded token must be visible to the
 * user rather than silently broken at connect time. Expansion touches
 * exactly the string fields dsh-mcp-client consumes — env and header
 * *names* are never templates, only their values.
 */
export function expandMcpServerTemplates(server: McpServerComponent, vars: McpTemplateVars): ExpandedMcpServer {
  const unresolvedEnv = new Set<string>()
  const unresolvedUserConfig = new Set<string>()
  const expand = (text: string): string =>
    text.replace(TEMPLATE_TOKEN, (whole, name: string) => {
      if (name === 'CLAUDE_PLUGIN_ROOT') return vars.pluginRoot
      if (name === 'CLAUDE_PLUGIN_DATA') return vars.pluginData
      if (name.startsWith(USER_CONFIG_PREFIX)) {
        const value = vars.userConfig[name.slice(USER_CONFIG_PREFIX.length)]
        if (value !== undefined) return value
        unresolvedUserConfig.add(name)
        return whole
      }
      const value = vars.env[name]
      if (value !== undefined) return value
      unresolvedEnv.add(name)
      return whole
    })
  const expandMap = (map: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(map)) out[k] = expand(v)
    return out
  }
  const def = server.def
  const next: McpTransport = def.transport === 'stdio'
    ? { transport: 'stdio', command: expand(def.command), args: def.args.map(expand), env: expandMap(def.env) }
    : { transport: 'streamable-http', url: expand(def.url), headers: expandMap(def.headers) }
  const notes: string[] = []
  if (unresolvedEnv.has('CLAUDE_PROJECT_DIR')) {
    notes.push(`MCP server "${server.name}" references \${CLAUDE_PROJECT_DIR}, which has no single value across scope roots; left as written`)
  }
  for (const name of [...unresolvedEnv].filter((n) => n !== 'CLAUDE_PROJECT_DIR').sort()) {
    notes.push(`MCP server "${server.name}" references \${${name}} which is not set in the environment; left as written`)
  }
  for (const name of [...unresolvedUserConfig].sort()) {
    notes.push(`MCP server "${server.name}" references \${${name}} which is not configured (set runtime.userConfig or cc-plugins/user-config.json); left as written`)
  }
  return { server: { ...server, def: next }, notes }
}
