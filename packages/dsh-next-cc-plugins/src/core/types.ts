/**
 * Shared types for the Claude Code marketplace bridge. Pure data only: the
 * filesystem and fetch faces are structural doubles so host services are
 * testable in-memory, and every view type here is what the browser panel
 * consumes over the JSON RPC route.
 */

// ---------------------------------------------------------------------------
// Structural host faces
// ---------------------------------------------------------------------------

/** Structural shape of one install target (request or record entry). */
export interface TargetLike {
  scope: 'global' | 'workspace'
  workspacePath?: string
}

export interface FsDirent {
  name: string
  isDirectory(): boolean
}

export interface FsLike {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  readdir(path: string): Promise<FsDirent[]>
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>
  stat(path: string): Promise<{ isDirectory(): boolean }>
  access(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
  bytes(): Promise<Uint8Array>
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<FetchResponse>

// ---------------------------------------------------------------------------
// Marketplace sources
// ---------------------------------------------------------------------------

/** A resolved marketplace source: a GitHub repository or a local directory. */
export type MarketplaceSource =
  | { kind: 'github'; owner: string; repo: string }
  | { kind: 'local'; path: string }

/** Result of parsing a user-typed marketplace spec. */
export type SourceParseResult =
  | { source: MarketplaceSource; canonical: string; id: string }
  | { error: string }

/** One configured marketplace, as persisted in `marketplaces.json`. */
export interface StoredMarketplace {
  id: string
  /** The canonical spec (owner/repo or absolute path). */
  spec: string
  addedAt: string
}

// ---------------------------------------------------------------------------
// Marketplace index (.claude-plugin/marketplace.json)
// ---------------------------------------------------------------------------

/** Where a marketplace entry's plugin files live. */
export type PluginSource =
  | { kind: 'relative'; path: string }
  | { kind: 'github'; owner: string; repo: string; ref?: string }
  | { kind: 'unsupported'; raw: string; reason: string }

/** A normalized plugin entry from a marketplace index. */
export interface MarketplacePlugin {
  name: string
  description: string
  version: string
  category: string
  author: string
  homepage: string
  tags: string[]
  source: PluginSource
}

/** A parsed marketplace index. */
export interface MarketplaceIndex {
  name: string
  description: string
  owner: string
  plugins: MarketplacePlugin[]
}

// ---------------------------------------------------------------------------
// Plugin component inventory
// ---------------------------------------------------------------------------

export interface SkillComponent {
  /** Registry skill name (frontmatter `name` or directory base name). */
  name: string
  description: string
  /** Plugin-relative directory of the skill (bundle form) or '' (flat). */
  path: string
  /** Plugin-relative file of a single-file skill (flat form). */
  file?: string
}

export interface CommandComponent {
  /** Slash-command style name derived from the file path. */
  name: string
  description: string
  path: string
  /** Plugin-relative path of the command's markdown file. */
  file?: string
}

export interface AgentComponent {
  name: string
  description: string
  path: string
  /** Plugin-relative path of the agent's markdown file. */
  file?: string
  /** Raw `tools:` frontmatter (comma-separated Claude tool names), '' when absent. */
  tools: string
  /** Raw `model:` frontmatter (Claude model name or id), '' when absent. */
  model: string
}

export type McpTransport =
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { transport: 'streamable-http'; url: string; headers: Record<string, string> }

export interface McpServerComponent {
  /** Server name from .mcp.json (Claude's key). */
  name: string
  def: McpTransport
}

/** Everything a Claude Code plugin bundles, extracted from its files. */
export interface PluginInventory {
  skills: SkillComponent[]
  commands: CommandComponent[]
  agents: AgentComponent[]
  /** Hook event names declared in hooks/hooks.json. */
  hookEvents: string[]
  mcpServers: McpServerComponent[]
  /** Non-fatal notes (skipped components, unusual shapes). */
  notes: string[]
}

// ---------------------------------------------------------------------------
// Installed-plugin registry
// ---------------------------------------------------------------------------

/** One installed skill copy recorded in the registry. */
export interface InstalledSkillRef {
  name: string
  /** Absolute path of the installed skill directory. */
  directory: string
}

/** One installed MCP server row (managed-block content). */
export interface InstalledMcpRow {
  /** Composition row id inside the managed block. */
  rowId: string
  /** Resolved (deduped, sanitized) dsh-mcp-client serverName. */
  serverName: string
  /** Claude's original server key, kept for stable row ids across updates. */
  claudeName: string
  /** The full dsh-mcp-client config, persisted so the managed block can be
   *  re-rendered from the registry alone. */
  def: McpTransport
}

/** One installed agent delegation tool row (managed-block content). */
export interface InstalledAgentRow {
  /** Composition row id inside the managed block. */
  rowId: string
  /** Model-facing tool name (`cc-agent-<name>`, deduped across plugins). */
  toolName: string
  /** Claude's original agent name (the agents/*.md file name). */
  claudeName: string
  /** The full agent definition text (the dsh-tool-subagent persona), persisted
   *  so the managed block can be re-rendered from the registry alone. */
  persona: string
  /** Translated DSH tool names for `toolFilter.allow`; undefined = no filter. */
  toolFilter?: string[]
  /** Resolved DSH model id for `agentOptions.model`; undefined = inherit. */
  model?: string
}

/** Components recorded for the runtime bridge: commands register in-process
 *  from the cached plugin files, hook events run only while `runtime.hooks`
 *  is enabled (they execute third-party shell commands). */
export interface PendingComponents {
  commands: string[]
  hookEvents: string[]
}

/** One install target of a plugin: a skills root (global or one workspace). */
export interface InstalledTarget {
  scope: 'global' | 'workspace'
  /** Absolute workspace path; present only for the workspace scope. */
  workspacePath?: string
  /** Skill copies living in this target's skills root. */
  skills: InstalledSkillRef[]
}

/** A persisted install record (installed.json value). Skills live per target
 *  (the global root and/or any workspace root); MCP rows, agent rows, and the
 *  pending components are plugin-level and activate once regardless of how
 *  many targets hold the skills. */
export interface InstalledPlugin {
  /** `<marketplaceId>/<pluginName>`. */
  key: string
  marketplaceId: string
  marketplaceSpec: string
  pluginName: string
  /** Effective version at install/update time: the marketplace entry's
   *  `version`, falling back to the plugin's own `plugin.json` version. */
  version: string
  /** Digest of the marketplace snapshot at install/update time — the update
   *  signal for plugins no version is carried for. */
  snapshotDigest?: string
  installedAt: string
  updatedAt: string
  targets: InstalledTarget[]
  mcpServers: InstalledMcpRow[]
  agents: InstalledAgentRow[]
  pending: PendingComponents
}

export interface InstalledFile {
  plugins: InstalledPlugin[]
}

// ---------------------------------------------------------------------------
// RPC view shapes
// ---------------------------------------------------------------------------

export interface MutationResult {
  ok: boolean
  error?: string
  /** Human-readable summary of what an install/update touched. */
  message?: string
  state?: CcState
}

/** Row shown in the Marketplaces tab. */
export interface MarketplaceViewRow {
  id: string
  spec: string
  name: string
  description: string
  owner: string
  lastSync: string
  error?: string
  plugins: MarketplacePluginView[]
}

export interface MarketplacePluginView {
  name: string
  description: string
  version: string
  category: string
  author: string
  homepage: string
  tags: string[]
  /** Resolved inventory when the files are locally available (in-repo plugins). */
  inventory?: PluginInventory
  /** Set when the source form is not installable by this bridge version. */
  sourceUnsupported?: string
  installed: boolean
  /** The installed record's version, set when this plugin is installed. */
  installedVersion?: string
  /** Set when the snapshot's catalog version is newer than the installed one. */
  updateAvailable?: true
}

/** One model the live `llm` service offers (best-effort discovery). */
export interface RuntimeModel {
  /** Provider route key (e.g. `deepseek-official`). */
  provider: string
  /** Model id passed to `agentOptions.model`. */
  id: string
  /** Human-readable model name for selectors. */
  name: string
}

/** Full browser-facing state envelope. */
export interface CcState {
  installed: InstalledPlugin[]
  marketplaces: MarketplaceViewRow[]
  /** Models the runtime currently offers, for the Models tab pickers. */
  models: RuntimeModel[]
  /** Effective Claude-alias to DSH-model map (config baseline merged with
   *  the panel's saved overrides). */
  agentModelMap: Record<string, string>
  /** The composition-config baseline portion of {@link agentModelMap}. */
  agentModelConfig: Record<string, string>
  /** The panel's saved overrides verbatim: a model id, or `null` marking an
   *  alias as explicitly inheriting the session model (suppressing a config
   *  baseline value). */
  agentModelOverrides: Record<string, string | null>
  /** Every Claude model name worth offering a picker for: the classic
   *  families, mapped aliases, and names installed agents reference. */
  agentModelAliases: string[]
  /** Human-readable notes from the last settings-document import that this
   *  machine could not fully satisfy (e.g. missing workspace names). */
  importSkipped: string[]
}

export interface PluginDetail {
  name: string
  description: string
  inventory: PluginInventory
}

/** A workspace row extracted structurally on the client (see client/workspaces.ts). */
export interface WorkspaceRow {
  id: string
  title: string
  path: string
}
