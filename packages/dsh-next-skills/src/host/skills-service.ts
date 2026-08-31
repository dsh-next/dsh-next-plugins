/**
 * Stateful host implementation of the skills manager: enumerates installed
 * skills from the DSH filesystem roots, toggles enable/disable through the
 * native `disable-model-invocation` / `user-invocable` frontmatter flags,
 * installs skills from the provider cache (global or into a workspace),
 * updates them when the provider catalog moves ahead, and removes them.
 *
 * Configured providers are persisted by the ProviderStore (`providers.json`
 * inside the plugin cache root). All filesystem and network access flows
 * through injected `fs`/`fetch` faces so the service is fully testable with
 * in-memory doubles.
 */
import { lastRefreshEpoch, marketplaceView, parseManifest } from '../core/catalog.ts'
import { buildShadowSkill, isShadowSkill, parseSkillFile, toggleInvocation } from '../core/frontmatter.ts'
import { isSkillName } from '../core/name.ts'
import { dirnamePath, isSafeRelativePath, joinPath } from '../core/path.ts'
import { providerId, providerSpec } from '../core/provider.ts'
import { globalSkillsRoot, resolveSkillRoots, sortRootsByPrecedence, workspaceSkillsRoot, type SkillRoot } from '../core/scope.ts'
import { mergeInstalled } from '../core/skill-list.ts'
import { DEFAULT_PROVIDER_SPECS } from '../core/defaults.ts'
import type {
  Catalog,
  CatalogSkill,
  FetchLike,
  FsLike,
  InstalledMap,
  InstalledSkill,
  MarketplaceView,
  MutationResult,
  ProviderCatalog,
  ProviderManifest,
  SkillDetail,
  SkillsState,
} from '../core/types.ts'
import { ProviderStore } from './provider-store.ts'

export const MANIFEST_FILE = '.dsh-next-provider.json'
/** Recoverable-delete directory inside every skill root (skipped by discovery). */
export const TRASH_DIR = '.trash'

export interface SkillsServiceOptions {
  fs: FsLike
  fetch: FetchLike
  dshHome: string
  agentsHome: string
  customSkillDirs?: string[]
}

