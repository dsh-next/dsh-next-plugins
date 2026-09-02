/**
 * Provider cache store: owns the plugin-local skill cache under
 * `<dshHome>/skills-market/` (deliberately outside `$DSH_HOME/skills`, which
 * the DSH filesystem provider scans, so cached skills never activate).
 *
 * Layout:
 *   <cacheRoot>/catalog.json                          persisted catalog
 *   <cacheRoot>/files/<providerId>/<skillSlug>/<rel>  downloaded skill files
 *   <cacheRoot>/providers.json                        LEGACY provider list
 * (read once by the settings migration, never written again)
 *
 * Sync is incremental: content hashes from the repository snapshot decide
 * which files (re-)download; unchanged skills keep their cached copies.
 */
import { MAX_FILES_PER_SKILL, parseCatalog } from '../core/catalog.ts'
import { parseSkillFile } from '../core/frontmatter.ts'
import { isSafeRelativePath, joinPath } from '../core/path.ts'
import { cacheDirSlug, hashContent, isIgnoredRepoPath, parseProviderSpec, providerId, providerSpec, versionHash } from '../core/provider.ts'
import type { Catalog, CatalogFile, CatalogSkill, FetchLike, FsLike, ProviderCatalog } from '../core/types.ts'
import { fetchRepoInfo, fetchRepoTarball, type GhTreeEntry } from './github-client.ts'
import { extractTarEntries } from './tarball.ts'

export const CATALOG_FILE = 'catalog.json'
export const LEGACY_PROVIDERS_FILE = 'providers.json'
export const FILES_DIR = 'files'

export interface ProviderStoreOptions {
  fs: FsLike
  fetch: FetchLike
  /** Cache root: <dshHome>/skills-market. */
  cacheRoot: string
}

/** Group a flat git tree into skill directories (every dir holding a SKILL.md). */
export function groupTreeBySkill(entries: readonly GhTreeEntry[]): Map<string, CatalogFile[]> {
  const dirs = new Map<string, CatalogFile[]>()
  for (const entry of entries) {
    if (entry.type !== 'blob') continue
    if (isIgnoredRepoPath(entry.path)) continue
    const idx = entry.path.lastIndexOf('/')
    const dir = idx === -1 ? '' : entry.path.slice(0, idx)
    const name = idx === -1 ? entry.path : entry.path.slice(idx + 1)
    if (name !== 'SKILL.md') continue
    const files = dirs.get(dir) ?? []
    files.push({ path: name, sha: entry.sha })
    dirs.set(dir, files)
  }
  // Attach every non-SKILL.md blob to the skill dir it belongs to.
  for (const entry of entries) {
    if (entry.type !== 'blob') continue
    if (isIgnoredRepoPath(entry.path)) continue
    const idx = entry.path.lastIndexOf('/')
    const dir = idx === -1 ? '' : entry.path.slice(0, idx)
    const name = idx === -1 ? entry.path : entry.path.slice(idx + 1)
    if (name === 'SKILL.md') continue
    const owner = nearestSkillDir(dirs, dir)
    if (owner === undefined) continue
    const prefix = owner === '' ? '' : owner + '/'
    const rel = dir.startsWith(prefix) ? dir.slice(prefix.length) + '/' + name : name
    if (!isSafeRelativePath(rel)) continue
    const files = dirs.get(owner)!
    if (files.some((f) => f.path === rel)) continue
    files.push({ path: rel, sha: entry.sha })
  }
  return dirs
}

/** Find the closest ancestor (or self) of `dir` that is a skill directory. */
function nearestSkillDir(dirs: Map<string, CatalogFile[]>, dir: string): string | undefined {
  let current = dir
  for (;;) {
    if (dirs.has(current)) return current
    if (current === '') return undefined
    const idx = current.lastIndexOf('/')
    current = idx === -1 ? '' : current.slice(0, idx)
  }
}

export class ProviderStore {
  constructor(private readonly opts: ProviderStoreOptions) {}

  private catalogPath(): string {
    return joinPath(this.opts.cacheRoot, CATALOG_FILE)
  }

  private legacyProvidersPath(): string {
    return joinPath(this.opts.cacheRoot, LEGACY_PROVIDERS_FILE)
  }

