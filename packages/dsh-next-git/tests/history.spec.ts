import { describe, expect, it } from 'vitest'
import {
  buildHistory,
  computeGraphLanes,
  graphWidth,
  LOG_FIELD,
  MAX_GRAPH_LANES,
  parseLog,
  splitRefs,
} from '../src/core/log.ts'
import type { CommitSummary } from '../src/core/types.ts'

/** Build one log record in the host's private format. */
function record(
  hash: string,
  parents: readonly string[],
  subject = 'subject',
  refs = '',
  extra: { short?: string; author?: string; timestamp?: number } = {},
): string {
  return [
    hash,
    extra.short ?? hash.slice(0, 7),
    parents.join(' '),
    extra.author ?? 'Fixture Author',
    String(extra.timestamp ?? 1_700_000_000),
    subject,
    refs,
  ].join(LOG_FIELD)
}

/** Build a NUL-framed log stream. */
function stream(records: readonly string[]): string {
  return `${records.join('\0')}\0`
}

function commit(hash: string, parents: string[], refs: string[] = []): CommitSummary {
  return { hash, short: hash.slice(0, 7), parents, author: 'a', timestamp: 1, subject: 's', refs }
}

describe('history parsing', () => {
  it('parses commits, oldest field formatting included', () => {
    const commits = parseLog(stream([
      record('aaaaaaaaaaaa', ['bbbbbbbbbbbb'], 'feat: one', 'HEAD -> main, origin/main'),
      record('bbbbbbbbbbbb', [], 'chore: seed'),
    ]))
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({
      hash: 'aaaaaaaaaaaa',
      short: 'aaaaaaa',
      parents: ['bbbbbbbbbbbb'],
      subject: 'feat: one',
      refs: ['HEAD', 'main', 'origin/main'],
      timestamp: 1_700_000_000,
    })
    expect(commits[1]!.parents).toEqual([])
  })

  it('skips blank and short records', () => {
    expect(parseLog('')).toEqual([])
    expect(parseLog('\0')).toEqual([])
    expect(parseLog('too\u001ffew\0')).toEqual([])
  })

  it('splits ref decorations', () => {
    expect(splitRefs('HEAD -> main, tag: v1, origin/main')).toEqual(['HEAD', 'main', 'tag: v1', 'origin/main'])
    expect(splitRefs('')).toEqual([])
    expect(splitRefs(' , ')).toEqual([])
  })

  it('reads a missing timestamp as zero', () => {
    const malformed = ['h', 'h', '', 'a', 'not-a-number', 's', ''].join(LOG_FIELD)
    expect(parseLog(`${malformed}\0`)[0]!.timestamp).toBe(0)
  })
})

describe('graph lanes', () => {
  it('keeps a linear history in one lane', () => {
    const lanes = computeGraphLanes([
      commit('c', ['b']),
      commit('b', ['a']),
      commit('a', []),
    ])
    expect(lanes.map((row) => row.lane)).toEqual([0, 0, 0])
    expect(lanes[0]!.edges).toEqual([{ from: 0, to: 0 }])
    expect(lanes[2]!.edges).toEqual([])
  })

  it('opens a second lane for a merge and closes it when it is consumed', () => {
    const lanes = computeGraphLanes([
      commit('m', ['a', 'b']),
      commit('a', ['root']),
      commit('b', ['root']),
      commit('root', []),
    ])
    expect(lanes[0]!.lane).toBe(0)
    expect(lanes[0]!.edges).toContainEqual({ from: 0, to: 0 })
    expect(lanes[0]!.edges).toContainEqual({ from: 0, to: 1 })
    // `b` is expected in lane 1.
    expect(lanes[2]!.lane).toBe(1)
    expect(graphWidth(lanes)).toBe(2)
  })

  it('draws pass-through edges for lanes that do not touch the commit', () => {
    const lanes = computeGraphLanes([
      commit('m', ['a', 'b']),
      commit('a', ['x']),
      commit('b', ['x']),
    ])
    // Row 1 is on lane 0 and lane 1 still expects `b`, so a line continues.
    expect(lanes[1]!.edges).toContainEqual({ from: 1, to: 1 })
  })

  it('reuses a lane freed by a closed branch', () => {
    const lanes = computeGraphLanes([
      commit('a', ['b']),
      commit('b', []),
      commit('c', []),
    ])
    // `b` closes lane 0 (no parents), so the unrelated root `c` takes it back
    // instead of widening the column.
    expect(lanes.map((row) => row.lane)).toEqual([0, 0, 0])
  })

  it('bounds the column at the lane ceiling', () => {
    const commits = [commit('tip', Array.from({ length: 20 }, (_, index) => `p${index}`))]
    const lanes = computeGraphLanes(commits, { maxLanes: 3 })
    for (const edge of lanes[0]!.edges) {
      expect(edge.to).toBeLessThan(3)
    }
    expect(MAX_GRAPH_LANES).toBeGreaterThan(3)
  })

  it('handles an empty history', () => {
    expect(computeGraphLanes([])).toEqual([])
    expect(buildHistory([]).hasMore).toBe(false)
  })

  it('reports whether a window was clipped', () => {
    const commits = [commit('a', []), commit('b', [])]
    expect(buildHistory(commits, { limit: 2 }).hasMore).toBe(true)
    expect(buildHistory(commits, { limit: 5 }).hasMore).toBe(false)
  })

  it('sizes the graph column from dots and connectors', () => {
    expect(graphWidth([{ lane: 2, edges: [{ from: 0, to: 1 }] }])).toBe(3)
    expect(graphWidth([])).toBe(0)
  })
})
