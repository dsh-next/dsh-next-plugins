import { describe, expect, it } from 'vitest'
import { GitRunner } from '../src/host/git-runner.ts'
import { findUntrackedCollision } from '../src/host/ignored-guard.ts'

const nul = String.fromCharCode(0)
const paths = (entries: readonly string[]): Buffer => Buffer.from(entries.map(path => path + nul).join(''), 'latin1')
function runnerFor(untracked: readonly string[] | Buffer, candidates: readonly string[], ignoreCase = false) {
  const calls: string[][] = []
  const runner = new GitRunner(
    async () => ({ code: 0, stdout: String(ignoreCase), stderr: '' }),
    undefined,
    async (_file, args) => {
      calls.push([...args])
      return { code: 0, stderr: '', stdout: args.includes('--others') ? Buffer.isBuffer(untracked) ? untracked : paths(untracked) : paths(candidates) }
    },
  )
  return { runner, calls }
}
const emptyScope = { commits: [], trees: [] }

describe('ignored/untracked checkout collision guard', () => {
  it.each([
    [['a'], ['a'], 'a'],
    [['a/only-copy'], ['a'], 'a/only-copy'],
    [['a'], ['a/child'], 'a'],
    [['nested-repo/'], ['nested-repo/child'], 'nested-repo/'],
    [['a/safe'], ['a/tracked'], null],
    [['a-b'], ['a'], null],
    [['a'], ['a-b'], null],
    [['z'], ['a'], null],
    [['node_modules/pkg/file', '.worktrees/dev/'], ['src/app.ts'], null],
    [['name\nwith-newline'], ['name\nwith-newline'], 'name\nwith-newline'],
    [['empty'], [], null],
    [[], ['a'], null],
  ] as const)('compares exact, ancestor and descendant paths: %j against %j', async (untracked, candidates, expected) => {
    const { runner } = runnerFor(untracked, candidates)
    expect(await findUntrackedCollision(runner, '/unused', emptyScope)).toBe(expected)
  })

  it.each([true, false])('honors core.ignorecase=%s', async ignoreCase => {
    for (const [untracked, candidate] of [['PRECIOUS', 'precious'], ['PRECIOUS/only-copy', 'precious'], ['PRECIOUS', 'precious/child']]) {
      const { runner } = runnerFor([untracked!], [candidate!], ignoreCase)
      expect(await findUntrackedCollision(runner, '/unused', emptyScope)).toBe(ignoreCase ? untracked : null)
    }
  })

  it('preserves non-UTF8 path identities instead of matching replacement characters', async () => {
    const { runner } = runnerFor(['x' + String.fromCharCode(255)], ['x' + String.fromCharCode(254)])
    expect(await findUntrackedCollision(runner, '/unused', emptyScope)).toBeNull()
    const exact = runnerFor(['x' + String.fromCharCode(255)], ['x' + String.fromCharCode(255)])
    expect(await findUntrackedCollision(exact.runner, '/unused', emptyScope)).not.toBeNull()
  })

  it('reads each unique intermediate patch and target tree, not a net endpoint diff', async () => {
    const { runner, calls } = runnerFor(['safe'], ['candidate'])
    await findUntrackedCollision(runner, '/unused', { commits: ['add', 'remove', 'add'], trees: ['base', 'head', 'base'] })
    expect(calls).toEqual([
      ['ls-files', '--others', '-z'],
      ['ls-files', '--cached', '-z'],
      ['ls-tree', '-r', '--name-only', '-z', 'base', '--'],
      ['ls-tree', '-r', '--name-only', '-z', 'head', '--'],
      ['diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', 'add', '--'],
      ['diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', 'remove', '--'],
    ])
  })

  it('handles large disjoint path sets without a path-pair Cartesian product', async () => {
    const { runner } = runnerFor(Array.from({ length: 20_000 }, (_, i) => 'ignored/' + i), Array.from({ length: 20_000 }, (_, i) => 'tracked/' + i))
    expect(await findUntrackedCollision(runner, '/unused', emptyScope)).toBeNull()
  })

  it('fails closed on excessive aggregate paths', async () => {
    const { runner } = runnerFor(Array.from({ length: 125_001 }, () => 'safe'), Array.from({ length: 125_001 }, () => 'candidate'))
    await expect(findUntrackedCollision(runner, '/unused', emptyScope)).rejects.toThrow('path count limit')
  })

  it('fails closed on excessive path bytes before parsing', async () => {
    const { runner } = runnerFor(Buffer.alloc(32 * 1024 * 1024 + 1, 120), [])
    await expect(findUntrackedCollision(runner, '/unused', emptyScope)).rejects.toThrow('path byte limit')
  })

  it('bounds the number of revision reads', async () => {
    const { runner, calls } = runnerFor([], [])
    await expect(findUntrackedCollision(runner, '/unused', { commits: Array.from({ length: 2_011 }, (_, i) => String(i)), trees: [] })).rejects.toThrow('revision limit')
    expect(calls).toEqual([])
  })

  it('propagates read failures instead of treating unreadable paths as safe', async () => {
    const runner = new GitRunner(undefined, undefined, async () => ({ code: 1, stdout: Buffer.alloc(0), stderr: 'read failed' }))
    await expect(findUntrackedCollision(runner, '/unused', emptyScope)).rejects.toThrow()
  })
})
