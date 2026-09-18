/**
 * `git status --porcelain=v2 -z` parsing, and the grouping the panel renders.
 *
 * Pure: the host feeds it raw stdout, the client never sees a porcelain line.
 * The parser is exhaustive over every record type the format defines
 * (headers, `1`, `2`, `u`, `?`, `!`) and tolerant of the two shapes git can
 * legitimately produce — NUL-separated (`-z`, what we always ask for) and
 * newline-separated (what a fallback invocation would hand us).
 *
 * Record grammar (git-status(1), "Porcelain Format Version 2"):
 *
 * ```
 * # branch.oid <oid> | (initial)
 * # branch.head <branch> | (detached)
 * # branch.upstream <branch>
 * # branch.ab +<ahead> -<behind>
 * 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 * 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
 * u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 * ? <path>
 * ! <path>
 * ```
 *
 * With `-z` every record is NUL-terminated and a rename's two paths are
 * separate NUL-terminated fields; without it the two paths share one line
 * joined by a tab. Both are handled here because a caller may pipe a
 * hand-built fixture through the parser.
 */
import type { ChangeKind, ChangeSummary, HeadState, StatusEntry, UnmergedCode } from './types.ts'

/** One parsed status report. */
export interface StatusReport {
  readonly head: HeadState
  readonly entries: readonly StatusEntry[]
  /** Set when a header line was malformed; the report is still usable. */
  readonly malformed: boolean
}

const UNMERGED_CODES: Readonly<Record<string, UnmergedCode>> = {
  DD: 'both-deleted',
  AU: 'added-by-us',
  UD: 'deleted-by-them',
  UA: 'added-by-them',
  DU: 'deleted-by-us',
  AA: 'both-added',
  UU: 'both-modified',
}

/** Map one porcelain status letter to a change kind; `.` means "unchanged". */
export function changeKindOf(letter: string): ChangeKind | undefined {
  switch (letter) {
    case 'M':
      return 'modified'
    case 'T':
      return 'typechange'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'unmerged'
    default:
      return undefined
  }
}

/** Reverse of {@link changeKindOf}, for building fixtures and asserting round trips. */
export function statusLetterOf(kind: ChangeKind): string {
  switch (kind) {
    case 'modified':
      return 'M'
    case 'typechange':
      return 'T'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'unmerged':
      return 'U'
    default:
      return '?'
  }
}

/** Split raw stdout into records, accepting both `-z` and newline framing. */
export function splitStatusRecords(raw: string): string[] {
  if (raw === '') return []
  const byNul = raw.split('\0')
  if (byNul.length > 1) {
    return byNul.filter((record) => record !== '')
  }
  return raw.split('\n').filter((record) => record !== '')
}

/**
 * Parse a rename/copy record's path pair.
 *
 * With `-z` the two paths are separate records, so the parser consumes the
 * next field; without it they are tab-joined on the same record.
 *
 * @param pathField - the record's own path field.
 * @param takeNext - pulls the next NUL-separated record, when one exists.
 * @returns the new path, the source path, and whether a field was consumed.
 */
export function parseRenamePaths(
  pathField: string,
  takeNext: () => string | undefined,
): { path: string; oldPath: string | undefined; consumedNext: boolean } {
  const tab = pathField.indexOf('\t')
  if (tab >= 0) {
    return { path: pathField.slice(0, tab), oldPath: pathField.slice(tab + 1) || undefined, consumedNext: false }
  }
  const next = takeNext()
  if (next === undefined || next === '') {
    return { path: pathField, oldPath: undefined, consumedNext: next !== undefined }
  }
  return { path: pathField, oldPath: next, consumedNext: true }
}

/** An empty branch position, for a repository with no HEAD at all. */
export function emptyHead(): HeadState {
  return { oid: null, branch: null, upstream: null, ahead: 0, behind: 0, detached: false, unborn: false }
}

/**
 * Parse `git status --porcelain=v2 -z` (or its newline-framed twin).
 *
 * @param raw - process stdout, verbatim.
 * @returns the HEAD position and every entry in git's listing order.
 */
