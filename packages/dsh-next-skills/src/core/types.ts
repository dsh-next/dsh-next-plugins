/**
 * Pure shared domain types for the skills manager. No Cordis, host, browser,
 * or Node runtime identity — both halves may import this module.
 */

import type { SkillScopeSetting, SkillsConfig } from './settings.ts'
/** The discovery bucket a skill came from (mirrors the DSH filesystem provider). */
export type SkillSourceBucket =
  | 'project-dsh'
  | 'project-agents'
  | 'custom'
  | 'user-dsh'
  | 'user-agents'
  | 'bundled'

/** One discovered skill as shown in the Skills tab (merged by precedence). */
export interface InstalledSkill {
  name: string
  description: string
  whenToUse?: string
  scope: SkillScope
  source: SkillSourceBucket
  /** Directory-bundle skill (`<name>/SKILL.md`) or flat `<name>.md`. */
  kind: 'bundle' | 'flat'
  /** Absolute path to the skill's SKILL.md (or a flat .md file). */
  path: string
  /** Directory holding the skill's resources (equals the root for flat skills). */
  directory: string
  /** Frontmatter invocation flags (the skill author's defaults, for display). */
  fileModelInvocable: boolean
  fileUserInvocable: boolean
  /** True when the plugin installed this skill (manifest present). */
  managed: boolean  /** The provider spec (`owner/repo`) when this skill was installed from a provider. */
  provider?: string
  /** True when the provider catalog holds a newer version than the installed manifest. */
  updateAvailable?: boolean
  /** The config enablement scope for this name (undefined = global default). */
  configScope?: SkillScopeSetting
}

/** Where a skill physically lives: a user/global root or a project root. */
export type SkillScope = 'global' | 'workspace'

/** One skill offered by a provider (catalog view served to the Skills tab). */
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

/** The full browser-facing state envelope (RPC contract). */
export interface SkillsState {
  /** The settings-backed configuration (providers, installed, scopes). */
  config: SkillsConfig
  /** Discovered skills across the global roots and the requested workspaces. */
  installed: InstalledSkill[]
  /** Provider status rows. */
  providers: ProviderView[]
  /** Every catalog skill across providers (the Add flow). */
  catalog: CatalogSkillView[]
}

/** Full SKILL.md content served by the skill-detail RPCs (modal payload). */
export interface SkillDetail {
  name: string
  description: string
  whenToUse?: string
  /** Frontmatter invocation flags (the skill's own defaults). */
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
  /** Non-fatal note for partially-successful mutations. */
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
 * against the provider catalog, and so a directory is recognizable as
 * plugin-managed even when settings are absent.
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