  private filesRoot(providerId: string): string {
    return joinPath(this.opts.cacheRoot, FILES_DIR, providerId)
  }

  /** Whether a legacy providers.json exists (defaults gate for fresh installs). */
  async hasLegacyProvidersFile(): Promise<boolean> {
    try {
      await this.opts.fs.access(this.legacyProvidersPath())
      return true
    } catch {
      return false
    }
  }

  /** Read the legacy provider list (empty when missing or corrupt). */
  async readLegacyProviders(): Promise<Array<{ id: string; spec: string; addedAt: string }>> {
    let raw: string
    try {
      raw = await this.opts.fs.readFile(this.legacyProvidersPath())
    } catch {
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
    const rawProviders = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { providers?: unknown }).providers
      : undefined)
    if (!Array.isArray(rawProviders)) return []
    return rawProviders.filter((p): p is { id: string; spec: string; addedAt: string } =>
      !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string' && (p as { id: string }).id !== ''
      && typeof (p as { spec?: unknown }).spec === 'string' && (p as { spec: string }).spec !== ''
      && typeof (p as { addedAt?: unknown }).addedAt === 'string')
  }

  /** Load the persisted catalog (empty when missing or corrupt). */
  async readCatalog(): Promise<Catalog> {
    let raw: string
    try {
      raw = await this.opts.fs.readFile(this.catalogPath())
    } catch {
      return { providers: [] }
    }
    try {
      return parseCatalog(JSON.parse(raw))
    } catch {
      return { providers: [] }
    }
  }

  private async writeCatalog(catalog: Catalog): Promise<void> {
    await this.opts.fs.mkdir(this.opts.cacheRoot, { recursive: true })
    await this.opts.fs.writeFile(this.catalogPath(), JSON.stringify(catalog, null, 2))
  }

  /** Read one cached skill file. */
  async readCachedFile(providerId: string, skill: CatalogSkill, relPath: string): Promise<string> {
    return this.opts.fs.readFile(joinPath(this.filesRoot(providerId), skill.cacheDir, relPath))
  }

  /**
   * Sync one provider: fetch repository metadata (description + stars) and
   * pull the default-branch snapshot in a single request, extracting skill
   * files into the cache locally. Updates (not replaces) the provider's
   * catalog entry.
   */
  async syncProvider(spec: string): Promise<ProviderCatalog> {
    const parsed = parseProviderSpec(spec)
    const canonical = providerSpec(spec)
    const id = providerId(spec)
    if (parsed === undefined || canonical === undefined || id === undefined) throw new Error(`invalid provider spec "${spec}"`)
    const catalog = await this.readCatalog()
    const existing = catalog.providers.find((p) => p.id === id)

    // Metadata (description + stars) is one cheap API call; the skills come
    // from a single snapshot download (CDN, outside the API budget) that is
    // extracted locally — no per-file downloads, so even large repositories
    // sync in seconds.
    const info = await fetchRepoInfo(this.opts.fetch, parsed.owner, parsed.repo)
    const tarball = await fetchRepoTarball(this.opts.fetch, parsed.owner, parsed.repo)
    const snapshotFiles = extractTarEntries(tarball)

    // Group every file under its nearest SKILL.md directory (same ownership
    // rules as before); file identities are content hashes.
    const contents = new Map(snapshotFiles.map((f) => [f.path, f.content]))
    const fileEntries = snapshotFiles
      .filter((f) => !isIgnoredRepoPath(f.path))
      .map((f) => ({ path: f.path, type: 'blob', sha: hashContent(f.content) }))
    const grouped = groupTreeBySkill(fileEntries)

    const { owner, repo: repoName } = parsed
    const nextSkills: CatalogSkill[] = []
    for (const [skillPath, files] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (files.length > MAX_FILES_PER_SKILL) {
        // An oversized group (often a repo-root SKILL.md hoovering loose
        // documentation files) is skipped instead of failing the provider.
        continue
      }
      const previous = existing?.skills.find((s) => s.skillPath === skillPath)
      const version = versionHash(files)
      const cacheDir = cacheDirSlug(skillPath === '' ? repoName : skillPath)
      if (previous !== undefined && previous.version === version) {
        nextSkills.push({ ...previous, cacheDir })
        continue
      }
      const skill = await this.writeSkillFromSnapshot(id, skillPath, cacheDir, files, contents, parsed.owner, repoName)
      nextSkills.push(skill)
    }

    const next: ProviderCatalog = {
      id,
      spec: `${parsed.owner}/${parsed.repo}`,
      branch: 'HEAD',
      lastRefresh: new Date().toISOString(),
      ...(info.description !== '' ? { description: info.description } : {}),
      stars: info.stars,
      skills: nextSkills,
    }
    // Drop cached files of skills that disappeared upstream.
    if (existing !== undefined) {
      const keep = new Set(nextSkills.map((s) => s.cacheDir))
      for (const skill of existing.skills) {
        if (!keep.has(skill.cacheDir)) {
          await this.opts.fs.rm(joinPath(this.filesRoot(id), skill.cacheDir), { recursive: true, force: true }).catch(() => {})
        }
      }
    }
    await this.writeCatalog({ providers: [...catalog.providers.filter((p) => p.id !== id), next].sort((a, b) => a.spec.localeCompare(b.spec)) })
    return next
  }

  /**
   * Record a sync failure on the provider's catalog row (keeps the last good
   * cache). Works even when the provider never synced: a stub catalog row is
   * created so the error surfaces instead of a misleading "never synced".
   */
  async markProviderError(id: string, error: string, spec?: string): Promise<void> {
    const catalog = await this.readCatalog()
    const provider = catalog.providers.find((p) => p.id === id)
    if (provider !== undefined) {
      provider.error = error
      await this.writeCatalog(catalog)
      return
    }
    if (spec === undefined) return
    await this.writeCatalog({
      providers: [...catalog.providers, { id, spec, branch: '', lastRefresh: '', error, skills: [] }],
    })
  }

  /** Remove a provider's catalog entry and cached files. */
  async removeProvider(id: string): Promise<void> {
    const catalog = await this.readCatalog()
    const provider = catalog.providers.find((p) => p.id === id)
    if (provider === undefined) return
    await this.opts.fs.rm(joinPath(this.opts.cacheRoot, FILES_DIR, id), { recursive: true, force: true }).catch(() => {})
    await this.writeCatalog({ providers: catalog.providers.filter((p) => p.id !== id) })
  }

  /**
   * Write one skill's files from the extracted snapshot into the cache and
   * build its catalog entry (falls back to the directory name when the
   * SKILL.md has no frontmatter).
   */
  private async writeSkillFromSnapshot(
    id: string,
    skillPath: string,
    cacheDir: string,
    files: readonly CatalogFile[],
    contents: ReadonlyMap<string, string>,
    owner: string,
    repo: string,
  ): Promise<CatalogSkill> {
    const base = joinPath(this.filesRoot(id), cacheDir)
    await this.opts.fs.mkdir(base, { recursive: true })
    let name = ''
    let description = ''
    let whenToUse: string | undefined
    const cachedFiles: CatalogFile[] = []
    for (const file of files) {
      if (!isSafeRelativePath(file.path)) continue
      const fullPath = skillPath === '' ? file.path : `${skillPath}/${file.path}`
      const content = contents.get(fullPath)
      if (content === undefined) continue
      await this.writeFile(base, file.path, content)
      cachedFiles.push({ path: file.path, sha: file.sha })
      if (file.path === 'SKILL.md') {
        const parsedSkill = parseSkillFile(content)
        name = parsedSkill?.name ?? ''
        description = parsedSkill?.description ?? ''
        whenToUse = parsedSkill?.whenToUse
      }
    }
    const dirName = skillPath === '' ? repo : skillPath.split('/').filter(Boolean).pop()!
    if (name === '') name = dirName
    if (description === '') description = `Skill from ${owner}/${repo}`
    return {
      name,
      description,
      ...(whenToUse !== undefined ? { whenToUse } : {}),
      cacheDir,
      skillPath,
      version: versionHash(files),
      files: cachedFiles,
    }
  }

  private async writeFile(base: string, relPath: string, content: string): Promise<void> {
    const target = joinPath(base, relPath)
    const idx = target.lastIndexOf('/')
    if (idx > 0) await this.opts.fs.mkdir(target.slice(0, idx), { recursive: true })
    await this.opts.fs.writeFile(target, content)
  }
}