export function parsePorcelainV2(raw: string): StatusReport {
  const records = splitStatusRecords(raw)
  let head = emptyHead()
  const entries: StatusEntry[] = []
  let malformed = false

  let index = 0
  const takeNext = (): string | undefined => {
    index += 1
    return index < records.length ? records[index] : undefined
  }

  for (; index < records.length; index += 1) {
    const record = records[index]!
    if (record.startsWith('# ')) {
      head = applyHeader(head, record.slice(2))
      continue
    }
    const kind = record[0]
    if (kind === '1') {
      const parsed = parseOrdinary(record)
      if (parsed === undefined) malformed = true
      else entries.push(parsed)
      continue
    }
    if (kind === '2') {
      const parsed = parseRenamed(record, takeNext)
      if (parsed === undefined) malformed = true
      else entries.push(parsed)
      continue
    }
    if (kind === 'u') {
      const parsed = parseUnmerged(record)
      if (parsed === undefined) malformed = true
      else entries.push(parsed)
      continue
    }
    if (kind === '?' || kind === '!') {
      const path = record.slice(2)
      if (path === '') {
        malformed = true
        continue
      }
      entries.push({
        path,
        xy: kind === '?' ? '??' : '!!',
        untracked: kind === '?',
        ignored: kind === '!',
        ...(kind === '?' ? { worktree: 'untracked' as ChangeKind } : { worktree: 'ignored' as ChangeKind }),
      })
      continue
    }
    malformed = true
  }

  return { head, entries, malformed }
}

/** Fold one `# ` header line into the HEAD position. */
function applyHeader(head: HeadState, header: string): HeadState {
  const space = header.indexOf(' ')
  const key = space < 0 ? header : header.slice(0, space)
  const value = space < 0 ? '' : header.slice(space + 1)
  switch (key) {
    case 'branch.oid':
      return value === '(initial)' ? { ...head, oid: null, unborn: true } : { ...head, oid: value || null }
    case 'branch.head':
      return value === '(detached)' ? { ...head, branch: null, detached: true } : { ...head, branch: value || null }
    case 'branch.upstream':
      return { ...head, upstream: value || null }
    case 'branch.ab': {
      const match = /^\+(\d+) -(\d+)$/.exec(value)
      if (match === null) return head
      return { ...head, ahead: Number(match[1]), behind: Number(match[2]) }
    }
    default:
      return head
  }
}

/** `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` */
function parseOrdinary(record: string): StatusEntry | undefined {
  const fields = record.split(' ')
  // 1 + XY + sub + mH + mI + mW + hH + hI = 8 fields before the path.
  if (fields.length < 9) return undefined
  const xy = fields[1] ?? ''
  const path = fields.slice(8).join(' ')
  if (xy.length !== 2 || path === '') return undefined
  return entryFor(xy, path, undefined, false, false)
}

/** `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>[\0<origPath>]` */
function parseRenamed(record: string, takeNext: () => string | undefined): StatusEntry | undefined {
  const fields = record.split(' ')
  // 2 + XY + sub + mH + mI + mW + hH + hI + score = 9 fields before the path.
  if (fields.length < 10) return undefined
  const xy = fields[1] ?? ''
  const pathField = fields.slice(9).join(' ')
  if (xy.length !== 2 || pathField === '') return undefined
  const { path, oldPath } = parseRenamePaths(pathField, takeNext)
  if (path === '') return undefined
  return entryFor(xy, path, oldPath, false, false)
}

/** `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>` */
function parseUnmerged(record: string): StatusEntry | undefined {
  const fields = record.split(' ')
  // u + XY + sub + m1 + m2 + m3 + mW + h1 + h2 + h3 = 10 fields before the path.
  if (fields.length < 11) return undefined
  const xy = fields[1] ?? ''
  const path = fields.slice(10).join(' ')
  if (xy.length !== 2 || path === '') return undefined
  const code = UNMERGED_CODES[xy]
  if (code === undefined) return undefined
  return {
    path,
    xy,
    untracked: false,
    ignored: false,
    index: 'unmerged',
    worktree: 'unmerged',
    unmerged: code,
  }
}

