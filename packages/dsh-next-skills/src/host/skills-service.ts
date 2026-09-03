/**
 * Stateful host implementation of the skills manager (settings-backed model).
 *
 * Skills are installed GLOBAL-ONLY, into the user skill root
 * (`<agentsHome>/skills`); projects keep only hand-created, version-controlled
 * skills, which the plugin discovers read-only. Providers, installed records,
 * and per-name enablement scopes persist in the `dsh-next-skills` settings
 * namespace (the harness `settings.yaml`), so the configuration is readable
 * and shareable between developers. Enable/disable never writes skill files —
 * scopes are applied at discovery time by the plugin's `ctx.skills` provider.
 *
 * All filesystem and network access flows through injected `fs`/`fetch`
 * faces, and config access through a structural scope face, so the service is
 * fully testable with in-memory doubles.
 */
import { catalogSkillViews, parseCatalog, providerViews } from '../core/catalog.ts'
import { parseSkillFile } from '../core/frontmatter.ts'
import { isSkillName } from '../core/name.ts'
import { basenamePath, dirnamePath, isSafeRelativePath, joinPath } from '../core/path.ts'
import { fingerprintVersion, providerId, providerSpec, type FingerprintFile } from '../core/provider.ts'
import { globalSkillsRoot, resolveSkillRoots, sortRootsByPrecedence, type SkillRoot } from '../core/scope.ts'
import {
  configForStorage,
  normalizeSkillsConfig,
  pruneOrphanScopes,
  withScope,
  type InstalledRecord,
  type ProviderRecord,
  type SkillScopeSetting,
  type SkillsConfig,
} from '../core/settings.ts'
import type {
  Catalog,
  CatalogSkill,
  CatalogSkillMatch,
  CatalogSkillView,
  ExternalMutationResult,
  FetchLike,
  FsLike,
  InstallExternalSkillsArgs,
  InstalledSkill,
  MutationResult,
  ProviderView,
  RemoveExternalSkillsArgs,
  SetExternalSkillScopeArgs,
  SkillDetail,
  SkillScope,
  SkillSourceBucket,
  SkillsState,
} from '../core/types.ts'
import { ProviderStore } from './provider-store.ts'
import { ownershipSidecarText, parseOwnership, OWNERSHIP_SIDECAR, type SkillOwnership } from '../core/ownership.ts'

/** Recoverable-delete directory inside every skill root (skipped by discovery). */
export const TRASH_DIR = '.trash'

/**
 * Structural face over the settings namespace scope. The host passes the real
 * `SettingsScope<SkillsConfigShape>`; tests pass in-memory doubles.
 */
export interface ConfigScopeFace {
  get(): unknown
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
  watch(callback: (next: unknown, prev: unknown) => void): () => void
}

export interface SkillsServiceOptions {
  fs: FsLike
  fetch: FetchLike
  dshHome: string
  agentsHome: string
  /** Optional warning sink (the host passes ctx.logger.warn). */
  logWarn?: (message: string) => void
  /** The registered settings scope face (required in the real host). */
  config: ConfigScopeFace
}

/** One skill discovered on disk, before config enrichment. */
export interface DiscoveredSkill {
  name: string
  description: string
  whenToUse?: string
  fileModelInvocable: boolean
  fileUserInvocable: boolean
  scope: SkillScope
  source: SkillSourceBucket
  kind: 'bundle' | 'flat'
  path: string
  directory: string
  ownership?: SkillOwnership
}

/** Scan one root into discovered skills (invalid files are skipped silently). */
export async function discoverRoot(fs: FsLike, root: SkillRoot): Promise<DiscoveredSkill[]> {
  let entries
  try {
    entries = await fs.readdir(root.path)
  } catch {
    return []
  }
  entries = [...entries].sort((a, b) => a.name.localeCompare(b.name))
  const out: DiscoveredSkill[] = []
  for (const entry of entries) {
    if (entry.name === '.system' && root.source === 'user-dsh') continue
    if (entry.name === '.trash') continue
    let skillPath: string
    let directory: string
    let kind: 'bundle' | 'flat'
    if (entry.isDirectory()) {
      skillPath = joinPath(root.path, entry.name, 'SKILL.md')
      directory = joinPath(root.path, entry.name)
      kind = 'bundle'
    } else if (entry.name.endsWith('.md')) {
      skillPath = joinPath(root.path, entry.name)
      directory = root.path
      kind = 'flat'
    } else {
      continue
    }
    let content: string
    try {
      content = await fs.readFile(skillPath)
    } catch {
      continue
    }
    const parsed = parseSkillFile(content)
    if (parsed === undefined) continue
    out.push({
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
      fileModelInvocable: parsed.modelInvocable,
      fileUserInvocable: parsed.userInvocable,
      scope: root.scope,
      source: root.source,
      kind,
      path: skillPath,
      directory,
      ...(await readOwnership(fs, directory)),
    })
  }
  return out
}

