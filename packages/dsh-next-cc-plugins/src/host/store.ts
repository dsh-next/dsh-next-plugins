/**
 * Persistence for the cc-plugins plugin: the configured marketplace list,
 * cached repository snapshots, and the installed-plugin registry — all JSON
 * files under `$DSH_HOME/cc-plugins/`. Filesystem access flows through
 * the injected {@link FsLike} so everything is testable in-memory.
 *
 * A marketplace snapshot is the repository's text files plus the parsed
 * `.claude-plugin/marketplace.json` index (`.grok-plugin/marketplace.json`
 * is honored as a Grok Build interop fallback).
 */
import { parseMarketplaceIndex } from '../core/marketplace-index.ts'
import { sanitizeModelMap } from '../core/agents.ts'
import { dirnamePath, isSafeRelativePath, joinPath } from '../core/path.ts'
import { normalizeInstalledFile } from '../core/targets.ts'
import type {
  FetchLike,
  FsLike,
  InstalledFile,
  MarketplaceIndex,
  StoredMarketplace,
} from '../core/types.ts'
import { extractTarEntries } from './tarball.ts'
import { fetchRepoTarball } from './github-client.ts'

/** Where the index file may live inside a marketplace repository. */
export const INDEX_PATHS = ['.claude-plugin/marketplace.json', '.grok-plugin/marketplace.json']

/** Caps for local-directory marketplaces so a stray path cannot hang the host. */
export const MAX_LOCAL_FILES = 2000
export const MAX_LOCAL_FILE_BYTES = 512 * 1024

export interface Snapshot {
  fetchedAt: string
  /** Repository files (repo-relative paths, UTF-8 text only). */
  files: Record<string, string>
  /** The parsed marketplace index. */
  index: MarketplaceIndex
  /** Which index path the index was read from. */
  indexPath: string
}

export type SyncResult =
  | { snapshot: Snapshot }
  | { error: string }

/** Path-safe cache directory name for a marketplace id (`github:o/r` -> `github_o_r`). */
export function safeDirId(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]+/g, '_')
}

export interface StoreOptions {
  fs: FsLike
  fetch: FetchLike
  /** Plugin data root: `$DSH_HOME/cc-plugins`. */
  root: string
  /** Home directory for `~` expansion of local marketplace paths. */
  home: string
}

export class Store {
  constructor(private readonly opts: StoreOptions) {}

  private marketplacesPath(): string {
    return joinPath(this.opts.root, 'marketplaces.json')
  }

  private installedPath(): string {
    return joinPath(this.opts.root, 'installed.json')
  }

