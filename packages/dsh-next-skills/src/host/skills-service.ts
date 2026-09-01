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
import { catalogSkillViews, parseCatalog, parseManifest, providerViews } from '../core/catalog.ts'
import { isShadowSkill, parseSkillFile, stripDisabledFlags } from '../core/frontmatter.ts'
import { isSkillName } from '../core/name.ts'
import { dirnamePath, isSafeRelativePath, joinPath } from '../core/path.ts'
import { providerId, providerSpec } from '../core/provider.ts'
import { globalSkillsRoot, resolveSkillRoots, sortRootsByPrecedence, type SkillRoot } from '../core/scope.ts'
import { mergeInstalled } from '../core/skill-list.ts'
import {
  configForStorage,
  normalizeSkillsConfig,
  parseScopeSetting,
  withScope,
  type InstalledRecord,
  type ProviderRecord,
  type SkillScopeSetting,
  type SkillsConfig,
} from '../core/settings.ts'
import { planMigration, type MigrationSkill, type MigrationWorkspace } from '../core/migration.ts'
import type {
  Catalog,
  CatalogSkill,
  CatalogSkillView,
  FetchLike,
  FsLike,
  InstalledSkill,
  MutationResult,
  ProviderManifest,
  ProviderView,
  SkillDetail,
  SkillScope,
  SkillSourceBucket,
  SkillsState,
} from '../core/types.ts'
import { ProviderStore } from './provider-store.ts'

