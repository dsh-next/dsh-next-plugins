import { afterEach, describe, expect, it } from 'vitest'
import { createFixture, FIXTURE_AUTHOR, type GitFixture, type ScenarioName } from './git-fixture.ts'
import { GitService } from '../src/host/git-service.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import { nodeFs } from '../src/host/fs-adapter.ts'

const fixtures: GitFixture[] = []
afterEach(() => { fixtures.splice(0).forEach(fixture => fixture.dispose()) })
function setup(scenario: ScenarioName = 'clean'): { fixture: GitFixture; service: GitService } {
  const fixture = createFixture(scenario)
  fixtures.push(fixture)
  return { fixture, service: new GitService({ runner: new GitRunner(), fs: nodeFs(), cwdOf: () => fixture.dir, platform: process.platform, env: process.env }) }
}
const trailer = `Signed-off-by: ${FIXTURE_AUTHOR.name} <${FIXTURE_AUTHOR.email}>`

describe('commit sign-off variants', () => {
  it.each(['commit', 'commitAll'] as const)('%s refuses an amend whose reviewed HEAD moved', async method => {
    const { fixture, service } = setup()
    const expectedHead = fixture.gitOk(['rev-parse', 'HEAD']).trim()
    fixture.gitOk(['commit', '--allow-empty', '-m', 'external commit'])
    fixture.write('new.txt', 'untracked\n')
    const head = fixture.gitOk(['rev-parse', 'HEAD']), index = fixture.gitOk(['write-tree'])
    await expect(service[method]({ sessionId: 's', message: 'wrong amendment', amend: true, expectedHead })).rejects.toMatchObject({ failure: { code: 'dirty-tree' } })
    expect(fixture.gitOk(['rev-parse', 'HEAD'])).toBe(head)
    expect(fixture.gitOk(['write-tree'])).toBe(index)
  })
  it.each(['commit', 'commitAll'] as const)('%s signs off without bypassing staged/all semantics', async method => {
    const { fixture, service } = setup()
    fixture.write('staged.txt', 'index\n'); fixture.gitOk(['add', 'staged.txt'])
    fixture.write('unstaged.txt', 'worktree\n')
    await service[method]({ sessionId: 's', message: '--signoff is literal subject\n\nBody', signoff: true })
    expect(fixture.gitOk(['log', '-1', '--format=%B'])).toContain('--signoff is literal subject\n\nBody\n\n' + trailer)
    expect(fixture.gitOk(['show', 'HEAD:staged.txt'])).toBe('index\n')
    expect(fixture.git(['cat-file', '-e', 'HEAD:unstaged.txt']).code === 0).toBe(method === 'commitAll')
  })
  it.each(['commit', 'commitAll'] as const)('%s amends the prior commit with sign-off and the correct tree', async method => {
    const { fixture, service } = setup()
    const count = fixture.gitOk(['rev-list', '--count', 'HEAD'])
    fixture.write('staged.txt', 'index\n'); fixture.gitOk(['add', 'staged.txt'])
    fixture.write('staged.txt', 'working\n')
    fixture.write('new.txt', 'untracked\n')
    await service[method]({ sessionId: 's', message: 'Amended\n\nFull body', signoff: true, amend: true })
    expect(fixture.gitOk(['rev-list', '--count', 'HEAD'])).toBe(count)
    expect(fixture.gitOk(['log', '-1', '--format=%B'])).toContain('Amended\n\nFull body\n\n' + trailer)
    expect(fixture.gitOk(['show', 'HEAD:staged.txt'])).toBe(method === 'commitAll' ? 'working\n' : 'index\n')
    expect(fixture.git(['cat-file', '-e', 'HEAD:new.txt']).code === 0).toBe(method === 'commitAll')
  })
  it('allows an index-empty amend and leaves sign-off optional', async () => {
    const { fixture, service } = setup()
    await service.commit({ sessionId: 's', message: 'Only message changed', amend: true, signoff: false })
    expect(fixture.gitOk(['log', '-1', '--format=%B'])).toBe('Only message changed\n\n')
    await service.commit({ sessionId: 's', message: 'Signed amend', amend: true, signoff: true })
    expect(fixture.gitOk(['log', '-1', '--format=%B'])).toContain(trailer)
  })
  it.each(['commit', 'commitAll'] as const)('%s preserves hook failures and index rollback', async method => {
    const { fixture, service } = setup('hook-fail')
    fixture.write('extra.txt', 'not staged\n')
    const tree = fixture.gitOk(['write-tree']), head = fixture.gitOk(['rev-parse', 'HEAD'])
    await expect(service[method]({ sessionId: 's', message: 'Blocked', signoff: true, amend: true })).rejects.toMatchObject({ failure: { code: 'hook-failed' } })
    expect(fixture.gitOk(['write-tree'])).toBe(tree)
    expect(fixture.gitOk(['rev-parse', 'HEAD'])).toBe(head)
  })
  it('retains empty-message, empty-index and unresolved-conflict errors', async () => {
    const clean = setup()
    await expect(clean.service.commit({ sessionId: 's', message: ' ', signoff: true })).rejects.toMatchObject({ failure: { code: 'nothing-to-commit' } })
    await expect(clean.service.commit({ sessionId: 's', message: 'Empty', signoff: true })).rejects.toMatchObject({ failure: { code: 'nothing-to-commit' } })
    const conflict = setup('merge-conflict')
    await expect(conflict.service.commitAll({ sessionId: 's', message: 'Unsafe', signoff: true })).rejects.toMatchObject({ failure: { code: 'operation-in-progress' } })
  })
})