  private snapshotPath(id: string): string {
    return joinPath(this.opts.root, 'cache', safeDirId(id), 'snapshot.json')
  }

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    let raw: string
    try {
      raw = await this.opts.fs.readFile(path)
    } catch {
      return fallback
    }
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await this.opts.fs.mkdir(dirnamePath(path), { recursive: true })
    await this.opts.fs.writeFile(path, JSON.stringify(value, null, 2))
  }

  async listMarketplaces(): Promise<StoredMarketplace[]> {
    return this.readJson<StoredMarketplace[]>(this.marketplacesPath(), [])
  }

  async saveMarketplaces(list: StoredMarketplace[]): Promise<void> {
    await this.writeJson(this.marketplacesPath(), list)
  }

  async readInstalled(): Promise<InstalledFile> {
    // Normalize on read: pre-targets records (single scope/skills triple)
    // migrate into the targets array, and corrupt lines drop out.
    return normalizeInstalledFile(await this.readJson<unknown>(this.installedPath(), { plugins: [] }))
  }

  async saveInstalled(file: InstalledFile): Promise<void> {
    await this.writeJson(this.installedPath(), file)
  }

  /** The panel's Claude-alias to DSH-model overrides (model-map.json);
   *  `null` marks an alias as explicitly inheriting the session model. */
  async readModelMap(): Promise<Record<string, string | null>> {
    return sanitizeModelMap(await this.readJson<unknown>(this.modelMapPath(), {}))
  }

  async saveModelMap(map: Record<string, string | null>): Promise<void> {
    await this.writeJson(this.modelMapPath(), map)
  }

  private modelMapPath(): string {
    return joinPath(this.opts.root, 'model-map.json')
  }

  async readSnapshot(id: string): Promise<Snapshot | undefined> {
    return this.readJson<Snapshot | undefined>(this.snapshotPath(id), undefined)
  }

  /**
   * The cached file map of one installed plugin, frozen at install/update
   * time. The runtime bridge (slash commands, hooks) reads only this cache —
   * activation never depends on the network or a live marketplace.
   */
  async readCachedPluginFiles(id: string, pluginName: string): Promise<Record<string, string> | undefined> {
    return this.readJson<Record<string, string> | undefined>(this.pluginCachePath(id, pluginName), undefined)
  }

  async saveCachedPluginFiles(id: string, pluginName: string, files: Record<string, string>): Promise<void> {
    await this.writeJson(this.pluginCachePath(id, pluginName), files)
  }

  private pluginCachePath(id: string, pluginName: string): string {
    return joinPath(this.opts.root, 'cache', safeDirId(id), `plugin-${pluginName.replace(/[^A-Za-z0-9_.-]+/g, '_')}.json`)
  }

  private async saveSnapshot(id: string, snapshot: Snapshot): Promise<void> {
    await this.writeJson(this.snapshotPath(id), snapshot)
  }

  /**
   * Synchronize one marketplace: fetch (GitHub) or walk (local) the source,
   * parse the index, persist the snapshot. Errors are returned, not thrown.
   */
  async sync(
    source: { kind: 'github'; owner: string; repo: string } | { kind: 'local'; path: string },
    id: string,
  ): Promise<SyncResult> {
    let files: Record<string, string>
    if (source.kind === 'github') {
      let tarball: Uint8Array
      try {
        tarball = await fetchRepoTarball(this.opts.fetch, source.owner, source.repo)
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
      files = {}
      for (const entry of extractTarEntries(tarball)) {
        if (isSafeRelativePath(entry.path)) files[entry.path] = entry.content
      }
    } else {
      const walked = await this.readLocalTree(this.expandHome(source.path))
      if (typeof walked === 'string') return { error: walked }
      files = walked
    }
    for (const indexPath of INDEX_PATHS) {
      const raw = files[indexPath]
      if (raw === undefined) continue
      const parsed = parseMarketplaceIndex(raw, indexPath)
      if ('error' in parsed) return { error: parsed.error }
      const snapshot: Snapshot = { fetchedAt: new Date().toISOString(), files, index: parsed.index, indexPath }
      await this.saveSnapshot(id, snapshot)
      return { snapshot }
    }
    return { error: 'no .claude-plugin/marketplace.json (or .grok-plugin fallback) found in the repository' }
  }

  private expandHome(path: string): string {
    if (path === '~') return this.opts.home
    if (path.startsWith('~/')) return joinPath(this.opts.home, path.slice(2))
    return path
  }

  /** Walk a local marketplace directory into a relative text-file map. */
  private async readLocalTree(absRoot: string): Promise<Record<string, string> | string> {
    const files: Record<string, string> = {}
    const walk = async (dir: string, rel: string): Promise<string | undefined> => {
      let entries
      try {
        entries = await this.opts.fs.readdir(dir)
      } catch {
        return `cannot read marketplace directory "${absRoot}"`
      }
      for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
        const childAbs = joinPath(dir, entry.name)
        if (entry.isDirectory()) {
          const err = await walk(childAbs, childRel)
          if (err !== undefined) return err
          continue
        }
        if (Object.keys(files).length >= MAX_LOCAL_FILES) {
          return `local marketplace exceeds the ${MAX_LOCAL_FILES}-file cap`
        }
        let content: string
        try {
          content = await this.opts.fs.readFile(childAbs)
        } catch {
          continue // unreadable entries (permissions, sockets) are skipped
        }
        if (content.length > MAX_LOCAL_FILE_BYTES) continue
        files[childRel] = content
      }
      return undefined
    }
    const err = await walk(absRoot, '')
    if (err !== undefined) return err
    return files
  }
}
