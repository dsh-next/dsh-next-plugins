/**
 * Version gating and failure classification.
 *
 * Every raw git failure is turned into a `GitFailure` here, so the panel can
 * render a named state with a fix instead of a stderr dump. Pure: callers
 * pass the process outcome in.
 */

import type { DegradedState, GitFailure, GitFailureCode } from './types.ts'

/** Oldest git the plugin drives. `--path-format=absolute` needs 2.31. */
export const MIN_GIT_VERSION = '2.31.0'

/** `git merge-tree --write-tree` (conflict prediction) landed in 2.38. */
export const MERGE_TREE_VERSION = '2.38.0'

/** A parsed `git version` triple. */
export interface GitVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** Apple/Git-for-Windows suffixes (`2.39.3 (Apple Git-142)`), kept for display. */
  readonly rest: string
}

/**
 * Parse `git --version` output.
 *
 * Accepts `git version 2.39.3`, `git version 2.39.3.windows.1`, and the
 * Apple-suffixed `git version 2.39.3 (Apple Git-142)`.
 *
 * @param raw - stdout of `git --version`.
 * @returns the parsed triple, or null when the string is not a version line.
 */
export function parseGitVersion(raw: string): GitVersion | null {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw)
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    rest: raw.slice(match.index + match[0].length).trim(),
  }
}

/** Numeric comparison: negative when `a < b`, 0 when equal, positive when `a > b`. */
export function compareVersions(a: GitVersion, b: GitVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/** Whether a parsed version is at least `required` (`dotted` major.minor.patch). */
export function meetsVersion(installed: GitVersion | null, required: string): boolean {
  if (installed === null) return false
  const parsed = parseGitVersion(required)
  if (parsed === null) return true
  return compareVersions(installed, parsed) >= 0
}

/** Whether this git can predict merge conflicts with `merge-tree --write-tree`. */
export function supportsMergeTree(installed: GitVersion | null): boolean {
  return meetsVersion(installed, MERGE_TREE_VERSION)
}

/** One raw git invocation outcome, as the classifier consumes it. */
export interface RawGitOutcome {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  /** Set by the runner when the process was killed rather than exiting. */
  readonly killed?: boolean
  /** Set when the runner refused to spawn (`ENOENT`). */
  readonly spawnFailed?: boolean
}

const PATTERNS: readonly { readonly code: GitFailureCode; readonly re: RegExp }[] = [
  { code: 'not-a-repository', re: /not a git repository|not a work tree/i },
  { code: 'bare-repository', re: /this operation must be run in a work tree|is a bare repository/i },
  { code: 'permission-denied', re: /permission denied|operation not permitted|EACCES|read-only file system/i },
  { code: 'index-locked', re: /index\.lock|another git process|unable to create '.*\.lock'/i },
  { code: 'identity-missing', re: /please tell me who you are|unable to auto-detect email address|empty ident name|not allowed without specifying an identity/i },
  { code: 'nothing-to-commit', re: /nothing to commit|no changes added to commit|nothing added to commit/i },
  { code: 'not-merged', re: /not fully merged/i },
  { code: 'dirty-tree', re: /your local changes|would be overwritten|please commit your changes or stash|contains modified or untracked files/i },
  { code: 'path-missing', re: /did not match any file|pathspec .* did not match|does not exist in/i },
  { code: 'hook-failed', re: /hook declined|pre-commit hook|husky|failed to run hook/i },
  { code: 'operation-in-progress', re: /merging is not possible|a merge is in progress|cannot rebase|you have unmerged files|rebase in progress|cherry-pick is already in progress/i },
]

/** Bound a process's output so a runaway hook cannot blow up the envelope. */
export function clipOutput(raw: string, max = 4000): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  return trimmed.length <= max ? trimmed : trimmed.slice(-max)
}

/**
 * Classify a failed git invocation.
 *
 * @param outcome - exit code and streams.
 * @returns a named failure with a bounded detail tail.
 */
export function classifyGitFailure(outcome: RawGitOutcome): GitFailure {
  const detail = clipOutput(outcome.stderr !== '' ? outcome.stderr : outcome.stdout)
  if (outcome.spawnFailed === true || outcome.code === 127) {
    return { code: 'git-unavailable', detail }
  }
  if (outcome.killed === true) {
    return { code: 'timeout', detail }
  }
  const haystack = `${outcome.stderr}\n${outcome.stdout}`
  for (const pattern of PATTERNS) {
    if (pattern.re.test(haystack)) return { code: pattern.code, detail, exitCode: outcome.code }
  }
  return { code: 'git-failed', detail, exitCode: outcome.code }
}

/** Whether a failure means git cannot serve the panel at all. */
export function isDegradedCode(code: GitFailureCode): code is DegradedState['code'] {
  return (
    code === 'git-unavailable' ||
    code === 'git-too-old' ||
    code === 'not-a-repository' ||
    code === 'bare-repository' ||
    code === 'permission-denied'
  )
}

/**
 * Build the degraded state for a terminal failure.
 *
 * @param failure - classified failure.
 * @param versions - installed/required versions, for the `git-too-old` fix line.
 * @returns the degraded state, or null when the failure is not terminal.
 */
export function degradedFrom(
  failure: GitFailure,
  versions: { installed: string | null; required: string } = { installed: null, required: MIN_GIT_VERSION },
): DegradedState | null {
  if (!isDegradedCode(failure.code)) return null
  return {
    code: failure.code,
    detail: failure.detail,
    requiredVersion: failure.code === 'git-too-old' ? versions.required : null,
    installedVersion: failure.code === 'git-too-old' ? versions.installed : null,
  }
}

/** The `git-too-old` failure for a parsed installed version. */
export function tooOldFailure(installed: GitVersion): GitFailure {
  return {
    code: 'git-too-old',
    detail: `git ${installed.major}.${installed.minor}.${installed.patch}`,
  }
}
