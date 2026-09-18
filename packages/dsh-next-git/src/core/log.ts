/**
 * History parsing and the bounded-depth graph lanes.
 *
 * The host runs one `git log` with a private pretty format (`%x1f` between
 * fields, NUL between commits) and this module turns it into rows plus the
 * lane assignment the narrow graph column draws. Lane computation is pure so
 * it is exhaustively testable without a repository, and bounded so a
 * many-branch history cannot ask the panel for an unbounded column.
 */

import type { CommitSummary, GraphEdge, GraphLane, HistoryPage } from './types.ts'

/** Field separator inside one log record. */
export const LOG_FIELD = '\u001f'

/** Lane ceiling: further parents fold into the last lane instead of widening. */
export const MAX_GRAPH_LANES = 12

/** The `--pretty` format the host asks for. */
export const LOG_FORMAT = `%H${LOG_FIELD}%h${LOG_FIELD}%P${LOG_FIELD}%an${LOG_FIELD}%at${LOG_FIELD}%s${LOG_FIELD}%D`

/**
 * Parse `git log -z --pretty=format:<LOG_FORMAT>`.
 *
 * @param raw - process stdout.
 * @returns commit rows, newest first.
 */
export function parseLog(raw: string): CommitSummary[] {
  const commits: CommitSummary[] = []
  for (const record of raw.split('\0')) {
    if (record.trim() === '') continue
    const fields = record.split(LOG_FIELD)
    if (fields.length < 7) continue
    const hash = fields[0]!
    if (hash === '') continue
    const parents = (fields[2] ?? '').trim() === '' ? [] : (fields[2] ?? '').trim().split(' ')
    commits.push({
      hash,
      short: fields[1] ?? hash.slice(0, 7),
      parents,
      author: fields[3] ?? '',
      timestamp: Number(fields[4] ?? '0') || 0,
      subject: fields[5] ?? '',
      refs: splitRefs(fields[6] ?? ''),
    })
  }
  return commits
}

/** Split `%D` decorations into clean ref names (`HEAD -> main` -> both parts). */
export function splitRefs(raw: string): string[] {
  const refs: string[] = []
  for (const part of raw.split(',')) {
    const entry = part.trim()
    if (entry === '') continue
    const arrow = entry.indexOf(' -> ')
    if (arrow >= 0) {
      refs.push(entry.slice(0, arrow).trim())
      refs.push(entry.slice(arrow + 4).trim())
    } else {
      refs.push(entry)
    }
  }
  return refs.filter((ref) => ref !== '')
}

/**
 * Assign each commit a lane and the connectors that leave its row.
 *
 * The algorithm walks commits newest-first keeping one "expected next hash"
 * per lane. A commit takes the lane that expects it, or a free lane; the
 * first parent takes over the commit's own lane and later parents land in a
 * free lane (or an existing one that already expects them). Pass-through
 * edges keep lanes that do not touch this commit drawn as continuous lines.
 *
 * @param commits - parsed rows, newest first.
 * @param options.maxLanes - lane ceiling (defaults to {@link MAX_GRAPH_LANES}).
 * @returns one lane assignment per commit, in the same order.
 */
export function computeGraphLanes(
  commits: readonly CommitSummary[],
  options: { maxLanes?: number } = {},
): GraphLane[] {
  const maxLanes = Math.max(1, options.maxLanes ?? MAX_GRAPH_LANES)
  const lanes: (string | null)[] = []
  const result: GraphLane[] = []

  const allocate = (): number => {
    const free = lanes.indexOf(null)
    if (free >= 0) return free
    if (lanes.length < maxLanes) {
      lanes.push(null)
      return lanes.length - 1
    }
    return lanes.length - 1
  }

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash)
    if (lane < 0) {
      lane = allocate()
      lanes[lane] = commit.hash
    }

    const before = [...lanes]
    const edges: GraphEdge[] = []

    // Pass-through: every other live lane keeps running through this row.
    for (let index = 0; index < before.length; index += 1) {
      if (index === lane) continue
      if (before[index] !== null) edges.push({ from: index, to: index })
    }

    // The commit's own lane continues into its first parent.
    const [first, ...rest] = commit.parents
    lanes[lane] = first ?? null
    if (first !== undefined) edges.push({ from: lane, to: lane })

    for (const parent of rest) {
      let target = lanes.indexOf(parent)
      if (target < 0) {
        target = allocate()
        lanes[target] = parent
      }
      edges.push({ from: lane, to: target })
    }

    result.push({ lane, edges: dedupeEdges(edges) })
  }

  return result
}

/** Drop duplicate connectors (same source and destination). */
function dedupeEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>()
  const result: GraphEdge[] = []
  for (const edge of edges) {
    const key = `${edge.from}:${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(edge)
  }
  return result
}

/**
 * Build a history page from parsed rows.
 *
 * @param commits - rows already limited by the caller.
 * @param options.limit - the requested window; `hasMore` compares against it.
 * @param options.maxLanes - graph lane ceiling.
 * @returns rows, their lanes and the truncation flag.
 */
export function buildHistory(
  commits: readonly CommitSummary[],
  options: { limit?: number; maxLanes?: number } = {},
): HistoryPage {
  const limit = options.limit ?? commits.length
  return {
    commits,
    lanes: computeGraphLanes(commits, options.maxLanes === undefined ? {} : { maxLanes: options.maxLanes }),
    // An empty page is never "more to load": the caller asked for nothing.
    hasMore: limit > 0 && commits.length >= limit,
  }
}

/** The widest lane any row uses, so the graph column can size itself. */
export function graphWidth(lanes: readonly GraphLane[]): number {
  let width = 0
  for (const row of lanes) {
    width = Math.max(width, row.lane + 1)
    for (const edge of row.edges) width = Math.max(width, edge.from + 1, edge.to + 1)
  }
  return width
}