export const MANIFEST_FILE = '.dsh-next-provider.json'
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
  customSkillDirs?: string[]
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
  /** True for plugin-generated workspace shadows (legacy artifacts). */
  shadow: boolean
  path: string
  directory: string
  /** Manifest facts when the skill was provider-installed. */
  manifest?: ProviderManifest
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
      shadow: kind === 'bundle' && isShadowSkill(content),
      path: skillPath,
      directory,
    })
  }
  return out
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

  private rootsFor(scope: 'global' | 'workspace', workspacePath?: string): SkillRoot[] {
    const all = resolveSkillRoots({
      projectRoot: scope === 'workspace' ? workspacePath : undefined,
      dshHome: this.opts.dshHome,
      agentsHome: this.opts.agentsHome,
      customSkillDirs: this.opts.customSkillDirs,
    })
    return sortRootsByPrecedence(all.filter((r) => r.scope === scope))
  }

  private async readManifest(directory: string): Promise<ProviderManifest | undefined> {
    let raw: string
    try {
      raw = await this.opts.fs.readFile(joinPath(directory, MANIFEST_FILE))
    } catch {
      return undefined
    }
    try {
      return parseManifest(JSON.parse(raw))
    } catch {
      return undefined
    }
  }

  /**
   * Enumerate skills across the global roots and (optionally) the given
   * workspaces' project roots, merged by precedence, enriched with manifest
   * (managed/update) facts and the config scope for each name.
   */
  async listInstalled(workspacePaths?: readonly string[]): Promise<InstalledSkill[]> {
    const paths = [...new Set((workspacePaths ?? []).filter((p) => typeof p === 'string' && p !== ''))]
    const roots = sortRootsByPrecedence([
      ...resolveSkillRoots({
        dshHome: this.opts.dshHome,
        agentsHome: this.opts.agentsHome,
        customSkillDirs: this.opts.customSkillDirs,
      }),
      ...paths.flatMap((workspacePath) =>
        resolveSkillRoots({
          projectRoot: workspacePath,
          dshHome: this.opts.dshHome,
          agentsHome: this.opts.agentsHome,
          customSkillDirs: this.opts.customSkillDirs,
        }).filter((r) => r.scope === 'workspace'),
      ),
    ])
    const lists = await Promise.all(roots.map((root) => discoverRoot(this.opts.fs, root)))
    const discovered = mergeInstalled(...lists)
    const config = this.config()
    const catalog = await this.store.readCatalog()
    const byProviderSkill = new Map<string, CatalogSkill>()
    for (const provider of catalog.providers) {
      for (const skill of provider.skills) byProviderSkill.set(`${provider.id}\n${skill.skillPath}`, skill)
    }
    return Promise.all(discovered.map(async (skill): Promise<InstalledSkill> => {
      const record = config.installed.find((r) => r.name === skill.name)
      const manifest = skill.kind === 'bundle' ? await this.readManifest(skill.directory) : undefined
      const managed = manifest !== undefined || record !== undefined
      let updateAvailable: boolean | undefined
      const upstreamKey = manifest !== undefined
        ? `${manifest.providerId}\n${manifest.skillPath}`
        : record !== undefined ? `${record.providerId}\n${record.skillPath}` : undefined
      const upstream = upstreamKey !== undefined ? byProviderSkill.get(upstreamKey) : undefined
      if (managed && upstream !== undefined) {
        const currentVersion = manifest?.version ?? record?.version ?? ''
        updateAvailable = upstream.version !== currentVersion
      }
      const providerSpecLabel = manifest?.providerSpec ?? record?.providerSpec
      return {
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
        scope: skill.scope,
        source: skill.source,
        kind: skill.kind,
        path: skill.path,
        directory: skill.directory,
        fileModelInvocable: skill.fileModelInvocable,
        fileUserInvocable: skill.fileUserInvocable,
        managed,
        ...(providerSpecLabel !== undefined ? { provider: providerSpecLabel } : {}),
        ...(updateAvailable !== undefined ? { updateAvailable } : {}),
        ...(config.scopes[skill.name] !== undefined ? { configScope: parseScopeSetting(config.scopes[skill.name]) } : {}),
      }
    }))
  }

  /** The full browser-facing state envelope. */
  async state(workspacePaths?: readonly string[]): Promise<SkillsState> {
    const [installed, catalog] = await Promise.all([this.listInstalled(workspacePaths), this.store.readCatalog()])
    return {
      config: this.config(),
      installed,
      providers: this.providerRows(catalog),
      catalog: catalogSkillViews(catalog),
    }
  }

  /** Provider status rows: synced catalog rows plus configured-but-unsynced ones. */
  private providerRows(catalog: Catalog): ProviderView[] {
    const known = new Set(catalog.providers.map((p) => p.id))
    const unsynced = this.config().providers
      .filter((p) => !known.has(p.id))
      .map<ProviderView>((p) => ({ id: p.id, spec: p.spec, skillCount: 0, lastRefresh: '', error: 'never synced' }))
    return [...providerViews(catalog), ...unsynced].sort((a, b) => a.spec.localeCompare(b.spec))
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

  /** Full SKILL.md content for a discovered skill (detail modal). */
  async getInstalledSkillDetail(args: { name: string; workspacePaths?: readonly string[] }): Promise<SkillDetail | undefined> {
    const rows = await this.listInstalled(args.workspacePaths)
    const row = rows.find((r) => r.name === args.name)
    if (row === undefined) return undefined
    let content: string
    try {
      content = await this.opts.fs.readFile(row.path)
    } catch {
      return undefined
    }
    return skillDetailFromContent(content)
  }

  /** Find the winning skill by name across the given roots (first = lowest rank). */
  private async findSkill(roots: SkillRoot[], name: string): Promise<DiscoveredSkill | undefined> {
    for (const root of roots) {
      const skills = await discoverRoot(this.opts.fs, root)
      const hit = skills.find((s) => s.name === name)
      if (hit) return hit
    }
    return undefined
  }

  /**
   * Set the enablement scope for one skill name. Pure config: no skill file
   * is touched. `undefined` scope and an explicit global both clear the
   * stored entry (absent = the everywhere default).
   */
  async setScope(args: { name: string; scope?: SkillScopeSetting }): Promise<MutationResult> {
    if (!isSkillName(args.name)) return { ok: false, error: `invalid skill name "${args.name}"` }
    let scope = args.scope
    if (scope !== undefined && scope.kind === 'global') scope = undefined
    if (scope !== undefined && scope.kind === 'workspaces') {
      const paths = [...new Set(scope.workspacePaths.map((p) => p.trim()).filter((p) => p !== ''))]
      for (const p of paths) {
        if (!p.startsWith('/')) return { ok: false, error: `workspace path "${p}" is not absolute` }
      }
      scope = { kind: 'workspaces', workspacePaths: paths }
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
      await this.store.markProviderError(id, error instanceof Error ? error.message : String(error), canonical).catch(() => {})
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

  /** Re-sync one provider; a failure is recorded on its catalog row. */
  async refreshProvider(id: string): Promise<MutationResult> {
    const provider = this.config().providers.find((p) => p.id === id)
    if (provider === undefined) return { ok: false, error: `provider "${id}" is not configured` }
    try {
      await this.store.syncProvider(provider.spec)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.markProviderError(id, message, provider.spec).catch(() => {})
      return { ok: false, error: message }
    }
    return { ok: true, state: await this.state() }
  }

  /** Re-sync every configured provider; failures are collected per provider. */
  async refreshProviders(): Promise<MutationResult> {
    const failures: string[] = []
    for (const provider of this.config().providers) {
      try {
        await this.store.syncProvider(provider.spec)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.store.markProviderError(provider.id, message, provider.spec).catch(() => {})
        failures.push(`${provider.spec}: ${message}`)
      }
    }
    if (failures.length > 0) return { ok: false, error: `refresh failed for ${failures.length} provider(s): ${failures.join('; ')}` }
    return { ok: true, state: await this.state() }
  }

  /**
   * Install a catalog skill from the cache into the GLOBAL root and record it
   * in settings (with an optional initial scope). Skills never install into
   * projects.
   */
  async installSkill(args: {
    providerId: string
    skillPath: string
    scope?: SkillScopeSetting
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
    const manifest = await this.writeManifest(targetDir, provider, skill)

    const config = this.config()
    const installed: InstalledRecord[] = [
      ...config.installed.filter((r) => r.name !== skill.name),
      {
        name: skill.name,
        providerId: manifest.providerId,
        providerSpec: manifest.providerSpec,
        skillPath: manifest.skillPath,
        version: manifest.version,
        installedAt: manifest.installedAt,
      },
    ]
    const scopes = args.scope !== undefined
      ? withScope(config.scopes, skill.name, args.scope)
      : config.scopes
    await this.writeConfig({ ...config, installed, scopes })
    return { ok: true, state: await this.state() }
  }

  /**
   * Update one managed skill to the cached version: overwrite the files,
   * drop files that no longer exist upstream, and refresh the manifest and
   * settings record.
   */
  async updateSkill(args: { name: string }): Promise<MutationResult> {
    if (!isSkillName(args.name)) return { ok: false, error: `invalid skill name "${args.name}"` }
    const existing = await this.findSkill(this.rootsFor('global'), args.name)
    if (!existing) return { ok: false, error: `skill "${args.name}" not found` }
    const manifest = await this.readManifest(existing.directory)
    if (manifest === undefined) return { ok: false, error: `skill "${args.name}" was not installed from a provider` }
    const catalog = await this.store.readCatalog()
    const provider = catalog.providers.find((p) => p.id === manifest.providerId)
    const skill = provider?.skills.find((s) => s.skillPath === manifest.skillPath)
    if (provider === undefined || skill === undefined) {
      return { ok: false, error: `provider "${manifest.providerSpec}" no longer offers "${args.name}"` }
    }

    // Remove files that are gone upstream (never the manifest itself).
    const keep = new Set(skill.files.map((f) => f.path))
    await this.pruneDirectory(existing.directory, keep)

    const err = await this.copySkillFiles(provider.id, skill, existing.directory)
    if (err !== undefined) return { ok: false, error: err }
    const fresh = await this.writeManifest(existing.directory, provider, skill)

    const config = this.config()
    const installed: InstalledRecord[] = [
      ...config.installed.filter((r) => r.name !== args.name),
      {
        name: args.name,
        providerId: fresh.providerId,
        providerSpec: fresh.providerSpec,
        skillPath: fresh.skillPath,
        version: fresh.version,
        installedAt: fresh.installedAt,
      },
    ]
    await this.writeConfig({ ...config, installed })
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
        } else if (!keep.has(relPath) && relPath !== MANIFEST_FILE) {
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

  private async writeManifest(targetDir: string, provider: { id: string; spec: string }, skill: CatalogSkill): Promise<ProviderManifest> {
    const manifest: ProviderManifest = {
      providerId: provider.id,
      providerSpec: provider.spec,
      skillPath: skill.skillPath,
      version: skill.version,
      installedAt: new Date().toISOString(),
    }
    await this.opts.fs.writeFile(joinPath(targetDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2))
    return manifest
  }

  /**
   * Remove a managed skill recoverably: move it into the sibling `.trash`
   * directory of its root (skipped by discovery), so an accidental confirm
   * can be undone by hand. Only plugin-managed skills (manifest present, or
   * recorded in settings) can be removed; hand-created skills are never
   * touched. The settings record and scope entry are dropped.
   */
  async remove(args: { name: string }): Promise<MutationResult> {
    if (!isSkillName(args.name)) return { ok: false, error: `invalid skill name "${args.name}"` }
    const existing = await this.findSkill(this.rootsFor('global'), args.name)
    if (!existing) return { ok: false, error: `skill "${args.name}" not found` }
    const manifest = existing.kind === 'bundle' ? await this.readManifest(existing.directory) : undefined
    const recorded = this.config().installed.some((r) => r.name === args.name)
    if (manifest === undefined && !recorded) {
      return { ok: false, error: `skill "${args.name}" was not installed by the plugin` }
    }
    if (existing.shadow) {
      await this.opts.fs.rm(existing.directory, { recursive: true, force: true })
    } else {
      const from = existing.kind === 'bundle' ? existing.directory : existing.path
      const root = dirnamePath(from)
      const trashDir = joinPath(root, TRASH_DIR)
      await this.opts.fs.mkdir(trashDir, { recursive: true })
      await this.opts.fs.rename(from, joinPath(trashDir, `${Date.now()}-${existing.name}`))
    }
    const config = this.config()
    await this.writeConfig({
      ...config,
      installed: config.installed.filter((r) => r.name !== args.name),
      scopes: withScope(config.scopes, args.name, undefined),
    })
    return { ok: true, state: await this.state() }
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
    if (config.installed.length === 0) return notes
    const catalog = await this.store.readCatalog()
    for (const record of config.installed) {
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
      await this.writeManifest(targetDir, provider, skill)
      notes.push(`"${record.name}" reinstalled from ${record.providerSpec}`)
    }
    return notes
  }

  /**
   * One-time migration from the legacy state model (providers.json +
   * frontmatter toggles + workspace shadows + workspace installs) into the
   * settings-backed configuration. Runs only when the config section is
   * empty; a previously migrated or hand-seeded config is never touched.
   *
   * `workspacePaths` are the registered workspaces (best-effort read by the
   * entry point); their project roots are scanned for managed installs and
   * legacy shadows. Managed workspace copies move into the global root.
   */
  async migrateLegacy(workspacePaths: readonly string[]): Promise<{ migrated: boolean; notes: string[] }> {
    const config = this.config()
    if (config.providers.length > 0 || config.installed.length > 0 || Object.keys(config.scopes).length > 0) {
      return { migrated: false, notes: [] }
    }
    const legacyProviders = await this.store.readLegacyProviders()

    const toMigrationSkill = async (root: SkillRoot): Promise<MigrationSkill[]> => {
      const skills = await discoverRoot(this.opts.fs, root)
      return Promise.all(skills.map(async (skill): Promise<MigrationSkill> => ({
        name: skill.name,
        path: skill.path,
        directory: skill.kind === 'bundle' ? skill.directory : skill.path,
        kind: skill.kind,
        fileModelInvocable: skill.fileModelInvocable,
        fileUserInvocable: skill.fileUserInvocable,
        ...(skill.shadow ? { shadow: true } : {}),
        ...(skill.kind === 'bundle' ? { manifest: await this.readManifest(skill.directory) } : {}),
      })))
    }

    const globalRoots = this.rootsFor('global')
    const globalLists = await Promise.all(globalRoots.map((root) => toMigrationSkill(root)))
    const workspaces: MigrationWorkspace[] = []
    for (const workspacePath of workspacePaths) {
      const roots = this.rootsFor('workspace', workspacePath)
      const lists = await Promise.all(roots.map((root) => toMigrationSkill(root)))
      workspaces.push({ workspacePath, skills: mergeInstalled(...lists) })
    }

    const plan = planMigration({
      agentsHome: this.opts.agentsHome,
      legacyProviders: legacyProviders.map((p) => ({ id: p.id, spec: p.spec, addedAt: p.addedAt })),
      globalSkills: mergeInstalled(...globalLists),
      workspaces,
      existing: config,
    })

    // Apply file moves: managed workspace copies into the global root.
    for (const move of plan.moveToGlobal) {
      try {
        await this.opts.fs.mkdir(dirnamePath(move.to), { recursive: true })
        await this.opts.fs.rename(move.from, move.to)
        plan.notes.push(`moved "${move.name}" into the global root`)
      } catch (error) {
        plan.notes.push(`could not move "${move.name}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // Apply deletions: legacy shadow directories.
    for (const dir of plan.deleteDirs) {
      try {
        await this.opts.fs.rm(dir, { recursive: true, force: true })
        plan.notes.push(`removed legacy shadow ${dir}`)
      } catch (error) {
        plan.notes.push(`could not remove shadow ${dir}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // Apply cleanups: strip legacy toggle lines from disabled skill files so
    // a later config re-enable actually shows the skill again.
    for (const path of plan.stripFlags) {
      try {
        const content = await this.opts.fs.readFile(path)
        await this.opts.fs.writeFile(path, stripDisabledFlags(content))
      } catch (error) {
        plan.notes.push(`could not clean ${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await this.writeConfig(plan.config)
    // Reconcile: freshly moved/recorded skills whose global copy is missing
    // (for example a recorded skill whose move failed) reinstall later via
    // reconcileInstalled(); nothing else to do here.
    return { migrated: true, notes: plan.notes }
  }
}

/**
 * Best-effort read of the workspace registry (`$DSH_HOME/storages/
 * workspace.json`): returns the registered workspace paths, canonical as
 * stored. A missing or unreadable registry yields an empty list.
 */
export async function readWorkspaceRegistryPaths(fs: FsLike, dshHome: string): Promise<string[]> {
  let raw: string
  try {
    raw = await fs.readFile(joinPath(dshHome, 'storages/workspace.json'))
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const tables = (parsed && typeof parsed === 'object' ? (parsed as { tables?: unknown }).tables : undefined)
  const workspaces = (tables && typeof tables === 'object' ? (tables as { workspaces?: unknown }).workspaces : undefined)
  if (!workspaces || typeof workspaces !== 'object') return []
  const out: string[] = []
  for (const row of Object.values(workspaces as Record<string, unknown>)) {
    const path = (row && typeof row === 'object' ? (row as { path?: unknown }).path : undefined)
    if (typeof path === 'string' && path !== '') out.push(path)
  }
  return out
}
