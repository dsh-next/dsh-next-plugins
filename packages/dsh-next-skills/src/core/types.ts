/**
 * Pure shared domain types for the skills manager. No Cordis, host, browser,
 * or Node runtime identity — both halves may import this module.
 */

import type { SkillScopeSetting } from './settings.ts'
import type { SkillOwnership } from './ownership.ts'
/** The discovery bucket a skill came from (mirrors the DSH filesystem provider). */
export type SkillSourceBucket =
  | 'project-dsh'
  | 'project-agents'
  | 'user-dsh'
  | 'user-agents'
  | 'bundled'

/** One discovered skill copy as shown in the Skills tab (one entry per copy). */
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
  /** Provider spec (`owner/repo`) when installed from a provider; undefined for local skills. */
  provider?: string
  /** True when a same-name catalog skill differs from this copy's content. */
  updateAvailable?: boolean
  /** Same-name catalog skills whose content differs (driver of the update picker). */
  updateCandidates?: CatalogSkillMatch[]
  /** The config enablement scope for this name (undefined = global default). */
  configScope?: SkillScopeSetting
  /** External-ownership provenance (undefined for skills- and hand-created skills). */
  ownership?: SkillOwnership
}

/** A catalog skill that can replace a local copy (name match + version differs). */
export interface CatalogSkillMatch {
  providerId: string
  providerSpec: string
  skillPath: string
  version: string
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
  /** Discovered skill copies across the global roots and the requested workspaces. */
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

/** Persisted catalog entry for one file of a provider skill. */
export interface CatalogFile {
  /** Path relative to the skill directory. */
  path: string
  /** Content hash of the file (snapshot sync). */
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
  access(path: string): Promise<void>
  /** Move a file or directory (recoverable-delete support). */
  rename(from: string, to: string): Promise<void>
}

/** Injectable network fetch surface for the GitHub client (tests double it). */
export interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  bytes(): Promise<Uint8Array>
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<FetchResponse>

// ---------------------------------------------------------------------------
// External skill handoff (cc-plugins bridge consumes this service surface)
// ---------------------------------------------------------------------------

/** One external skill's file set handed from the owning plugin, with paths
 *  relative to the skill directory (the owning plugin rewrites plugin-level
 *  references before handing off). */
export interface ExternalSkillFiles {
  /** Registry skill name (kebab-case). */
  name: string
  /** Skill directory contents, path-relative to the skill dir (SKILL.md present). */
  files: Record<string, string>
}

/** Arguments for installing externally-managed skills into the global root. */
export interface InstallExternalSkillsArgs {
  owner: string
  pluginKey: string
  marketplaceId: string
  skills: ExternalSkillFiles[]
  /** Initial per-name enablement (workspace folder names); undefined = everywhere. */
  workspaces?: readonly string[]
}

/** Arguments for updating the enablement scope of one external skill name. */
export interface SetExternalSkillScopeArgs {
  owner: string
  name: string
  /** Workspace folder names; undefined clears (everywhere), [] disables everywhere. */
  workspaces?: readonly string[] | null
}

/** Arguments for removing every skill owned by one plugin install. */
export interface RemoveExternalSkillsArgs {
  owner: string
  pluginKey: string
  /** When set, remove only these skill names (update: skills dropped upstream). */
  skillNames?: readonly string[]
}

/** Envelope for external handoff operations (mirrors MutationResult shape). */
export interface ExternalMutationResult {
  ok: boolean
  error?: string
  warning?: string
}
