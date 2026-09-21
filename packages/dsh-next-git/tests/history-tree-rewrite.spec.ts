import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { preservesHistoryTree, rewriteHistoryTree } from '../src/host/history-tree-rewrite.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import type { HistoryPlan } from '../src/core/history-plan.ts'
import { readFile } from 'node:fs/promises'

const oid = (letter: string) => letter.repeat(40)
const base = oid('a'), first = oid('b'), tail = oid('c'), tree = oid('d'), rewritten = oid('e')
const dirs: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const plan: HistoryPlan = { eligible: true, action: 'reword', selected: [first], ordered: [first], affected: [first, tail], descendants: [tail], base, steps: [{ kind: 'pick', oid: first }, { kind: 'message', oid: first }, { kind: 'pick', oid: tail }], message: 'New subject\n\nBody', rewrites: true }
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'history-object-')); dirs.push(dir)
  const runner = new GitRunner()
  const original = Buffer.concat([Buffer.from(`tree ${tree}\nparent ${base}\nauthor Original <a@b> 123 +0130\ncommitter Original <a@b> 456 -0200\nencoding ISO-8859-1\ngpgsig signature\n continued\ngpgsig-sha256 other\n continued\nmergetag object\n continued\n\n`), Buffer.from([0xe9, 10])])
  const descendant = Buffer.from(`tree ${tree}\nparent ${first}\nauthor Tail <t@b> 789 +0000\ncommitter Tail <t@b> 987 +0000\n\nOriginal tail\n`)
  const read = vi.spyOn(runner, 'runBytesOk').mockImplementation(async args => args[2] === first ? original : descendant)
  const write = vi.spyOn(runner, 'runOk').mockImplementation(async args => args[0] === 'hash-object' ? rewritten + '\n' : tree + '\n')
  return { dir, runner, original, read, write, run: (p = plan) => rewriteHistoryTree(runner, dir, dir, p, tail, tree) }
}
describe('tree-preserving object rewrite', () => {
  it('limits eligibility to the three tree-preserving actions', () => {
    for (const action of ['reword', 'squash', 'fixup']) expect(preservesHistoryTree(action)).toBe(true)
    for (const action of ['reorder', 'revert', 'cherry-pick', 'unknown']) expect(preservesHistoryTree(action)).toBe(false)
  })
  it('preserves raw metadata, strips stale signatures and uses UTF-8 for replacement messages', async () => {
    const { dir, run } = setup(); expect(await run()).toBe(rewritten)
    const object = await readFile(join(dir, 'commit-0'), 'utf8')
    expect(object).toContain('author Original <a@b> 123 +0130\ncommitter Original <a@b> 456 -0200\n\nNew subject\n\nBody')
    expect(object).not.toMatch(/gpgsig|mergetag|continued|encoding/)
    expect(await readFile(join(dir, 'commit-1'), 'utf8')).toContain(`parent ${rewritten}\nauthor Tail <t@b> 789 +0000\ncommitter Tail <t@b> 987 +0000\n\nOriginal tail\n`)
  })
  it('keeps original encoding and message bytes for fixup', async () => {
    const { dir, run } = setup()
    await run({ ...plan, action: 'fixup', selected: [first, tail], ordered: [first, tail], descendants: [], message: null })
    const object = await readFile(join(dir, 'commit-0'))
    expect(object.toString('latin1')).toContain('encoding ISO-8859-1')
    expect(object.subarray(-2)).toEqual(Buffer.from([0xe9, 10]))
  })
  it.each([
    { action: 'reorder' }, { base: null }, { selected: [] }, { affected: [tail] }, { ordered: [tail] }, { descendants: [] },
  ])('rejects malformed plans before writing objects: %j', async patch => {
    const { run, write } = setup()
    await expect(run({ ...plan, ...patch } as HistoryPlan)).rejects.toThrow('Invalid tree-preserving')
    expect(write).not.toHaveBeenCalled()
  })
  it.each(['parent', 'tree', 'separator'] as const)('rejects invalid original %s before writing', async defect => {
    const { run, read, write } = setup()
    read.mockResolvedValue(Buffer.from(defect === 'separator' ? 'invalid' : `tree ${defect === 'tree' ? 'bad' : tree}\nparent ${defect === 'parent' ? tail : base}\n\nMessage`))
    await expect(run()).rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
  })
  it('refuses a changed final tree', async () => {
    const { runner, dir } = setup()
    await expect(rewriteHistoryTree(runner, dir, dir, plan, tail, oid('f'))).rejects.toThrow('final tree')
  })
  it('refuses an invalid hash-object result', async () => {
    const { run, write } = setup(); write.mockResolvedValue('bad')
    await expect(run()).rejects.toThrow('invalid rewritten commit')
  })
  it('verifies the constructed final tree before returning a publishable ref', async () => {
    const { run, write } = setup(); write.mockImplementation(async args => args[0] === 'hash-object' ? rewritten : oid('f'))
    await expect(run()).rejects.toThrow('changed the final tree')
  })
})
