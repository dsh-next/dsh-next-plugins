import { afterEach, describe, expect, it } from 'vitest'
import { createFixture, type GitFixture } from './git-fixture.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import { GitService } from '../src/host/git-service.ts'
import { nodeFs } from '../src/host/fs-adapter.ts'
import { isHistoryOid } from '../src/core/history-view.ts'

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
  it('recognizes only full SHA-1 and SHA-256 IDs', () => {
    expect(isHistoryOid('a'.repeat(40))).toBe(true)
    expect(isHistoryOid('a'.repeat(64))).toBe(true)
    for (const value of ['HEAD', '-x', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(41), 'a'.repeat(63), 'a'.repeat(65)]) {
      expect(isHistoryOid(value)).toBe(false)
    }
  })

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
    expect((await read.diff(source, hash, 'topic.txt')).file?.patch).toContain('+topic')
    expect((await read.diff(source, hash, 'main.txt')).empty).toBe(true)
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
    await expect(read.compare(source, 'HEAD', to)).rejects.toMatchObject({ failure: { code: 'invalid-name' } })
  })

  it('rejects options/revision expressions and reports missing commits', async () => {
    const { read } = fixture()
    for (const ref of ['HEAD', 'HEAD~1', '--output=anything', 'abc']) {
      await expect(read.inspect(source, ref)).rejects.toMatchObject({ failure: { code: 'invalid-name' } })
    }
    await expect(read.inspect(source, 'f'.repeat(40))).rejects.toHaveProperty('failure')
  })

  it('reads committed diffs without including or changing working-tree edits', async () => {
    const { git, read } = fixture()
    const hash = git.commit('selected.txt', 'COMMITTED EVIDENCE', 'selected subject')
    git.write('selected.txt', 'UNCOMMITTED AND UNRELATED')
    const before = git.gitOk(['diff'])
    const diff = await read.diff(source, hash, 'selected.txt')
    expect(diff.file?.patch).toContain('COMMITTED EVIDENCE')
    expect(diff.file?.patch).not.toContain('UNCOMMITTED AND UNRELATED')
    expect(git.gitOk(['diff'])).toBe(before)
  })

  it('reports binary changes without treating bytes as text', async () => {
    const { git, read } = fixture()
    const hash = git.commit('binary.dat', 'binary\0content', 'binary addition')
    expect((await read.inspect(source, hash)).files).toEqual([{ path: 'binary.dat', status: 'A' }])
    expect(await read.diff(source, hash, 'binary.dat')).toMatchObject({ empty: false, file: { binary: true } })
  })

  it('reads recent commits from the current checkout and follows branch switches', async () => {
    const { git, service } = fixture()
    const main = git.commit('main.txt', 'main', 'main change')
    git.gitOk(['checkout', '-b', 'topic', 'HEAD~1'])
    const topic = git.commit('topic.txt', 'topic', 'topic change')
    const page = await service.history({ ...source, limit: 1 })
    expect(page).toMatchObject({ anchor: topic, hasMore: true })
    expect(page.commits.map(commit => commit.hash)).toEqual([topic])
    expect(page.lanes).toHaveLength(1)
    git.gitOk(['checkout', 'main'])
    const switched = await service.history(source)
    expect(switched.anchor).toBe(main)
    expect(switched.commits.map(commit => commit.hash)).toContain(main)
    expect(switched.commits.map(commit => commit.hash)).not.toContain(topic)
    git.gitOk(['checkout', '--detach', topic])
    expect((await service.history(source)).commits[0]?.hash).toBe(topic)
  })

  it('keeps later pages anchored when HEAD advances, without gaps or duplicate commits', async () => {
    const { git, service } = fixture()
    git.commit('page.txt', 'page', 'page tip')
    const expected = git.gitOk(['rev-list', 'HEAD']).trim().split('\n')
    const first = await service.history({ ...source, limit: 1 })
    const anchor = first.anchor!
    const later = git.commit('later.txt', 'later', 'later change')
    const rest = await service.history({ ...source, anchor, skip: 1, limit: 500 })
    expect(first.hasMore).toBe(true)
    expect(rest).toMatchObject({ anchor, hasMore: false })
    expect([...first.commits, ...rest.commits].map(commit => commit.hash)).toEqual(expected)
    expect(rest.lanes).toHaveLength(rest.commits.length)
    expect(await service.history({ ...source, anchor, skip: expected.length })).toEqual({ anchor, commits: [], lanes: [], hasMore: false })
    expect((await service.history(source)).commits[0]?.hash).toBe(later)
  })

  it('accepts only full commit IDs for pagination, not branch or tag selection', async () => {
    const { git, service } = fixture()
    git.gitOk(['tag', 'v1'])
    for (const anchor of ['main', 'v1', 'HEAD', 'HEAD~1', '--all', '', 'abc123']) {
      await expect(service.history({ ...source, anchor })).rejects.toHaveProperty('failure.code', 'invalid-name')
    }
    await expect(service.history({ ...source, anchor: 'f'.repeat(40) })).rejects.toHaveProperty('failure')
  })

  it('reads the active linked worktree rather than the primary checkout', async () => {
    const { git, service } = fixture()
    const base = git.gitOk(['rev-parse', 'HEAD']).trim()
    const worktree = git.addWorktree('history')
    const main = git.commit('main.txt', 'main', 'primary checkout change')
    const page = await service.history({ cwd: worktree })
    expect(page.anchor).toBe(base)
    expect(page.commits[0]?.hash).toBe(base)
    expect(page.commits.map(commit => commit.hash)).not.toContain(main)
  })
})
