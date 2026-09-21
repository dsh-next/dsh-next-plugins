import { afterEach, describe, expect, it } from 'vitest'
import { createFixture, type GitFixture } from './git-fixture.ts'
import { GitService } from '../src/host/git-service.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import { nodeFs } from '../src/host/fs-adapter.ts'
import { buildAgentPayload } from '../src/core/agent-verbs.ts'

const fixtures: GitFixture[] = []
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose() })
function fixture(scenario: Parameters<typeof createFixture>[0] = 'clean') {
  const git = createFixture(scenario)
  fixtures.push(git)
  const service = new GitService({ runner: new GitRunner(), fs: nodeFs(), cwdOf: () => git.dir, platform: process.platform, env: process.env })
  return { git, service }
}

describe('scoped real-Git agent context', () => {
  it('reports all files omitted by the host before building the prompt', async () => {
    const { git, service } = fixture()
    for (let i = 0; i < 41; i++) git.write('file-' + String(i).padStart(2, '0') + '.txt', 'change')
    const result = await service.agentFiles({ sessionId: 's', verb: 'review' })
    expect(result.files).toHaveLength(40)
    expect(result.omittedPaths).toEqual(['file-40.txt'])
    expect(buildAgentPayload({ ...result, verb: 'review' })).toMatchObject({ truncated: true, droppedFiles: ['file-40.txt'] })
  })

  it('includes index and worktree sides of an MM file, but drafts only staged content', async () => {
    const { git, service } = fixture()
    git.write('src/app.ts', 'STAGED_ONLY')
    git.gitOk(['add', 'src/app.ts'])
    git.write('src/app.ts', 'UNSTAGED_ONLY')
    const result = await service.agentFiles({ sessionId: 's', verb: 'review' })
    expect(result.files).toHaveLength(2)
    expect(result.files.map(file => file.staged)).toEqual([true, false])
    const payload = buildAgentPayload({ ...result, verb: 'review' })
    expect(payload.prompt).toContain('STAGED_ONLY')
    expect(payload.prompt).toContain('UNSTAGED_ONLY')
    expect(payload.includedFiles).toEqual(['src/app.ts'])
    const draft = await service.agentFiles({ sessionId: 's', verb: 'draft' })
    expect(draft.files).toHaveLength(1)
    expect(draft.files[0]!.patch).not.toContain('UNSTAGED_ONLY')
  })

  it('honors explicit empty scope, ignores unchanged paths, and scopes before limits', async () => {
    const { git, service } = fixture()
    git.write('selected.txt', 'selected')
    for (let i = 0; i < 42; i++) git.write('file-' + i + '.txt', 'other')
    expect((await service.agentFiles({ sessionId: 's', paths: [] })).files).toEqual([])
    const result = await service.agentFiles({ sessionId: 's', paths: ['selected.txt', 'src/app.ts'] })
    expect(result.files.map(file => file.path)).toEqual(['selected.txt'])
    expect(result.omittedPaths).toEqual([])
    expect((await service.agentFiles({ sessionId: 's', verb: 'resolve' })).files).toEqual([])
  })

  it('prioritizes conflicted files and includes three-way evidence instead of an empty combined diff', async () => {
    const { git, service } = fixture('merge-conflict')
    for (let i = 0; i < 42; i++) git.write('file-' + i + '.txt', 'other')
    const result = await service.agentFiles({ sessionId: 's', verb: 'resolve' })
    expect(result.files.map(file => file.path)).toEqual(['src/app.ts'])
    expect(result.files[0]!.patch).toContain('Base:')
    expect(result.files[0]!.patch).toContain('Working result:')
    expect(result.files[0]!.patch).toContain('<<<<<<<')
    expect(result.omittedPaths).toEqual([])
  })

  it('pins paginated history to an explicit commit even after HEAD changes', async () => {
    const { git, service } = fixture()
    git.commit('anchor.txt', 'anchor', 'anchor change')
    const head = git.gitOk(['rev-parse', 'HEAD']).trim()
    const first = await service.history({ sessionId: 's', anchor: head, limit: 1 })
    git.commit('later.txt', 'later', 'later change')
    const rest = await service.history({ sessionId: 's', anchor: head, skip: 1, limit: 500 })
    expect(first.commits[0]!.hash).toBe(head)
    expect(rest.commits.length).toBeGreaterThan(0)
    expect(rest.commits.every(commit => commit.subject !== 'later change')).toBe(true)
  })
})
