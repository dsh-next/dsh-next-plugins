/**
 * Pure GitHub provider helpers: spec parsing, identifier slugs, and the
 * version hash used for change detection between a provider's git tree and
 * an installed skill's manifest.
 */
import type { CatalogFile } from './types.ts'

export interface ParsedProvider {
  owner: string
  repo: string
}

/**
 * Normalize a provider spec to `{ owner, repo }`. Accepts `owner/repo`, an
 * optional `.git` suffix, or a full GitHub URL (with optional trailing path
 * junk such as `/tree/main`). URL-shaped specs must point at github.com;
 * bare specs must be exactly two segments. Returns undefined otherwise.
 */
export function parseProviderSpec(spec: string): ParsedProvider | undefined {
  const s = spec.trim()
  if (s === '') return undefined
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('www.')
  if (looksLikeUrl) {
    const urlMatch = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/.exec(s)
    if (urlMatch === null) return undefined
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/i, '') }
  }
  const parts = s.replace(/\.git$/i, '').split('/').filter(Boolean)
  if (parts.length !== 2) return undefined
  const [owner, repo] = parts
  // Bare specs are two plain identifiers; this also rejects SCP-style
  // `git@github.com:a/b` and anything carrying a scheme or credential.
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return undefined
  return { owner, repo }
}

/** Canonical provider spec string (`owner/repo`). */
export function providerSpec(spec: string): string | undefined {
  const parsed = parseProviderSpec(spec)
  return parsed === undefined ? undefined : `${parsed.owner}/${parsed.repo}`
}

/**
 * Stable provider id: the canonical spec with every character outside
 * [a-z0-9-] replaced by a dash (used as the cache directory name).
 */
export function providerId(spec: string): string | undefined {
  const canonical = providerSpec(spec)
  if (canonical === undefined) return undefined
  const slug = canonical.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug === '' ? undefined : slug
}

/**
 * Turn a repository-relative skill directory into a flat, filesystem-safe
 * cache directory name (`a/b/c` -> `a__b__c`).
 */
export function cacheDirSlug(skillPath: string): string {
  return skillPath.split('/').filter(Boolean).join('__')
}

/** Reverse of {@link cacheDirSlug} (best effort, used for diagnostics only). */
export function skillPathFromCacheDir(cacheDir: string): string {
  return cacheDir.split('__').join('/')
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Snapshot sync has no git blob SHAs, so a file's identity is a hash of its
 * content. Not a security primitive — a change detector only.
 */
export function hashContent(content: string): string {
  return fnv1a(content)
}

/**
 * FNV-1a over the sorted `path:sha` lines of a skill's file list. Two file
 * sets are the same version exactly when their hashes match; a changed or
 * renamed file produces a different hash. Not a security primitive — a
 * change detector only.
 */
export function versionHash(files: readonly CatalogFile[]): string {
  const input = files
    .map((file) => `${file.path}:${file.sha}`)
    .sort()
    .join('\n')
  return fnv1a(input)
}

/** Directory segments never considered part of a skill tree. */
const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', '.github'])

/** Whether a repository path sits under an ignored directory. */
export function isIgnoredRepoPath(path: string): boolean {
  return path.split('/').some((segment) => IGNORED_SEGMENTS.has(segment))
}