/** Scan one root into installed skills (invalid files are skipped silently). */
export async function discoverRoot(fs: FsLike, root: SkillRoot): Promise<InstalledSkill[]> {
  let entries
  try {
    entries = await fs.readdir(root.path)
  } catch {
    return []
  }
  entries = [...entries].sort((a, b) => a.name.localeCompare(b.name))
  const out: InstalledSkill[] = []
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
      enabled: parsed.modelInvocable,
      userInvocable: parsed.userInvocable,
      scope: root.scope,
      source: root.source,
      kind,
      ...(kind === 'bundle' && isShadowSkill(content) ? { shadow: true } : {}),
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

  private rootsFor(scope: 'global' | 'workspace', workspacePath?: string): SkillRoot[] {
    const all = resolveSkillRoots({
      projectRoot: scope === 'workspace' ? workspacePath : undefined,
      dshHome: this.opts.dshHome,
      agentsHome: this.opts.agentsHome,
      customSkillDirs: this.opts.customSkillDirs,
    })
    return sortRootsByPrecedence(all.filter((r) => r.scope === scope))
  }

  /** Enumerate installed skills, merging global + optional workspace roots. */
  async listInstalled(workspacePath?: string): Promise<InstalledSkill[]> {
    const roots = sortRootsByPrecedence(resolveSkillRoots({
      projectRoot: workspacePath,
      dshHome: this.opts.dshHome,
      agentsHome: this.opts.agentsHome,
      customSkillDirs: this.opts.customSkillDirs,
    }))
    const lists = await Promise.all(roots.map((root) => discoverRoot(this.opts.fs, root)))
    const installed = mergeInstalled(...lists)
    // Enrich provider-installed skills with their manifest + update flag.
    const catalog = await this.store.readCatalog()
    const byProviderSkill = new Map<string, CatalogSkill>()
    for (const provider of catalog.providers) {
      for (const skill of provider.skills) byProviderSkill.set(`${provider.id}\n${skill.skillPath}`, skill)
    }
    for (const skill of installed) {
      if (skill.kind !== 'bundle') continue
      const manifest = await this.readManifest(skill.directory)
      if (manifest === undefined) continue
      skill.provider = manifest.providerSpec
      const upstream = byProviderSkill.get(`${manifest.providerId}\n${manifest.skillPath}`)
      skill.updateAvailable = upstream !== undefined && upstream.version !== manifest.version
    }
    return installed
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

  async state(workspacePath?: string): Promise<SkillsState> {
    return { installed: await this.listInstalled(workspacePath) }
  }

  /**
   * Per-scope installed lists: the global root plus each requested workspace.
   * The workspace lists cover ONLY that workspace's own roots — a global copy
   * does not leak through — so the Marketplace can offer the same skill per
   * workspace independently.
   */
  async installedMap(workspacePaths: readonly string[]): Promise<InstalledMap> {
    const workspaces = [...new Set(workspacePaths.filter((p) => typeof p === 'string' && p !== ''))]
    const [global, ...lists] = await Promise.all([
      this.listInstalled(undefined),
      ...workspaces.map(async (workspacePath) => {
        const roots = this.rootsFor('workspace', workspacePath)
        const perRoot = await Promise.all(roots.map((root) => discoverRoot(this.opts.fs, root)))
        return mergeInstalled(...perRoot)
      }),
    ])
    return {
      global,
      workspaces: workspaces.map((workspacePath, i) => ({ workspacePath, installed: lists[i] })),
    }
  }

  /** The Marketplace payload: cached provider skills + provider status rows. */
  async marketplace(): Promise<MarketplaceView> {
    const catalog = await this.store.readCatalog()
    // Providers configured but never successfully synced still deserve a row
    // (otherwise they could not be refreshed or removed from the UI).
    const known = new Set(catalog.providers.map((p) => p.id))
    const unsynced = (await this.store.listProviders())
      .filter((p) => !known.has(p.id))
      .map<ProviderCatalog>((p) => ({ id: p.id, spec: p.spec, branch: '', lastRefresh: '', error: 'never synced', skills: [] }))
    const merged: Catalog = { providers: [...catalog.providers, ...unsynced].sort((a, b) => a.spec.localeCompare(b.spec)) }
    return marketplaceView(merged)
  }

  /**
   * Seed the default provider list on first launch: when no provider list has
   * been persisted yet, write the defaults (they sync right after). Returns
   * true when seeding happened. Removals persist — this never runs again
   * once a providers.json exists.
   */
  async ensureDefaultProviders(): Promise<boolean> {
    if (await this.store.hasProvidersFile()) return false
    const addedAt = new Date().toISOString()
    const providers = DEFAULT_PROVIDER_SPECS
      .map((spec) => ({ spec, id: providerId(spec) }))
      .filter((p): p is { spec: string; id: string } => p.id !== undefined)
      .map((p) => ({ id: p.id, spec: p.spec, addedAt }))
    await this.store.saveProviders(providers)
    return true
  }

  /**
   * Full SKILL.md content for a catalog skill (Search tab detail modal):
   * name, description, invocation flags, and the markdown body.
   */
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

  /** Full SKILL.md content for an installed skill (Installed tab detail modal). */
  async getInstalledSkillDetail(args: {
    name: string
    scope: 'global' | 'workspace'
    workspacePath?: string
  }): Promise<SkillDetail | undefined> {
    if (args.scope === 'workspace' && args.workspacePath === undefined) return undefined
    const roots = this.rootsFor(args.scope, args.workspacePath)
    const existing = await this.findSkill(roots, args.name)
    if (!existing) return undefined
    let content: string
    try {
      content = await this.opts.fs.readFile(existing.path)
    } catch {
      return undefined
    }
    return skillDetailFromContent(content)
  }

  /** Find the winning skill by name across the given roots (first = lowest rank). */
  private async findSkill(roots: SkillRoot[], name: string): Promise<InstalledSkill | undefined> {
    for (const root of roots) {
      const skills = await discoverRoot(this.opts.fs, root)
      const hit = skills.find((s) => s.name === name)
      if (hit) return hit
    }
    return undefined
  }

  async setEnabled(args: {
    name: string
    scope: 'global' | 'workspace'
    enabled: boolean
    workspacePath?: string
    description?: string
  }): Promise<MutationResult> {
    if (!isSkillName(args.name)) return { ok: false, error: `invalid skill name "${args.name}"` }
    if (args.scope === 'workspace' && args.workspacePath === undefined) {
      return { ok: false, error: 'workspace scope requires a workspacePath' }
    }
    const roots = this.rootsFor(args.scope, args.workspacePath)
    const existing = await this.findSkill(roots, args.name)

    if (existing) {
      const content = await this.opts.fs.readFile(existing.path)
      if (args.enabled && isShadowSkill(content)) {
        // Re-enabling removes the workspace shadow so the global skill re-applies.
        await this.opts.fs.rm(existing.directory, { recursive: true, force: true })
      } else {
        await this.opts.fs.writeFile(existing.path, toggleInvocation(content, args.enabled))
      }
    } else if (!args.enabled && args.scope === 'workspace') {
      // Disabling a global-only skill in one workspace: drop a shadow override.
      const dir = joinPath(workspaceSkillsRoot(args.workspacePath!), args.name)
      await this.opts.fs.mkdir(dir, { recursive: true })
      const description = args.description ?? args.name
      await this.opts.fs.writeFile(joinPath(dir, 'SKILL.md'), buildShadowSkill(args.name, description))
    } else if (!existing) {
      return { ok: false, error: `skill "${args.name}" not found` }
    }
    return { ok: true, state: await this.state(args.workspacePath) }
  }

  /**
   * Add a GitHub provider: validate the spec, persist it in the config, and
   * sync its skills into the cache (downloading every skill file once).
   */
  async addProvider(spec: string): Promise<MutationResult> {
    const canonical = providerSpec(spec)
    const id = providerId(spec)
    if (canonical === undefined || id === undefined) {
      return { ok: false, error: `invalid provider spec "${spec}" (expected owner/repo or a GitHub URL)` }
    }
    let providers = await this.store.listProviders()
    if (!providers.some((p) => p.id === id)) {
      providers = [...providers, { id, spec: canonical, addedAt: new Date().toISOString() }]
      await this.store.saveProviders(providers)
    }
    try {
      await this.store.syncProvider(canonical)
    } catch (error) {
      await this.store.markProviderError(id, error instanceof Error ? error.message : String(error)).catch(() => {})
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    return { ok: true, state: await this.state() }
  }

  async removeProvider(id: string): Promise<MutationResult> {
    const providers = await this.store.listProviders()
    if (!providers.some((p) => p.id === id)) {
      return { ok: false, error: `provider "${id}" is not configured` }
    }
    await this.store.saveProviders(providers.filter((p) => p.id !== id))
    await this.store.removeProvider(id)
    return { ok: true, state: await this.state() }
  }

  /** Re-sync one provider; a failure is recorded on its catalog row. */
  async refreshProvider(id: string): Promise<MutationResult> {
    const provider = (await this.store.listProviders()).find((p) => p.id === id)
    if (provider === undefined) return { ok: false, error: `provider "${id}" is not configured` }
    try {
      await this.store.syncProvider(provider.spec)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.markProviderError(id, message).catch(() => {})
      return { ok: false, error: message }
    }
    return { ok: true, state: await this.state() }
  }

  /** Re-sync every configured provider; failures are collected per provider. */
  async refreshProviders(): Promise<MutationResult> {
    const failures: string[] = []
    for (const provider of await this.store.listProviders()) {
      try {
        await this.store.syncProvider(provider.spec)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.store.markProviderError(provider.id, message).catch(() => {})
        failures.push(`${provider.spec}: ${message}`)
      }
    }
    if (failures.length > 0) return { ok: false, error: `refresh failed for ${failures.length} provider(s): ${failures.join('; ')}` }
    return { ok: true, state: await this.state() }
  }

  /** Install a catalog skill from the cache into the chosen scope. */
  async installSkill(args: {
    providerId: string
    skillPath: string
    scope: 'global' | 'workspace'
    workspacePath?: string
  }): Promise<MutationResult> {
    if (args.scope === 'workspace' && args.workspacePath === undefined) {
      return { ok: false, error: 'workspace scope requires a workspacePath' }
    }
    const catalog = await this.store.readCatalog()
    const provider = catalog.providers.find((p) => p.id === args.providerId)
    if (provider === undefined) return { ok: false, error: `provider "${args.providerId}" is not configured` }
    const skill = provider.skills.find((s) => s.skillPath === args.skillPath)
    if (skill === undefined) return { ok: false, error: `skill "${args.skillPath}" is not in the ${provider.spec} catalog` }
    if (!isSkillName(skill.name)) return { ok: false, error: `invalid skill name "${skill.name}"` }

    const root = args.scope === 'workspace'
      ? workspaceSkillsRoot(args.workspacePath!)
      : globalSkillsRoot(this.opts.agentsHome)
    const targetDir = joinPath(root, skill.name)
    try {
      await this.opts.fs.access(targetDir)
      return { ok: false, error: `skill "${skill.name}" is already installed` }
    } catch {
      // not installed yet
    }
    const err = await this.copySkillFiles(provider.id, skill, targetDir)
    if (err !== undefined) return { ok: false, error: err }
    await this.writeManifest(targetDir, provider, skill)
    return { ok: true, state: await this.state(args.workspacePath) }
  }

  /**
   * Update one provider-installed skill to the cached version: overwrite the
   * files, drop files that no longer exist upstream, keep the manifest
   * current, and re-apply the local enable/disable state.
   */
  async updateSkill(args: {
    name: string
    scope: 'global' | 'workspace'
    workspacePath?: string
  }): Promise<MutationResult> {
    if (args.scope === 'workspace' && args.workspacePath === undefined) {
      return { ok: false, error: 'workspace scope requires a workspacePath' }
    }
    const roots = this.rootsFor(args.scope, args.workspacePath)
    const existing = await this.findSkill(roots, args.name)
    if (!existing) return { ok: false, error: `skill "${args.name}" not found` }
    const error = await this.updateCopy(existing, args.name)
    if (error !== undefined) return { ok: false, error }
    return { ok: true, state: await this.state(args.workspacePath) }
  }

  /**
   * Overwrite one installed copy with its provider's cached version. Returns
   * an error message on failure, undefined on success. Keeps the local
   * enable/disable state so a disabled skill stays disabled.
   */
  private async updateCopy(existing: InstalledSkill, name: string): Promise<string | undefined> {
    if (existing.kind !== 'bundle') return `skill "${name}" was not installed from a provider`
    const manifest = await this.readManifest(existing.directory)
    if (manifest === undefined) return `skill "${name}" was not installed from a provider`
    const catalog = await this.store.readCatalog()
    const provider = catalog.providers.find((p) => p.id === manifest.providerId)
    const skill = provider?.skills.find((s) => s.skillPath === manifest.skillPath)
    if (provider === undefined || skill === undefined) {
      return `provider "${manifest.providerSpec}" no longer offers "${name}"`
    }

    // Remember the local invocation state so it survives the overwrite.
    const wasEnabled = existing.enabled

    // Remove files that are gone upstream (never the manifest itself).
    const keep = new Set(skill.files.map((f) => f.path))
    await this.pruneDirectory(existing.directory, keep)

    const err = await this.copySkillFiles(provider.id, skill, existing.directory)
    if (err !== undefined) return err
    await this.writeManifest(existing.directory, provider, skill)

    // Re-apply the invocation policy over the freshly written SKILL.md.
    if (!wasEnabled) {
      const content = await this.opts.fs.readFile(existing.path)
      await this.opts.fs.writeFile(existing.path, toggleInvocation(content, false))
    }
    return undefined
  }

  /**
   * Update every installed copy of a skill at once: the global copy plus one
   * copy in each requested workspace. Shadows and copies that were not
   * installed from a provider are skipped; per-copy failures are collected so
   * one broken target does not block the rest. Success reports a `warning`
   * when any copy was skipped or failed.
   */
  async updateAllCopies(args: {
    name: string
    workspacePaths?: readonly string[]
  }): Promise<MutationResult> {
    if (!isSkillName(args.name)) return { ok: false, error: `invalid skill name "${args.name}"` }
    const paths = [...new Set((args.workspacePaths ?? []).filter((p): p is string => typeof p === 'string' && p !== ''))]
    const targets: Array<{ label: string; scope: 'global' | 'workspace'; workspacePath?: string }> = [
      { label: 'global', scope: 'global' },
      ...paths.map((workspacePath) => ({ label: `workspace ${workspacePath}`, scope: 'workspace' as const, workspacePath })),
    ]
    const updated: string[] = []
    const skipped: string[] = []
    const failed: string[] = []
    let found = false
    for (const target of targets) {
      const roots = this.rootsFor(target.scope, target.workspacePath)
      const existing = await this.findSkill(roots, args.name)
      if (!existing) continue
      found = true
      if (existing.shadow === true) {
        skipped.push(`${target.label} (shadow)`)
        continue
      }
      const manifest = await this.readManifest(existing.directory)
      if (manifest === undefined) {
        skipped.push(`${target.label} (not provider-installed)`)
        continue
      }
      const error = await this.updateCopy(existing, args.name)
      if (error === undefined) updated.push(target.label)
      else failed.push(`${target.label}: ${error}`)
    }
    if (!found) return { ok: false, error: `skill "${args.name}" not found` }
    if (updated.length === 0 && failed.length > 0) {
      return { ok: false, error: `failed to update "${args.name}": ${failed.join('; ')}` }
    }
    const notes = [
      ...(failed.length > 0 ? [`failed: ${failed.join('; ')}`] : []),
      ...(skipped.length > 0 ? [`skipped ${skipped.join(', ')}`] : []),
    ]
    const copies = `cop${updated.length === 1 ? 'y' : 'ies'}`
    return {
      ok: true,
      state: await this.state(),
      ...(notes.length > 0 ? { warning: `updated ${updated.length} ${copies} of "${args.name}"; ${notes.join('; ')}` } : {}),
    }
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

  private async writeManifest(targetDir: string, provider: { id: string; spec: string }, skill: CatalogSkill): Promise<void> {
    const manifest: ProviderManifest = {
      providerId: provider.id,
      providerSpec: provider.spec,
      skillPath: skill.skillPath,
      version: skill.version,
      installedAt: new Date().toISOString(),
    }
    await this.opts.fs.writeFile(joinPath(targetDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2))
  }

  /**
   * Remove a skill recoverably: move it into the sibling `.trash` directory
   * of its root (skipped by discovery), so an accidental confirm can be
   * undone by hand. Workspace shadow skills are plugin-generated artifacts
   * and are deleted outright instead.
   */
  async remove(args: {
    name: string
    scope: 'global' | 'workspace'
    workspacePath?: string
  }): Promise<MutationResult> {
    if (args.scope === 'workspace' && args.workspacePath === undefined) {
      return { ok: false, error: 'workspace scope requires a workspacePath' }
    }
    const roots = this.rootsFor(args.scope, args.workspacePath)
    const existing = await this.findSkill(roots, args.name)
    if (!existing) return { ok: false, error: `skill "${args.name}" not found` }
    const content = await this.opts.fs.readFile(existing.path).catch(() => '')
    const isShadow = existing.kind === 'bundle' && isShadowSkill(content)
    if (isShadow) {
      await this.opts.fs.rm(existing.directory, { recursive: true, force: true })
      return { ok: true, state: await this.state(args.workspacePath) }
    }
    const from = existing.kind === 'bundle' ? existing.directory : existing.path
    const root = dirnamePath(existing.kind === 'bundle' ? existing.directory : existing.path)
    const trashDir = joinPath(root, TRASH_DIR)
    await this.opts.fs.mkdir(trashDir, { recursive: true })
    await this.opts.fs.rename(from, joinPath(trashDir, `${Date.now()}-${existing.name}`))
    return { ok: true, state: await this.state(args.workspacePath) }
  }
}
