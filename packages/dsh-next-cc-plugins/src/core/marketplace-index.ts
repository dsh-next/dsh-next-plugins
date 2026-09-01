/**
 * Parse and validate a `.claude-plugin/marketplace.json` document into the
 * normalized {@link MarketplaceIndex}.
 *
 * Follows the Claude Code marketplace schema: required `name` and `plugins`
 * array; each plugin entry requires `name` and `source`. Source forms:
 *   - string: `"./plugins/foo"` (relative path inside the marketplace repo)
 *   - `{ "source": "github", "repo": "owner/repo", "ref"?: string }`
 *   - `{ "source": "url" | "git", "url": "https://github.com/..." }`
 *     (GitHub URLs are mapped to the github kind; other hosts are unsupported)
 *   - Grok Build interop: `{ "type": "local", "path": "./plugins/foo" }` and
 *     `{ "source": "url", "url": ..., "sha"?: ... }` from `.grok-plugin/`
 *     indexes normalize to the same union.
 *   - npm / archive / git-subdir entries are surfaced as unsupported rather
 *     than dropped, so the UI can show what the marketplace offers.
 *
 * Bare-name sources (`"formatter"` with `metadata.pluginRoot`) are resolved
 * by the caller, which knows the marketplace root's `pluginRoot` metadata.
 */
import { normalizeRelativePath } from './path.ts'
import type { MarketplaceIndex, MarketplacePlugin, PluginSource } from './types.ts'

interface RawIndex {
  name?: unknown
  description?: unknown
  owner?: unknown
  metadata?: unknown
  plugins?: unknown
}

interface RawEntry {
  name?: unknown
  description?: unknown
  version?: unknown
  category?: unknown
  author?: unknown
  homepage?: unknown
  tags?: unknown
  keywords?: unknown
  source?: unknown
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []
}

/**
 * Normalize one raw `source` value. `pluginRoot` (from index metadata) is the
 * directory bare names resolve under; it is already normalized by the caller.
 */
export function normalizePluginSource(raw: unknown, pluginRoot: string): PluginSource {
  if (typeof raw === 'string') {
    const path = raw.trim()
    if (path === '') return { kind: 'unsupported', raw, reason: 'empty source' }
    if (path.startsWith('./') || path.startsWith('../') || pluginRoot === '') {
      return { kind: 'relative', path: normalizeRelativePath(path) }
    }
    // A bare directory name resolves under metadata.pluginRoot.
    if (!path.includes('/') && !path.startsWith('.')) {
      return { kind: 'relative', path: normalizeRelativePath(`${pluginRoot}/${path}`) }
    }
    return { kind: 'relative', path: normalizeRelativePath(path) }
  }
  if (raw === null || typeof raw !== 'object') {
    return { kind: 'unsupported', raw: String(raw), reason: 'source must be a string or an object' }
  }
  const s = raw as Record<string, unknown>
  const kind = str(s.source ?? s.type).toLowerCase()
  // Claude pins external sources with `sha` (exact commit) and optionally
  // `ref` (branch or tag); an exact pin beats a movable ref.
  const pinnedRef = str(s.sha) !== '' ? str(s.sha) : str(s.ref)

  if (kind === 'local' || kind === 'relative' || kind === 'path') {
    const path = str(s.path)
    if (path === '') return { kind: 'unsupported', raw: JSON.stringify(raw), reason: 'local source has no path' }
    return { kind: 'relative', path: normalizeRelativePath(path) }
  }
  if (kind === 'github' || kind === 'repo') {
    const repo = str(s.repo)
    const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo)
    if (match === null) {
      return { kind: 'unsupported', raw: JSON.stringify(raw), reason: `github source has invalid repo "${repo}"` }
    }
    return { kind: 'github', owner: match[1], repo: match[2], ...(pinnedRef !== '' ? { ref: pinnedRef } : {}) }
  }
  if (kind === 'git-subdir') {
    // `{ source: "git-subdir", url, path, ref?, sha? }` — a subdirectory of a
    // git repository (the official marketplace uses this for monorepos).
    const gh = githubUrlOf(str(s.url))
    const path = normalizeRelativePath(str(s.path))
    if (gh === null) {
      return { kind: 'unsupported', raw: JSON.stringify(raw), reason: 'git-subdir source has no url' }
    }
    if (path === '') {
      return { kind: 'unsupported', raw: JSON.stringify(raw), reason: `git-subdir source for ${gh.owner}/${gh.repo} has no path` }
    }
    return { kind: 'github', owner: gh.owner, repo: gh.repo, subdir: path, ...(pinnedRef !== '' ? { ref: pinnedRef } : {}) }
  }
  if (kind === 'url' || kind === 'git') {
    const url = str(s.url)
    const gh = githubUrlOf(url)
    if (gh !== null) {
      return { kind: 'github', owner: gh.owner, repo: gh.repo, ...(pinnedRef !== '' ? { ref: pinnedRef } : {}) }
    }
    if (url === '') return { kind: 'unsupported', raw: JSON.stringify(raw), reason: 'url source has no url' }
    return { kind: 'unsupported', raw: JSON.stringify(raw), reason: 'only GitHub git URLs are supported (got a non-GitHub host)' }
  }
  if (kind === 'npm') return { kind: 'unsupported', raw: JSON.stringify(raw), reason: 'npm plugin sources are not supported yet' }
  if (kind === 'archive') return { kind: 'unsupported', raw: JSON.stringify(raw), reason: 'archive plugin sources are not supported yet' }
  if (kind === 'command') return { kind: 'unsupported', raw: JSON.stringify(raw), reason: 'command plugin sources are not supported (they execute a local command)' }
  return { kind: 'unsupported', raw: JSON.stringify(raw), reason: `unknown source kind "${kind}"` }
}