/** Read the ownership sidecar of a skill directory (undefined when absent). */
async function readOwnership(fs: FsLike, directory: string): Promise<{ ownership: SkillOwnership } | undefined> {
  try {
    const raw = await fs.readFile(joinPath(directory, OWNERSHIP_SIDECAR))
    const parsed = parseOwnership(JSON.parse(raw))
    if (parsed === undefined) return undefined
    return { ownership: parsed }
  } catch {
    return undefined
  }
}

/** Parse a SKILL.md into the detail-modal payload (undefined when invalid). */
function skillDetailFromContent(content: string): SkillDetail | undefined {
  const parsed = parseSkillFile(content)
  if (parsed === undefined) return undefined
  return {
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
    modelInvocable: parsed.modelInvocable,
    userInvocable: parsed.userInvocable,
    body: parsed.body,
  }
}

export class SkillsService {
  private readonly store: ProviderStore

  constructor(private readonly opts: SkillsServiceOptions) {
    this.store = new ProviderStore({
      fs: opts.fs,
      fetch: opts.fetch,
      cacheRoot: joinPath(opts.dshHome, 'skills-market'),
    })
  }

  /** The current normalized configuration snapshot. */
  config(): SkillsConfig {
    return normalizeSkillsConfig(this.opts.config.get())
  }

  /**
   * Enumerate the plugin's own surface: skills in the GLOBAL roots only,
   * merged by precedence, enriched with the settings record's managed/update
   * facts and the config scope per name. Project/workspace skills are
   * deliberately absent — they are hand-managed in the project and discovered
   * natively by the DSH filesystem provider; this plugin neither lists nor
   * manages them.
   */
  async listInstalled(): Promise<InstalledSkill[]> {
    const roots = sortRootsByPrecedence(resolveSkillRoots({
      dshHome: this.opts.dshHome,
      agentsHome: this.opts.agentsHome,
    }))
    const lists = await Promise.all(roots.map((root) => discoverRoot(this.opts.fs, root)))
    // Multi-copy: keep every discovered copy, no name-precedence collapse.
    const discovered: DiscoveredSkill[] = lists.flat()
    const config = this.config()
    const catalog = await this.store.readCatalog()
    // Same-name catalog matches, indexed by name for the update candidates.
    const catalogByName = new Map<string, CatalogSkillMatch[]>()
    for (const provider of catalog.providers) {
      for (const skill of provider.skills) {
        const matches = catalogByName.get(skill.name) ?? []
        matches.push({ providerId: provider.id, providerSpec: provider.spec, skillPath: skill.skillPath, version: skill.version })
        catalogByName.set(skill.name, matches)
      }
    }
    return Promise.all(discovered.map(async (skill): Promise<InstalledSkill> => {
      const record = config.installations.find((r) => r.name === skill.name)
      // Update candidates, pinned to provenance:
      //  - externally-owned skills (the cc-plugins bridge) never offer
      //    provider updates — their update path is the owning plugin;
      //  - a recorded skill updates only from its recorded provider, so
      //    same-name skills offered by OTHER providers never flap the
      //    Update button in a cycle (vendor switching is a deliberate
      //    delete-and-reinstall, not an "update");
      //  - an unrecorded (hand-created) copy may adopt any same-name
      //    catalog skill — the first update pins it via the ledger record.
      // Only bundle skills are updatable; flat skills are DSH-native single
      // files with no bundled directory to fingerprint against a catalog.
      let updateCandidates: CatalogSkillMatch[] | undefined
      if (skill.kind === 'bundle' && skill.ownership === undefined) {
        let matches = catalogByName.get(skill.name) ?? []
        if (record !== undefined) {
          const pinned = matches.filter((m) => m.providerId === record.providerId)
          // Prefer the recorded path; a provider that moved the skill keeps
          // its single same-name entry as the candidate.
          const exact = pinned.find((m) => m.skillPath === record.skillPath)
          matches = exact !== undefined ? [exact] : pinned.length === 1 ? pinned : []
        }
        if (matches.length > 0) {
          const local = await this.fingerprintCopy(skill.directory)
          const differing = matches.filter((m) => m.version !== local)
          updateCandidates = differing.length > 0 ? differing : undefined
        }
      }
      return {
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
        scope: skill.scope,
        source: skill.source,
        kind: skill.kind,
        path: skill.path,
        directory: skill.directory,
        ...(skill.ownership !== undefined ? { ownership: skill.ownership } : {}),
        ...(record?.providerSpec !== undefined ? { provider: record.providerSpec } : {}),
        ...(updateCandidates !== undefined ? { updateAvailable: true, updateCandidates } : {}),
        ...(config.scopes[skill.name] !== undefined ? { configScope: config.scopes[skill.name] } : {}),
      }
    }))
  }