/** Build an ordinary entry from its `XY` pair. */
function entryFor(
  xy: string,
  path: string,
  oldPath: string | undefined,
  untracked: boolean,
  ignored: boolean,
): StatusEntry {
  const index = changeKindOf(xy[0] ?? '.')
  const worktree = changeKindOf(xy[1] ?? '.')
  return {
    path,
    ...(oldPath === undefined ? {} : { oldPath }),
    ...(index === undefined ? {} : { index }),
    ...(worktree === undefined ? {} : { worktree }),
    xy,
    untracked,
    ignored,
  }
}

/** `XY` for a synthetic entry, so the panel can always show a two-letter code. */
export function syntheticXy(index: ChangeKind | undefined, worktree: ChangeKind | undefined): string {
  const left = index === undefined ? '.' : statusLetterOf(index)
  const right = worktree === undefined ? '.' : statusLetterOf(worktree)
  return `${left}${right}`
}

/**
 * Group entries the way the panel renders them.
 *
 * A path can appear on both sides at once (`MM`): it is listed in `staged`
 * *and* `unstaged`. Untracked and ignored paths go to their own buckets, and
 * unmerged paths are additionally collected into `conflicts`.
 *
 * @param entries - parser output, in git's order.
 * @param options.includeIgnored - keep the ignored list (bounded by the caller).
 * @param options.ignoredCount - the ignored total, so the panel can say "N ignored".
 * @param options.ignoredLimit - cap on the ignored list itself.
 * @param options.ignoredTruncated - whether the ignored list was clipped.
 */
export function summarizeChanges(
  entries: readonly StatusEntry[],
  options: {
    includeIgnored?: boolean
    ignoredCount?: number
    ignoredLimit?: number
    ignoredTruncated?: boolean
  } = {},
): ChangeSummary {
  const staged: StatusEntry[] = []
  const unstaged: StatusEntry[] = []
  const untracked: StatusEntry[] = []
  const ignored: StatusEntry[] = []
  const conflicts: StatusEntry[] = []
  const ignoredLimit = options.ignoredLimit ?? Number.POSITIVE_INFINITY
  let ignoredTotal = 0

  for (const entry of entries) {
    if (entry.untracked) {
      untracked.push(entry)
      continue
    }
    if (entry.ignored) {
      // Counted even when the list itself is dropped, so the panel can still
      // say "N ignored" without carrying every path.
      ignoredTotal += 1
      if (options.includeIgnored === true && ignored.length < ignoredLimit) ignored.push(entry)
      continue
    }
    if (entry.unmerged !== undefined) conflicts.push(entry)
    if (entry.index !== undefined) staged.push(entry)
    if (entry.worktree !== undefined) unstaged.push(entry)
  }

  return {
    staged,
    unstaged,
    untracked,
    ignored,
    conflicts,
    ignoredCount: options.ignoredCount ?? ignoredTotal,
    ignoredTruncated: options.ignoredTruncated === true,
  }
}

/**
 * Paths that make a working tree dirty for a checkout-changing operation.
 *
 * Ignored paths never block anything; untracked and modified paths do.
 */
export function dirtyPaths(entries: readonly StatusEntry[]): string[] {
  const paths: string[] = []
  for (const entry of entries) {
    if (entry.ignored) continue
    if (entry.untracked || entry.worktree !== undefined) paths.push(entry.path)
  }
  return paths
}

/** Whether the tree has no staged, unstaged, untracked or conflicted entries. */
export function isClean(entries: readonly StatusEntry[]): boolean {
  return !entries.some((entry) => !entry.ignored)
}

/** Staged paths, the input to `git reset --` and the commit path list. */
export function stagedPaths(summary: ChangeSummary): string[] {
  return [...new Set(summary.staged.map((entry) => entry.path))]
}

/** Unstaged tracked paths, the input to `git add --`. */
export function unstagedPaths(summary: ChangeSummary): string[] {
  return [...new Set(summary.unstaged.map((entry) => entry.path))]
}

/** Every changed path, for the agent-verb payload and the commit draft. */
export function changedPaths(summary: ChangeSummary): string[] {
  return [
    ...new Set([
      ...summary.staged.map((entry) => entry.path),
      ...summary.unstaged.map((entry) => entry.path),
      ...summary.untracked.map((entry) => entry.path),
    ]),
  ]
}
