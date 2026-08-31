/**
 * Parse a user-typed marketplace source spec into a resolvable source.
 *
 * Accepted forms (the same surface Claude Code and Grok Build accept for
 * `plugin marketplace add`):
 *   - GitHub shorthand:            `owner/repo`
 *   - GitHub HTTPS URL:            `https://github.com/owner/repo` (optional
 *                                  trailing `.git`, optional trailing slash)
 *   - GitHub SSH URL:              `git@github.com:owner/repo.git`
 *   - Local directory:             `./dir`, `../dir`, `/abs/dir`, `~/dir`
 *
 * Remote marketplaces are GitHub-only in this version: the snapshot download
 * uses the codeload CDN, which exists only for GitHub. Non-GitHub git URLs
 * are rejected with an actionable message instead of failing opaquely.
 */
import type { MarketplaceSource, SourceParseResult } from './types.ts'

const GITHUB_HTTPS = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/
const GITHUB_SSH = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/
const SHORTHAND = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/
const OTHER_GIT = /^(?:git\+?https?:\/\/|https?:\/\/|git@|ssh:\/\/git@)/

export function parseMarketplaceSpec(rawSpec: string): SourceParseResult {
  const spec = rawSpec.trim()
  if (spec === '') return { error: 'empty marketplace spec' }

  const https = GITHUB_HTTPS.exec(spec)
  if (https !== null) return github(https[1], https[2])

  const ssh = GITHUB_SSH.exec(spec)
  if (ssh !== null) return github(ssh[1], ssh[2])

  if (!spec.startsWith('/') && !spec.startsWith('~') && !spec.startsWith('./') && !spec.startsWith('../')) {
    const short = SHORTHAND.exec(spec)
    if (short !== null) return github(short[1], short[2])
    if (OTHER_GIT.test(spec)) {
      return { error: 'remote marketplaces must be GitHub (owner/repo shorthand, https://github.com/..., or git@github.com:...); other git hosts are not supported yet' }
    }
    return { error: `invalid marketplace spec "${rawSpec}" (expected owner/repo, a GitHub URL, or a local path)` }
  }

  if (spec === '~' || spec.startsWith('~/')) {
    // `~` expansion is a host concern (HOME differs per machine); keep the
    // tilde form canonical and let the host resolve it at sync time.
    return { source: { kind: 'local', path: spec }, canonical: spec, id: `local:${spec}` }
  }
  return { source: { kind: 'local', path: spec }, canonical: spec, id: `local:${spec}` }
}

function github(owner: string, repo: string): SourceParseResult {
  return {
    source: { kind: 'github', owner, repo },
    canonical: `${owner}/${repo}`,
    id: `github:${owner}/${repo}`,
  }
}

/**
 * Resolve a `~/`-prefixed local path against a home directory. Pure: the host
 * supplies HOME so tests stay hermetic.
 */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`
  return path
}