/** A GitHub HTTPS URL as owner/repo, or null for anything else. */
function githubUrlOf(url: string): { owner: string; repo: string } | null {
  const gh = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url)
  return gh === null ? null : { owner: gh[1], repo: gh[2] }
}

export type IndexParseResult =
  | { index: MarketplaceIndex }
  | { error: string }

/**
 * Parse a marketplace.json document. `where` names the file for error
 * messages. Invalid entries fail the whole index (a marketplace whose index
 * cannot be trusted should not half-load); unknown per-entry source kinds
 * stay visible as unsupported rows.
 */
export function parseMarketplaceIndex(text: string, where: string): IndexParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { error: `${where}: invalid JSON (${error instanceof Error ? error.message : String(error)})` }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { error: `${where}: top level must be an object` }
  }
  const raw = data as RawIndex
  const name = str(raw.name)
  if (name === '') return { error: `${where}: missing required "name"` }
  if (!Array.isArray(raw.plugins)) return { error: `${where}: missing required "plugins" array` }

  const metadata = (raw.metadata !== null && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata))
    ? raw.metadata as Record<string, unknown>
    : {}
  const pluginRoot = str(metadata.pluginRoot) !== '' ? normalizeRelativePath(str(metadata.pluginRoot)) : ''

  const ownerRaw = (raw.owner !== null && typeof raw.owner === 'object' && !Array.isArray(raw.owner))
    ? raw.owner as Record<string, unknown>
    : {}
  const owner = str(ownerRaw.name)

  const plugins: MarketplacePlugin[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.plugins.length; i++) {
    const entry = raw.plugins[i]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: `${where}: plugins[${i}] must be an object` }
    }
    const e = entry as RawEntry
    const pluginName = str(e.name)
    if (pluginName === '') return { error: `${where}: plugins[${i}] is missing required "name"` }
    if (seen.has(pluginName)) return { error: `${where}: duplicate plugin name "${pluginName}"` }
    seen.add(pluginName)
    if (e.source === undefined) return { error: `${where}: plugin "${pluginName}" is missing required "source"` }

    const authorRaw = (e.author !== null && typeof e.author === 'object' && !Array.isArray(e.author))
      ? e.author as Record<string, unknown>
      : {}
    plugins.push({
      name: pluginName,
      description: str(e.description),
      version: str(e.version),
      category: str(e.category),
      author: str(authorRaw.name),
      homepage: str(e.homepage),
      tags: [...strArray(e.tags), ...strArray(e.keywords)],
      source: normalizePluginSource(e.source, pluginRoot),
    })
  }
  return {
    index: {
      name,
      // Claude's index shape allows the description at the top level or
      // nested under `metadata` (the form e.g. holistics/skills uses).
      description: str(raw.description) !== '' ? str(raw.description) : str(metadata.description),
      owner,
      plugins,
    },
  }
}