  /**
   * Content fingerprint of a bundle skill directory, using the same recipe
   * as a catalog `version`. Every regular file (recursively) contributes a
   * `<rel-path>:content-hash` line; a legacy `.dsh-next-provider.json`
   * sidecar is skipped so a leftover manifest never falsifies the compare.
   */
  private async fingerprintCopy(directory: string): Promise<string> {
    const files: FingerprintFile[] = []
    const walk = async (rel: string): Promise<void> => {
      let entries
      try {
        entries = await this.opts.fs.readdir(rel === '' ? directory : joinPath(directory, rel))
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name === '.dsh-next-provider.json' || entry.name === '.trash' || entry.name === OWNERSHIP_SIDECAR) continue
        const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
        if (entry.isDirectory()) {
          await walk(relPath)
        } else {
          try {
            const content = await this.opts.fs.readFile(joinPath(directory, relPath))
            files.push({ path: relPath, content })
          } catch {
            // unreadable file: skip
          }
        }
      }
    }
    await walk('')
    return fingerprintVersion(files)
  }

  /** The full browser-facing state envelope. */
  async state(): Promise<SkillsState> {
    const [installed, catalog] = await Promise.all([this.listInstalled(), this.store.readCatalog()])
    // Orphan-scope GC: drop enablement keys whose name no longer resolves to
    // a discovered copy or a catalog skill (a deleted/renamed skill).
    const config = this.config()
    const installedNames = [...new Set(installed.map((s) => s.name))]
    const catalogNames = [...new Set(catalogSkillViews(catalog).map((s) => s.name))]
    const pruned = pruneOrphanScopes(config, installedNames, catalogNames)
    if (Object.keys(pruned.scopes).length !== Object.keys(config.scopes).length) {
      await this.writeConfig(pruned)
    }
    return {
      installed,
      providers: this.providerRows(catalog),
      catalog: catalogSkillViews(catalog),
    }
  }

  /**
   * Provider status rows derive from the settings section — the single
   * source managing which providers exist. Each configured provider is
   * enriched with its catalog-cache metadata (sync age, stars, error) when
   * a synced snapshot exists, and shows as "never synced" until then. A
   * cache entry WITHOUT a settings record is invisible: the cache is a
   * replica, never a source.
   */
  private providerRows(catalog: Catalog): ProviderView[] {
    const cached = new Map(providerViews(catalog).map((row) => [row.id, row]))
    return this.config().providers
      .map((p) => cached.get(p.id) ?? { id: p.id, spec: p.spec, skillCount: 0, lastRefresh: '', error: 'never synced' })
      .sort((a, b) => a.spec.localeCompare(b.spec))
  }

  /**
   * Seed the default provider list on a truly fresh install: only when the
   * config holds no providers AND no legacy providers.json exists (migration
   * would otherwise adopt it). Runs once; later removals persist.
   */
  async ensureDefaultProviders(defaults: readonly string[]): Promise<boolean> {
    const config = this.config()
    if (config.providers.length > 0) return false
    if (await this.store.hasLegacyProvidersFile()) return false
    const addedAt = new Date().toISOString()
    const providers: ProviderRecord[] = defaults
      .map((spec) => ({ spec, id: providerId(spec) }))
      .filter((p): p is { spec: string; id: string } => p.id !== undefined)
      .map((p) => ({ id: p.id, spec: p.spec, addedAt }))
    await this.writeConfig({ ...config, providers })
    return true
  }

  /** Persist a whole normalized config through the scope face. */
  private async writeConfig(config: SkillsConfig): Promise<void> {
    await this.opts.config.replace(configForStorage(config))
  }

  /** Full SKILL.md content for a catalog skill (detail modal). */
  async getCatalogSkillDetail(args: { providerId: string; skillPath: string }): Promise<SkillDetail | undefined> {
    const catalog = await this.store.readCatalog()
    const provider = catalog.providers.find((p) => p.id === args.providerId)
    const skill = provider?.skills.find((s) => s.skillPath === args.skillPath)
    if (provider === undefined || skill === undefined) return undefined
    let content: string
    try {
      content = await this.store.readCachedFile(provider.id, skill, 'SKILL.md')
    } catch {
      return undefined
    }
    return skillDetailFromContent(content)
  }

  /** Full SKILL.md content for a discovered skill (detail modal). The copy is
   *  resolved by its `path` when given — under the per-copy model a name may
   *  have several copies, and the modal must show the body of the copy whose
   *  name was clicked, not the first name match. */
  async getInstalledSkillDetail(args: { name: string; path?: string }): Promise<SkillDetail | undefined> {
    const rows = await this.listInstalled()
    const row = args.path !== undefined
      ? rows.find((r) => r.path === args.path && r.name === args.name)
      : rows.find((r) => r.name === args.name)
    if (row === undefined) return undefined
    let content: string
    try {
      content = await this.opts.fs.readFile(row.path)
    } catch {
      return undefined
    }
    return skillDetailFromContent(content)
  }

  /**
   * Set the enablement scope for one skill name: the workspace DIRECTORY
   * NAMES where it is enabled (entries may arrive as full paths and are
   * normalized to their basename, so the settings section stays portable
   * between developers). Pure config: no skill file is touched.
   * `undefined`/null clears the stored entry (absent = the everywhere
   * default); an empty list disables the skill everywhere.
   */
  async setSkillScope(args: { name: string; workspaces?: readonly string[] | null }): Promise<MutationResult> {
    if (!isSkillName(args.name)) return { ok: false, error: `invalid skill name "${args.name}"` }
    if (await this.isExternalOwnedName(args.name)) {
      return { ok: false, error: `skill "${args.name}" is managed by an external plugin; change its scope from that plugin` }
    }
    let scope: SkillScopeSetting | undefined
    if (args.workspaces !== undefined && args.workspaces !== null) {
      scope = [...new Set(args.workspaces.map((p) => basenamePath(p.trim())).filter((p) => p !== ''))]
    }
    const config = this.config()
    const scopes = withScope(config.scopes, args.name, scope)
    // Persist the WHOLE section: the settings provider deep-merges update()
    // patches, so a cleared entry would silently survive inside the scopes
    // map. Only a wholesale replace can delete a key.
    await this.writeConfig({ ...config, scopes })
    return { ok: true, state: await this.state() }
  }

  /**
   * Add a GitHub provider: validate the spec, persist it in settings, and
   * sync its skills into the cache (downloading every skill file once).
   */
  async addProvider(spec: string): Promise<MutationResult> {
    const canonical = providerSpec(spec)
    const id = providerId(spec)
    if (canonical === undefined || id === undefined) {
      return { ok: false, error: `invalid provider spec "${spec}" (expected owner/repo or a GitHub URL)` }
    }
    const config = this.config()
    if (!config.providers.some((p) => p.id === id)) {
      await this.writeConfig({ ...config, providers: [...config.providers, { id, spec: canonical, addedAt: new Date().toISOString() }] })
    }
    try {
      await this.store.syncProvider(canonical)
    } catch (error) {
      await this.store.markProviderError(id, error instanceof Error ? error.message : String(error), canonical).catch((e) => {
        this.opts.logWarn?.(`could not persist provider error: ${e instanceof Error ? e.message : String(e)}`)
      })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    return { ok: true, state: await this.state() }
  }

  async removeProvider(id: string): Promise<MutationResult> {
    const config = this.config()
    if (!config.providers.some((p) => p.id === id)) {
      return { ok: false, error: `provider "${id}" is not configured` }
    }
    await this.writeConfig({ ...config, providers: config.providers.filter((p) => p.id !== id) })
    await this.store.removeProvider(id)
    return { ok: true, state: await this.state() }
  }

  /** Re-sync one provider; a failure is recorded on its catalog row. The
   *  trailing reconcile heals the replica: recorded skills whose files are
   *  missing (e.g. a cloned settings section, or a first boot whose sync
   *  failed) install now that the snapshot is in the cache. */
  async refreshProvider(id: string): Promise<MutationResult> {
    const provider = this.config().providers.find((p) => p.id === id)
    if (provider === undefined) return { ok: false, error: `provider "${id}" is not configured` }
    try {
      await this.store.syncProvider(provider.spec)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.markProviderError(id, message, provider.spec).catch((e) => {
        this.opts.logWarn?.(`could not persist provider error: ${e instanceof Error ? e.message : String(e)}`)
      })
      return { ok: false, error: message }
    }
    const notes = await this.reconcileInstalled()
    const healed = notes.filter((n) => n.includes('reinstalled from'))
    return { ok: true, state: await this.state(), ...(healed.length > 0 ? { warning: healed.join('; ') } : {}) }
  }

  /** Restore every recorded-but-missing skill from the synced caches: the
   *  settings section is the source, the disk is its replica. Exposed to the
   *  panel so a manual Refresh ends with the replica healed. */
  async reconcile(): Promise<MutationResult> {
    const notes = await this.reconcileInstalled()
    const healed = notes.filter((n) => n.includes('reinstalled from'))
    return { ok: true, state: await this.state(), ...(healed.length > 0 ? { warning: healed.join('; ') } : {}) }
  }

  /** Re-sync every configured provider; failures are collected per provider. */
  async refreshProviders(): Promise<MutationResult> {
    const failures: string[] = []
    for (const provider of this.config().providers) {
      try {
        await this.store.syncProvider(provider.spec)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.store.markProviderError(provider.id, message, provider.spec).catch((e) => {
          this.opts.logWarn?.(`could not persist provider error: ${e instanceof Error ? e.message : String(e)}`)
        })
        failures.push(`${provider.spec}: ${message}`)
      }
    }
    if (failures.length > 0) return { ok: false, error: `refresh failed for ${failures.length} provider(s): ${failures.join('; ')}` }
    return { ok: true, state: await this.state() }
  }

  /**
   * Install a catalog skill from the cache into the GLOBAL root and record it
   * in settings (with an optional initial workspace-name whitelist). Skills
   * never install into projects.
   */
  async installSkill(args: {
    providerId: string
    skillPath: string
    workspaces?: readonly string[] | null
  }): Promise<MutationResult> {
    const catalog = await this.store.readCatalog()
    const provider = catalog.providers.find((p) => p.id === args.providerId)
    if (provider === undefined) return { ok: false, error: `provider "${args.providerId}" is not configured` }
    const skill = provider.skills.find((s) => s.skillPath === args.skillPath)
    if (skill === undefined) return { ok: false, error: `skill "${args.skillPath}" is not in the ${provider.spec} catalog` }
    if (!isSkillName(skill.name)) return { ok: false, error: `invalid skill name "${skill.name}"` }

    const targetDir = joinPath(globalSkillsRoot(this.opts.agentsHome), skill.name)
    try {
      await this.opts.fs.access(targetDir)
      return { ok: false, error: `skill "${skill.name}" is already installed` }
    } catch {
      // not installed yet
    }
    const err = await this.copySkillFiles(provider.id, skill, targetDir)
    if (err !== undefined) return { ok: false, error: err }

    const config = this.config()
    const installations: InstalledRecord[] = [
      ...config.installations.filter((r) => r.name !== skill.name),
      {
        name: skill.name,
        providerId: provider.id,
        providerSpec: provider.spec,
        skillPath: skill.skillPath,
      },
    ]
    const initialScope: SkillScopeSetting | undefined = args.workspaces !== undefined && args.workspaces !== null
      ? [...new Set(args.workspaces.map((p) => basenamePath(p.trim())).filter((p) => p !== ''))]
      : undefined
    const scopes = withScope(config.scopes, skill.name, initialScope)
    await this.writeConfig({ ...config, installations, scopes })
    return { ok: true, state: await this.state() }
  }

  /**
   * Update one copy in place to the cached catalog version: overwrite the
   * files, drop files that no longer exist upstream, and adopt the name into
   * the installations ledger so future updates track. The target directory
   * must be inside a known skill root; the provider skill must match the copy
   * name. Works for any copy (managed or hand-created).
   */
  async updateSkill(args: { name: string; directory: string; providerId: string; skillPath: string }): Promise<MutationResult> {
    if (!isSkillName(args.name)) return { ok: false, error: `invalid skill name "${args.name}"` }
    if (!this.isWithinKnownRoot(args.directory)) return { ok: false, error: `directory is not inside a managed skill root` }
    if (this.isWithinProjectRoot(args.directory)) {
      return { ok: false, error: `skill "${args.name}" lives in a workspace root; workspace skills are updated by hand in the project` }
    }
    const ownership = await this.readOwnershipAt(args.directory)
    if (ownership !== undefined) {
      return { ok: false, error: `skill "${args.name}" is managed by ${ownership.owner} (${ownership.pluginKey}); update it through that plugin` }
    }
    const catalog = await this.store.readCatalog()
    const provider = catalog.providers.find((p) => p.id === args.providerId)
    const skill = provider?.skills.find((s) => s.skillPath === args.skillPath)
    if (provider === undefined || skill === undefined) {
      return { ok: false, error: `provider "${args.providerId}" no longer offers "${args.name}"` }
    }
    if (skill.name !== args.name) return { ok: false, error: `skill "${args.skillPath}" has a different name` }

    // Remove files that are gone upstream (keeps the caller's own extras).
    const keep = new Set(skill.files.map((f) => f.path))
    await this.pruneDirectory(args.directory, keep)

    const err = await this.copySkillFiles(provider.id, skill, args.directory)
    if (err !== undefined) return { ok: false, error: err }

    const config = this.config()
    const installations: InstalledRecord[] = [
      ...config.installations.filter((r) => r.name !== args.name),
      {
        name: args.name,
        providerId: provider.id,
        providerSpec: provider.spec,
        skillPath: skill.skillPath,
      },
    ]
    await this.writeConfig({ ...config, installations })
    return { ok: true, state: await this.state() }
  }

  /** Delete every file inside `dir` that is not in `keep` (relative names). */
  private async pruneDirectory(dir: string, keep: Set<string>): Promise<void> {
    const walk = async (base: string, rel: string): Promise<void> => {
      let entries
      try {
        entries = await this.opts.fs.readdir(joinPath(base, rel))
      } catch {
        return
      }
      for (const entry of entries) {
        const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
        if (entry.isDirectory()) {
          await walk(base, relPath)
          // Drop the directory when nothing inside is kept.
          const kept = [...keep].some((k) => k === relPath || k.startsWith(relPath + '/'))
          if (!kept) await this.opts.fs.rm(joinPath(base, relPath), { recursive: true, force: true }).catch(() => {})
        } else if (!keep.has(relPath)) {
          await this.opts.fs.rm(joinPath(base, relPath), { force: true }).catch(() => {})
        }
      }
    }
    await walk(dir, '')
  }

  /** Copy every cached file of a skill into the target directory. */
  private async copySkillFiles(providerId: string, skill: CatalogSkill, targetDir: string): Promise<string | undefined> {
    const skillMd = skill.files.some((f) => f.path === 'SKILL.md')
    if (!skillMd) return 'provider skill has no SKILL.md'
    try {
      for (const file of skill.files) {
        if (!isSafeRelativePath(file.path)) return `unsafe cached file path "${file.path}"`
        const content = await this.store.readCachedFile(providerId, skill, file.path)
        const dest = joinPath(targetDir, file.path)
        await this.opts.fs.mkdir(dirnamePath(dest), { recursive: true })
        await this.opts.fs.writeFile(dest, content)
      }
    } catch (error) {
      // Roll back a partially-written install so no half a skill is left behind.
      await this.opts.fs.rm(targetDir, { recursive: true, force: true }).catch(() => {})
      return `failed to install skill: ${error instanceof Error ? error.message : String(error)}`
    }
    return undefined
  }

  /**
   * Remove one skill copy recoverably: move it into the sibling `.trash`
   * directory of its root (skipped by discovery), so an accidental confirm
   * can be undone by hand. Any copy from a known root can be removed — not
   * just plugin-installed ones. When no other copy of the name remains, the
   * installations record and scope entry are dropped.
   */
  async deleteSkill(args: { name: string; directory: string; kind: 'bundle' | 'flat'; path: string }): Promise<MutationResult> {
    if (!isSkillName(args.name)) return { ok: false, error: `invalid skill name "${args.name}"` }
    if (!this.isWithinKnownRoot(args.directory)) return { ok: false, error: `directory is not inside a managed skill root` }
    if (this.isWithinProjectRoot(args.directory)) {
      return { ok: false, error: `skill "${args.name}" lives in a workspace root; workspace skills are deleted by hand in the project` }
    }
    const ownership = await this.readOwnershipAt(args.directory)
    if (ownership !== undefined) {
      return { ok: false, error: `skill "${args.name}" is managed by ${ownership.owner} (${ownership.pluginKey}); uninstall that plugin to remove it` }
    }
    const from = args.kind === 'bundle' ? args.directory : args.path
    const root = dirnamePath(from)
    const trashDir = joinPath(root, TRASH_DIR)
    await this.opts.fs.mkdir(trashDir, { recursive: true })
    await this.opts.fs.rename(from, joinPath(trashDir, `${Date.now()}-${args.name}`))

    // Drop provenance + scope only when no other copy of the name remains.
    const remaining = (await this.listInstalled()).filter((s) => s.name === args.name)
    if (remaining.length > 0) return { ok: true, state: await this.state() }
    const config = this.config()
    await this.writeConfig({
      ...config,
      installations: config.installations.filter((r) => r.name !== args.name),
      scopes: withScope(config.scopes, args.name, undefined),
    })
    return { ok: true, state: await this.state() }
  }

  /** Whether a directory sits inside one of the global (user) skill roots. */
  private isWithinGlobalRoot(directory: string): boolean {
    const d = directory.replace(/\/+$/, '')
    const globalRoots = [
      joinPath(this.opts.dshHome, 'skills'),
      joinPath(this.opts.agentsHome, 'skills'),
    ]
    return globalRoots.some((p) => d === p || d.startsWith(`${p}/`))
  }

  /** Whether a directory sits inside a project convention root
   *  (`<any>/.dsh/skills` or `<any>/.agents/skills`) — the hand-managed
   *  workspace skills this plugin lists but never writes. The global roots
   *  themselves (`<agentsHome>/.agents/skills`-shaped paths included) are
   *  excluded: they are user roots, not project ones. */
  private isWithinProjectRoot(directory: string): boolean {
    if (this.isWithinGlobalRoot(directory)) return false
    const d = directory.replace(/\/+$/, '')
    const segments = d.split('/')
    for (let i = 0; i < segments.length - 1; i++) {
      if ((segments[i] === '.dsh' || segments[i] === '.agents') && segments[i + 1] === 'skills') return true
    }
    return false
  }

  /** Whether a directory sits inside one of the resolvable skill roots. */
  private isWithinKnownRoot(directory: string): boolean {
    return this.isWithinGlobalRoot(directory) || this.isWithinProjectRoot(directory)
  }

  /** Whether any discovered copy of `name` is externally owned. */
  private async isExternalOwnedName(name: string): Promise<boolean> {
    const rows = await this.listInstalled()
    return rows.some((r) => r.name === name && r.ownership !== undefined)
  }

  /** Read the ownership sidecar at a skill directory (undefined when absent). */
  private async readOwnershipAt(directory: string): Promise<SkillOwnership | undefined> {
    try {
      const raw = await this.opts.fs.readFile(joinPath(directory, OWNERSHIP_SIDECAR))
      return parseOwnership(JSON.parse(raw))
    } catch {
      return undefined
    }
  }

  /** Remove every file/dir under `dir` not in `keep` (relative names); the
   *  ownership sidecar is always retained and never pruned. */
  private async pruneExternalDir(dir: string, keep: Set<string>): Promise<void> {
    const walk = async (base: string, rel: string): Promise<void> => {
      let entries
      try {
        entries = await this.opts.fs.readdir(joinPath(base, rel))
      } catch {
        return
      }
      for (const entry of entries) {
        const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
        if (entry.name === OWNERSHIP_SIDECAR) continue
        if (entry.isDirectory()) {
          await walk(base, relPath)
          const kept = [...keep].some((k) => k === relPath || k.startsWith(relPath + '/'))
          if (!kept) await this.opts.fs.rm(joinPath(base, relPath), { recursive: true, force: true }).catch(() => {})
        } else if (!keep.has(relPath)) {
          await this.opts.fs.rm(joinPath(base, relPath), { force: true }).catch(() => {})
        }
      }
    }
    await walk(dir, '')
  }

  /**
   * Install externally-managed skills (the cc-plugins bridge) into the global
   * root, global-only, each with an ownership sidecar. The owning plugin
   * rewrites plugin-level references before handing files off; this service
   * only places them and records enablement. Collisions with an existing
   * same-name skill are rejected so hand-created and skills-plugin skills are
   * never overwritten.
   */
  async installExternalSkills(args: InstallExternalSkillsArgs): Promise<ExternalMutationResult> {
    for (const skill of args.skills) {
      if (!isSkillName(skill.name)) return { ok: false, error: `invalid skill name "${skill.name}"` }
      if (skill.files['SKILL.md'] === undefined) return { ok: false, error: `skill "${skill.name}" has no SKILL.md` }
    }
    // Pre-flight collision check before writing anything. A same-name skill
    // already owned by the same pluginKey is an in-place update (overwrite)
    // rather than a collision; anything else (hand-created, another owner) is
    // rejected so no skill is ever silently overwritten.
    const existing = await this.listInstalled()
    for (const skill of args.skills) {
      const clash = existing.find((r) => r.name === skill.name)
      if (clash !== undefined && !(clash.ownership !== undefined && clash.ownership.pluginKey === args.pluginKey)) {
        const ownedBy = clash.ownership !== undefined ? ` plugin "${clash.ownership.pluginKey}"` : ''
        return { ok: false, error: `skill "${skill.name}" already exists${ownedBy}; uninstall it first` }
      }
    }
    const root = globalSkillsRoot(this.opts.agentsHome)
    const config = this.config()
    for (const skill of args.skills) {
      const targetDir = joinPath(root, skill.name)
      try {
        await this.opts.fs.mkdir(targetDir, { recursive: true })
        // In-place update: drop files no longer shipped upstream (the sidecar
        // is rewritten by this same call and never pruned away).
        await this.pruneExternalDir(targetDir, new Set(Object.keys(skill.files)))
        for (const [rel, content] of Object.entries(skill.files)) {
          if (!isSafeRelativePath(rel)) return { ok: false, error: `unsafe skill file path "${rel}"` }
          const dest = joinPath(targetDir, rel)
          await this.opts.fs.mkdir(dirnamePath(dest), { recursive: true })
          await this.opts.fs.writeFile(dest, content)
        }
        await this.opts.fs.writeFile(
          joinPath(targetDir, OWNERSHIP_SIDECAR),
          ownershipSidecarText({ owner: args.owner, pluginKey: args.pluginKey, marketplaceId: args.marketplaceId, skillName: skill.name }),
        )
      } catch (error) {
        await this.opts.fs.rm(targetDir, { recursive: true, force: true }).catch(() => {})
        return { ok: false, error: `failed to install skill "${skill.name}": ${error instanceof Error ? error.message : String(error)}` }
      }
    }
    // Record enablement per name from the initial workspace whitelist.
    if (args.workspaces !== undefined && args.workspaces.length > 0) {
      const names = [...new Set(args.workspaces.map((p) => basenamePath(p.trim())).filter((p) => p !== ''))]
      let scopes = config.scopes
      for (const skill of args.skills) scopes = withScope(scopes, skill.name, names)
      await this.writeConfig({ ...config, scopes })
    }
    return { ok: true }
  }

  /** Update the enablement scope of one externally-managed skill name. */
  async setExternalSkillScope(args: SetExternalSkillScopeArgs): Promise<ExternalMutationResult> {
    if (!isSkillName(args.name)) return { ok: false, error: `invalid skill name "${args.name}"` }
    let scope: SkillScopeSetting | undefined
    if (args.workspaces !== undefined && args.workspaces !== null) {
      scope = [...new Set(args.workspaces.map((p) => basenamePath(p.trim())).filter((p) => p !== ''))]
    }
    const config = this.config()
    await this.writeConfig({ ...config, scopes: withScope(config.scopes, args.name, scope) })
    return { ok: true }
  }

  /** Remove every skill owned by one plugin install (recoverable trash). */
  async removeExternalSkills(args: RemoveExternalSkillsArgs): Promise<ExternalMutationResult> {
    const rows = await this.listInstalled()
    const targets = rows.filter((r) => r.ownership !== undefined && r.ownership.owner === args.owner && r.ownership.pluginKey === args.pluginKey && (args.skillNames === undefined || args.skillNames.includes(r.name)))
    let removed = 0
    for (const row of targets) {
      const from = row.kind === 'bundle' ? row.directory : row.path
      const root = dirnamePath(from)
      const trashDir = joinPath(root, TRASH_DIR)
      await this.opts.fs.mkdir(trashDir, { recursive: true })
      await this.opts.fs.rename(from, joinPath(trashDir, `${Date.now()}-${row.name}`))
      removed += 1
    }
    // Drop external ownership scope entries left behind.
    const config = this.config()
    let scopes = config.scopes
    for (const row of targets) scopes = withScope(scopes, row.name, undefined)
    if (removed > 0) await this.writeConfig({ ...config, scopes })
    return { ok: true }
  }

  /**
   * Reinstall every recorded skill whose global directory is missing, from
   * the provider caches. This is what makes a shared settings section
   * portable: a teammate (or a new machine) gets the same skill files after
   * the providers sync. Best-effort; returns per-skill notes.
   */
  async reconcileInstalled(): Promise<string[]> {
    const notes: string[] = []
    const config = this.config()
    if (config.installations.length === 0) return notes
    const catalog = await this.store.readCatalog()
    for (const record of config.installations) {
      const targetDir = joinPath(globalSkillsRoot(this.opts.agentsHome), record.name)
      try {
        await this.opts.fs.access(targetDir)
        continue // present
      } catch {
        // missing: reinstall below
      }
      const provider = catalog.providers.find((p) => p.id === record.providerId)
      const skill = provider?.skills.find((s) => s.skillPath === record.skillPath)
      if (provider === undefined || skill === undefined) {
        notes.push(`"${record.name}": provider "${record.providerSpec}" is not synced yet`)
        continue
      }
      const err = await this.copySkillFiles(provider.id, skill, targetDir)
      if (err !== undefined) {
        notes.push(`"${record.name}": ${err}`)
        continue
      }
      notes.push(`"${record.name}" reinstalled from ${record.providerSpec}`)
    }
    return notes
  }
}
