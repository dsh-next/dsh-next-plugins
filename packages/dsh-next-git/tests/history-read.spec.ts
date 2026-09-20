import { afterEach, describe, expect, it } from 'vitest'
import { createFixture, type GitFixture } from './git-fixture.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import { GitService } from '../src/host/git-service.ts'
import { nodeFs } from '../src/host/fs-adapter.ts'

const fixtures: GitFixture[] = []
afterEach(() => fixtures.splice(0).forEach(fixture => fixture.dispose()))
function fixture() {
  const git = createFixture('clean')
  fixtures.push(git)
  const service = new GitService({ runner: new GitRunner(), fs: nodeFs(), cwdOf: () => git.dir, platform: process.platform, env: process.env })
  return { git, service, read: service.historyRead }
}
const source = { sessionId: 'history-read' }

describe('immutable history reads', () => {
  it('inspects root files and their diff without changing checkout state', async () => {
    const { git, read } = fixture()
    const hash = git.gitOk(['rev-list', '--max-parents=0', 'HEAD']).trim()
    const before = git.gitOk(['rev-parse', 'HEAD'])
    const details = await read.inspect(source, hash)
    expect(details.parent).toBeNull()
    expect(details.files.length).toBeGreaterThan(0)
    const diff = await read.diff(source, hash, details.files[0]!.path)
    expect(diff.empty).toBe(false)
    expect(diff.file?.added).toBeGreaterThan(0)
    expect(git.gitOk(['rev-parse', 'HEAD'])).toBe(before)
    expect(git.gitOk(['status', '--porcelain'])).toBe('')
  })

  it('preserves rename paths and uses literal pathspecs', async () => {
    const { git, read } = fixture()
    git.commit('plain.txt', 'unchanged content\n', 'add file')
    git.gitOk(['mv', 'plain.txt', ':(glob)*.txt'])
    const hash = git.commitIndex('rename file')
    const details = await read.inspect(source, hash)
    expect(details.files).toEqual([{ path: ':(glob)*.txt', oldPath: 'plain.txt', status: 'R100' }])
    const diff = await read.diff(source, hash, ':(glob)*.txt', 'plain.txt')
    expect(diff.file?.patch).toContain('rename from plain.txt')
    expect((await read.diff(source, hash, 'missing.txt')).empty).toBe(true)
    await expect(read.diff(source, hash, '../escape')).rejects.toMatchObject({ failure: { code: 'path-missing' } })
    await expect(read.diff(source, hash, '.git/config')).rejects.toMatchObject({ failure: { code: 'path-missing' } })
  })

  it('declares the first parent when inspecting a merge', async () => {
    const { git, read } = fixture()
    git.gitOk(['checkout', '-b', 'topic'])
    git.commit('topic.txt', 'topic', 'topic')
    git.gitOk(['checkout', 'main'])
    const parent = git.commit('main.txt', 'main', 'main')
    git.gitOk(['merge', '--no-edit', 'topic'])
    const hash = git.gitOk(['rev-parse', 'HEAD']).trim()
    const details = await read.inspect(source, hash)
    expect(details.parent).toBe(parent)
    expect(details.commit.parents).toHaveLength(2)
    expect(details.files.map(file => file.path)).toContain('topic.txt')
  })

  it('compares exact endpoint snapshots and reports clipping', async () => {
    const { git, read } = fixture()
    const from = git.gitOk(['rev-parse', 'HEAD']).trim()
    const to = git.commit('large.txt', 'x'.repeat(140_000), 'large addition')
    const result = await read.compare(source, from, to)
    expect(result).toMatchObject({ from, to, truncated: true })
    expect(result.patch).toHaveLength(128_000)
    expect(result.summary).toContain('large.txt')
    expect((await read.compare(source, to, to)).patch).toBe('')
  })

  it('rejects options/revision expressions and reports missing commits', async () => {
    const { read } = fixture()
    for (const ref of ['HEAD', 'HEAD~1', '--output=anything', 'abc']) {
      await expect(read.inspect(source, ref)).rejects.toMatchObject({ failure: { code: 'invalid-name' } })
    }
    await expect(read.inspect(source, 'f'.repeat(40))).rejects.toHaveProperty('failure')
  })

  it('collects selected commit evidence, not dirty working-tree text', async () => {
    const { git, read } = fixture()
    const hash = git.commit('selected.txt', 'COMMITTED EVIDENCE', 'selected subject')
    git.write('selected.txt', 'UNCOMMITTED AND UNRELATED')
    const context = await read.context(source, [hash])
    expect(context.commits[0]).toMatchObject({ hash, subject: 'selected subject', patchTruncated: false })
    expect(context.commits[0]!.patch).toContain('COMMITTED EVIDENCE')
    expect(context.commits[0]!.patch).not.toContain('UNCOMMITTED AND UNRELATED')
    expect(context.omittedCommits).toEqual([])
    await expect(read.context(source, [hash, hash])).rejects.toHaveProperty('failure')
  })

  it('uses literal text, author and UTC date filters without changing history', async () => {
    const { git, service } = fixture()
    const hash = git.commit('filter.txt', 'filter', 'feat: [literal] query')
    expect((await service.history({ ...source, search: '[literal]' })).commits.map(commit => commit.hash)).toEqual([hash])
    expect((await service.history({ ...source, author: 'not-the-author' })).commits).toEqual([])
    expect((await service.history({ ...source, since: '2024-01-01' })).commits).toEqual([])
    await expect(service.history({ ...source, since: '2023-02-30' })).rejects.toMatchObject({ failure: { code: 'invalid-name' } })
    await expect(service.history({ ...source, search: 'x'.repeat(501) })).rejects.toMatchObject({ failure: { code: 'invalid-name' } })
  })
})
