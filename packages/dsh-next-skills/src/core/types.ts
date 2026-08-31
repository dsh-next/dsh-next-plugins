/**
 * Pure shared domain types for the skills manager. No Cordis, host, browser,
 * or Node runtime identity — both halves may import this module.
 */

/** Where a skill physically lives: a user/global root or a project root. */
export type SkillScope = 'global' | 'workspace'

/** The discovery bucket a skill came from (mirrors the DSH filesystem provider). */
export type SkillSourceBucket =
  | 'project-dsh'
  | 'project-agents'
  | 'custom'
  | 'user-dsh'
  | 'user-agents'
  | 'bundled'

/** How often the host re-syncs provider caches in the background. */
export type RefreshInterval = 'off' | 'daily' | 'weekly'

/** One installed skill as shown in the Installed tab. */
export interface InstalledSkill {
  name: string
  description: string
  whenToUse?: string
  /** Primary on/off switch: disables both model invocation (disable-model-invocation) and user invocation (user-invocable). */
  enabled: boolean
  /** Whether the skill is user-invocable through command surfaces. */
  userInvocable: boolean
  scope: SkillScope
  source: SkillSourceBucket
  /** Directory-bundle skill (`<name>/SKILL.md`) or flat `<name>.md`. */
  kind: 'bundle' | 'flat'
  /** True when this entry is a plugin-generated workspace shadow disabling a global skill. */
  shadow?: boolean
  /** Absolute path to the skill's SKILL.md (or a flat .md file). */
  path: string
  /** Directory holding the skill's resources (equals the root for flat skills). */
  directory: string
  /** The provider spec (`owner/repo`) when this skill was installed from a provider. */
  provider?: string
  /** True when the provider catalog holds a newer version than the installed manifest. */
  updateAvailable?: boolean
}

/** A GitHub provider as configured in settings (spec is `owner/repo`). */
export interface ProviderConfig {
  id: string
  spec: string
  addedAt: string
}

/** The persisted provider list (`providers.json` in the plugin cache root). */
export interface ProvidersFile {
  providers: ProviderConfig[]
}

/** One skill offered by a provider (catalog view served to the Search tab). */
export interface CatalogSkillView {
  name: string
  description: string
  whenToUse?: string
  providerId: string
  providerSpec: string
  /** Repository-relative directory of the skill. */
  skillPath: string
  /** Version hash over the skill's file list (git blob SHAs). */
  version: string
}

/** One provider row served to the Providers tab. */
export interface ProviderView {
  id: string
  spec: string
  skillCount: number
  /** ISO timestamp of the last successful sync; empty when never synced. */
  lastRefresh: string
  /** Repository description captured at sync time. */
  description?: string
  /** Star count captured at sync time. */
  stars?: number
  /** Last sync error message, when the provider could not be read. */
  error?: string
}

/** Marketplace payload: every catalog skill plus provider status rows. */
export interface MarketplaceView {
  skills: CatalogSkillView[]
  providers: ProviderView[]
}

/** The full browser-facing state envelope (RPC contract). */
export interface SkillsState {
  installed: InstalledSkill[]
}

/** Per-scope installed lists used for multi-workspace install decisions. */
export interface InstalledMap {
  global: InstalledSkill[]
  workspaces: Array<{ workspacePath: string; installed: InstalledSkill[] }>
}

/** Full SKILL.md content served by the skill-detail RPCs (modal payload). */
export interface SkillDetail {
  name: string
  description: string
  whenToUse?: string
  /** Frontmatter invocation flags (the skill's "configuration"). */
  modelInvocable: boolean
  userInvocable: boolean
  /** Markdown body below the frontmatter. */
  body: string
}

/** A workspace row surfaced to the client (id/title/path). */
export interface WorkspaceRow {
  id: string
  title: string
  path: string
}

/** Mutation RPC envelope: success carries fresh state; failure carries an error. */
export interface MutationOk {
  ok: true
  state: SkillsState
  /** Non-fatal note for partially-successful mutations (e.g. some copies skipped). */
  warning?: string
}

export interface MutationErr {
  ok: false
  error: string
}

export type MutationResult = MutationOk | MutationErr

/**
 * Manifest written inside every provider-installed skill directory
 * (`.dsh-next-provider.json`) so updates can compare the installed version
 * against the provider catalog.
 */
export interface ProviderManifest {
  providerId: string
  providerSpec: string
  skillPath: string
  version: string
  installedAt: string
}

/** Persisted catalog entry for one file of a provider skill. */
export interface CatalogFile {
  /** Path relative to the skill directory. */
  path: string
  /** Git blob SHA from the repository tree (change detection). */
  sha: string
}

/** Persisted catalog entry for one provider skill. */
export interface CatalogSkill {
  name: string
  description: string
  whenToUse?: string
  /** Cache-relative directory (path slug under files/<providerId>/). */
  cacheDir: string
  skillPath: string
  version: string
  files: CatalogFile[]
}

/** Persisted catalog entry for one provider. */
export interface ProviderCatalog {
  id: string
  spec: string
  branch: string
  lastRefresh: string
  /** Repository description captured at sync time. */
  description?: string
  /** Star count captured at sync time. */
  stars?: number
  error?: string
  skills: CatalogSkill[]
}

/** The whole persisted catalog (cached at <cacheRoot>/catalog.json). */
export interface Catalog {
  providers: ProviderCatalog[]
}

/** Minimal filesystem surface the host adapter implements and tests double. */
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
  /** Move a file or directory (recoverable-delete support). */
  rename(from: string, to: string): Promise<void>
}

/** Injectable network fetch surface for the GitHub client (tests double it). */
export interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
  bytes(): Promise<Uint8Array>
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<FetchResponse>
