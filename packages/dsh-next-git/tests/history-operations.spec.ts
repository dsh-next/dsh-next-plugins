import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryOperations } from '../src/host/history-operations.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import type { HistoryRequest, HistorySource } from '../src/core/history-plan.ts'
import { createFixture, type GitFixture, type ScenarioName } from './git-fixture.ts'
const fixtures: GitFixture[] = []
afterEach(() => { for (const f of fixtures.splice(0)) f.dispose() })
function setup(scenario: ScenarioName = 'clean') {
  const f = createFixture(scenario); fixtures.push(f)
  const source = { cwd: f.dir }
  const runner = new GitRunner()
  const resolveRepo = async (s: HistorySource) => {
    const cwd = s.cwd ?? f.dir
    const gitDir = (await runner.runOk(['rev-parse','--absolute-git-dir'], cwd)).trim()
    const commonDir = (await runner.runOk(['rev-parse','--path-format=absolute','--git-common-dir'], cwd)).trim()
    const toplevel = (await runner.runOk(['rev-parse','--show-toplevel'], cwd)).trim()
    return {root:f.dir,toplevel,gitDir,commonDir,cwd}
  }
  return { f, source, runner, create: () => new HistoryOperations({runner,resolveRepo}) }
}
const approve = { approved:true, acknowledgePublishedHistory:true } as const
const head = (f: GitFixture): string => f.gitOk(['rev-parse','HEAD']).trim()
const subjects = (f: GitFixture): string[] => f.gitOk(['log','--reverse','--format=%s']).trim().split('\n')
async function apply(ops: HistoryOperations, source: HistorySource, req: HistoryRequest) {
  const preview = await ops.preview(source, req)
  const status = await ops.execute(source,preview.operationId,approve)
  expect(status.error).toBeNull()
  expect(status.phase).toBe('completed')
  return {preview,status}
}
function conflictSetup() {
  const context = setup()
  const {f} = context
  f.gitOk(['checkout','-q','-b','topic'])
  const a = f.commit('src/app.ts','topic\n','topic conflict')
  const b = f.commit('tail.txt','tail\n','tail')
  f.gitOk(['checkout','-q','main'])
  f.commit('src/app.ts','main\n','main conflict')
  return {...context,a,b}
}
function safetyState(f: GitFixture, operationId?: string) {
  return {
    head: head(f),
    ref: readFileSync(join(f.gitDir, 'HEAD')),
    index: readFileSync(join(f.gitDir, 'index')),
    refs: f.gitOk(['for-each-ref', '--format=%(refname) %(objectname)']),
    journal: operationId === undefined ? existsSync(join(f.gitDir, 'dsh-history')) : readFileSync(join(f.gitDir, 'dsh-history', operationId, 'journal.json')),
  }
}
function transientHistory(f: GitFixture, path = 'precious') {
  const added = f.commit(path, 'committed copy', 'add precious')
  f.gitOk(['rm', '--', path]); const removed = f.commitIndex('remove precious')
  writeFileSync(join(f.gitDir, 'info', 'exclude'), '*\n')
  return { added, removed }
}

describe('ignored data safety across history operations', () => {
  it.each([
    ['exact transient addition', 'precious', 'precious'],
    ['ignored descendant', 'precious', 'precious/only-copy'],
    ['ignored ancestor file', 'precious/child', 'precious'],
    ['literal newline', 'precious\n;$(touch INJECTED)', 'precious\n;$(touch INJECTED)'],
    ['case-insensitive exact path', 'Precious', 'precious'],
    ['case-insensitive ancestor', 'Precious/child', 'precious'],
    ['case-insensitive descendant', 'Precious', 'precious/only-copy'],
  ])('refuses %s before preview writes and preserves bytes, HEAD, index and refs', async (_label, tracked, untracked) => {
    const { f, source, create } = setup()
    f.gitOk(['config', 'core.ignorecase', 'true'])
    const { added } = transientHistory(f, tracked)
    f.write(untracked, 'ONLY COPY')
    expect(f.gitOk(['status', '--porcelain=v1'])).toBe('')
    const before = safetyState(f)
    await expect(create().preview(source, { action: 'reword', commits: [added], message: 'new' })).rejects.toMatchObject({ reason: 'ignored-path-collision' })
    expect(readFileSync(f.path(untracked), 'utf8')).toBe('ONLY COPY')
    expect(safetyState(f)).toEqual(before)
  })

  it.each(['reword', 'cherry-pick', 'revert'] as const)('revalidates ignored transient paths at %s execution without modifying its preview journal', async action => {
    const { f, source, create } = setup(); const original = head(f)
    const { added, removed } = transientHistory(f)
    if (action === 'cherry-pick') f.gitOk(['reset', '--hard', original])
    const commits = action === 'reword' ? [added] : action === 'cherry-pick' ? [added, removed] : [removed, added]
    const preview = await create().preview(source, { action, commits, ...(action === 'reword' ? { message: 'new' } : {}) })
    f.write('precious', 'ONLY COPY')
    const before = safetyState(f, preview.operationId)
    await expect(create().execute(source, preview.operationId, approve)).rejects.toMatchObject({ reason: 'ignored-path-collision' })
    expect(readFileSync(f.path('precious'), 'utf8')).toBe('ONLY COPY')
    expect(safetyState(f, preview.operationId)).toEqual(before)
    expect((await create().status(source, preview.operationId)).phase).toBe('preview')
  })

  it('allows noncolliding ignored siblings, ordinary node_modules and linked worktrees', async () => {
    const { f, source, create } = setup('worktrees')
    writeFileSync(join(f.gitDir, 'info', 'exclude'), '.worktrees/\nnode_modules/\nsrc/local-secret\n')
    f.write('node_modules/pkg/index.js', 'dependency')
    f.write('src/local-secret', 'ONLY COPY')
    await apply(create(), source, { action: 'reword', commits: [head(f)], message: 'new' })
    expect(readFileSync(f.path('src/local-secret'), 'utf8')).toBe('ONLY COPY')
    expect(readFileSync(f.path('node_modules/pkg/index.js'), 'utf8')).toBe('dependency')
    expect(existsSync(f.path('.worktrees/dirty/dirty.txt'))).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('protects an ignored ancestor symlink without following or removing it', async () => {
    const { f, source, create } = setup()
    const { added } = transientHistory(f, 'precious/child')
    const target = f.scratch('symlink-target'); writeFileSync(join(target, 'child'), 'ONLY COPY')
    symlinkSync(target, f.path('precious'), 'dir')
    const before = safetyState(f)
    await expect(create().preview(source, { action: 'reword', commits: [added], message: 'new' })).rejects.toMatchObject({ reason: 'ignored-path-collision' })
    expect(lstatSync(f.path('precious')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(f.path('precious'))).toBe(target)
    expect(readFileSync(join(target, 'child'), 'utf8')).toBe('ONLY COPY')
    expect(safetyState(f)).toEqual(before)
  })

  it.each(['continue', 'skip', 'abort'] as const)('protects ignored data created during a paused rebase before %s', async action => {
    const { f, source, create } = setup()
    const a = f.commit('ordered', 'A', 'A'), b = f.commit('ordered', 'B', 'B')
    transientHistory(f)
    const preview = await create().preview(source, { action: 'reorder', commits: [a, b], order: [b, a] })
    expect((await create().execute(source, preview.operationId, approve)).phase).toBe('stopped')
    if (action === 'continue') { f.write('ordered', 'resolved'); f.gitOk(['add', 'ordered']) }
    f.write('precious', 'ONLY COPY')
    const before = safetyState(f, preview.operationId)
    await expect(create().recover(source, preview.operationId, action === 'abort' ? { action, discardResolutionEdits: true } : { action })).rejects.toMatchObject({ reason: 'ignored-path-collision' })
    expect(readFileSync(f.path('precious'), 'utf8')).toBe('ONLY COPY')
    expect(safetyState(f, preview.operationId)).toEqual(before)
    expect((await create().status(source, preview.operationId)).phase).toBe('stopped')
  })

  it.each(['continue', 'skip', 'abort'] as const)('protects new ordinary untracked collisions during cherry-pick %s', async action => {
    const { f, source, create, a, b } = conflictSetup()
    const preview = await create().preview(source, { action: 'cherry-pick', commits: [a, b] })
    expect((await create().execute(source, preview.operationId, approve)).phase).toBe('stopped')
    if (action === 'continue') { f.write('src/app.ts', 'resolved'); f.gitOk(['add', 'src/app.ts']) }
    f.write('tail.txt', 'ONLY COPY')
    const before = safetyState(f, preview.operationId)
    await expect(create().recover(source, preview.operationId, action === 'abort' ? { action, discardResolutionEdits: true } : { action })).rejects.toMatchObject({ reason: 'ignored-path-collision' })
    expect(readFileSync(f.path('tail.txt'), 'utf8')).toBe('ONLY COPY')
    expect(safetyState(f, preview.operationId)).toEqual(before)
  })

  it.each([['precious', 'precious'], ['precious', 'precious/only-copy'], ['precious/child', 'precious']])('refuses restore of %s over %s before updating the ref or journal', async (tracked, untracked) => {
    const { f, source, create } = setup()
    const added = f.commit(tracked, 'committed copy', 'add precious')
    const { preview } = await apply(create(), source, { action: 'revert', commits: [added] })
    writeFileSync(join(f.gitDir, 'info', 'exclude'), 'precious\n')
    f.write(untracked, 'ONLY COPY')
    const before = safetyState(f, preview.operationId)
    await expect(create().recover(source, preview.operationId, { action: 'restore', approved: true })).rejects.toMatchObject({ reason: 'ignored-path-collision' })
    expect(readFileSync(f.path(untracked), 'utf8')).toBe('ONLY COPY')
    expect(safetyState(f, preview.operationId)).toEqual(before)
    f.remove(untracked)
    expect((await create().recover(source, preview.operationId, { action: 'restore', approved: true })).phase).toBe('recovered')
    expect(readFileSync(f.path(tracked), 'utf8')).toBe('committed copy')
  })
})

describe('ignored guard recovery and failure boundaries', () => {
  it.each(['continue', 'skip', 'abort'] as const)('rechecks new ignored data before paused revert %s', async action => {
    const { f, source, create } = setup()
    const conflict = f.commit('ordered', 'A', 'A'); f.commit('ordered', 'B', 'B')
    const { added, removed } = transientHistory(f)
    const preview = await create().preview(source, { action: 'revert', commits: [conflict, removed, added] })
    expect((await create().execute(source, preview.operationId, approve)).phase).toBe('stopped')
    if (action === 'continue') { f.write('ordered', 'resolved'); f.gitOk(['add', 'ordered']) }
    f.write('precious', 'ONLY COPY')
    const before = safetyState(f, preview.operationId)
    await expect(create().recover(source, preview.operationId, action === 'abort' ? { action, discardResolutionEdits: true } : { action })).rejects.toMatchObject({ reason: 'ignored-path-collision' })
    expect(readFileSync(f.path('precious'), 'utf8')).toBe('ONLY COPY')
    expect(safetyState(f, preview.operationId)).toEqual(before)
  })

  it('protects original-tree data during abort even when no remaining step adds it', async () => {
    const { f, source, create } = setup()
    f.commit('precious', 'committed copy', 'add precious')
    const a = f.commit('ordered', 'A', 'A'), b = f.commit('ordered', 'B', 'B')
    writeFileSync(join(f.gitDir, 'info', 'exclude'), 'precious\n')
    const preview = await create().preview(source, { action: 'reorder', commits: [a, b], order: [b, a] })
    expect((await create().execute(source, preview.operationId, approve)).phase).toBe('stopped')
    f.gitOk(['rm', '--cached', '--', 'precious'])
    f.write('precious', 'ONLY COPY')
    const before = safetyState(f, preview.operationId)
    await expect(create().recover(source, preview.operationId, { action: 'abort', discardResolutionEdits: true })).rejects.toMatchObject({ reason: 'ignored-path-collision' })
    expect(readFileSync(f.path('precious'), 'utf8')).toBe('ONLY COPY')
    expect(safetyState(f, preview.operationId)).toEqual(before)
  })

  it('fails closed before any journal/ref mutation when path enumeration fails', async () => {
    const { f, source, create, runner } = setup()
    const before = safetyState(f)
    vi.spyOn(runner, 'runBytesOk').mockRejectedValue(new Error('path enumeration failed'))
    await expect(create().preview(source, { action: 'reword', commits: [head(f)], message: 'new' })).rejects.toMatchObject({ reason: 'ignored-guard-unavailable', message: expect.stringContaining('path enumeration failed') })
    expect(safetyState(f)).toEqual(before)
  })

  it('allows distinct-case ignored data when core.ignorecase is false on a case-sensitive filesystem', async context => {
    const { f, source, create } = setup()
    const probe = f.scratch('case-probe'); writeFileSync(join(probe, 'lower'), '')
    if (existsSync(join(probe, 'LOWER'))) { context.skip(); return }
    f.gitOk(['config', 'core.ignorecase', 'false'])
    const { added } = transientHistory(f, 'Precious')
    f.write('precious', 'ONLY COPY')
    await apply(create(), source, { action: 'reword', commits: [added], message: 'new' })
    expect(readFileSync(f.path('precious'), 'utf8')).toBe('ONLY COPY')
  })
})

describe('durable history operations with real Git', () => {
  it('cherry-picks exact explicit order with one native batch and retains backup refs, not tags', async () => {
    const {f,source,create} = setup(); const base = head(f)
    f.gitOk(['checkout','-q','-b','topic'])
    const a=f.commit('a','a','A'), b=f.commit('b','b','B')
    f.gitOk(['checkout','-q','main'])
    const {preview,status}=await apply(create(),source,{action:'cherry-pick',commits:[b,a]})
    expect(subjects(f).slice(-2)).toEqual(['B','A'])
    expect(status.canRestore).toBe(true)
    expect(f.gitOk(['rev-parse',preview.backupRef]).trim()).toBe(base)
    expect(f.gitOk(['for-each-ref','refs/tags/'])).toBe('')
    expect((await create().status(source,preview.operationId)).completedHead).toBe(head(f))
    const dir=join(f.gitDir,'dsh-history',preview.operationId)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir,'journal.json')).mode & 0o777).toBe(0o600)
    expect((await create().recover(source,preview.operationId,{action:'restore',approved:true})).phase).toBe('recovered')
    expect(head(f)).toBe(base)
    expect(existsSync(f.path('a'))).toBe(false)
    expect(existsSync(f.path('b'))).toBe(false)
    expect(f.gitOk(['status','--porcelain=v1'])).toBe('')
  })
  it('batch reverts newest first, preserving explicit order', async () => {
    const {f,source,create}=setup()
    const a=f.commit('a','one','A'), b=f.commit('a','two','B')
    await apply(create(),source,{action:'revert',commits:[b,a]})
    expect(subjects(f).slice(-2)).toEqual(['Revert "B"','Revert "A"'])
    expect(existsSync(f.path('a'))).toBe(false)
  })
  it.each(['squash','fixup'] as const)('executes %s and replays descendants', async action => {
    const {f,source,create}=setup()
    const a=f.commit('a','a','A'), b=f.commit('b','b','B'), c=f.commit('c','c','C')
    const oldTree=f.gitOk(['rev-parse','HEAD^{tree}']).trim()
    const {preview}=await apply(create(),source,{action,commits:[b,a],message:'Combined'})
    expect(preview.plan.descendants).toEqual([c])
    expect(subjects(f).slice(-2)).toEqual([action==='squash'?'Combined':'A','C'])
    expect(f.gitOk(['rev-parse','HEAD^{tree}']).trim()).toBe(oldTree)
  })
  it('reorders a contiguous selection without dropping descendants', async () => {
    const {f,source,create}=setup()
    const a=f.commit('a','a','A'), b=f.commit('b','b','B'); f.commit('c','c','C')
    await apply(create(),source,{action:'reorder',commits:[a,b],order:[b,a]})
    expect(subjects(f).slice(-3)).toEqual(['B','A','C'])
  })
  it('rewords through private data files; message and path shell metacharacters are never commands', async () => {
    const original=setup(); const parent=original.f.scratch('path')
    const dir=join(parent,"space ' quote ; $(nope)"); mkdirSync(dir)
    const f=createFixture('clean',{dir}); fixtures.push(f)
    const runner=new GitRunner(); const source={cwd:dir}
    const ops=new HistoryOperations({runner,resolveRepo:async()=>({root:dir,toplevel:dir,cwd:dir,gitDir:f.gitDir,commonDir:f.gitDir})})
    const message='New subject\n\nexec touch INJECTED\n$(touch INJECTED); "quoted"'
    await apply(ops,source,{action:'reword',commits:[head(f)],message})
    expect(f.gitOk(['log','-1','--format=%B']).trim()).toBe(message)
    expect(existsSync(join(dir,'INJECTED'))).toBe(false)
  })
  it.each(['unknown','reachable'] as const)('requires explicit acknowledgment of %s publication for rewrites', async state => {
    const {f,source,create}=setup(); const ops=create()
    if(state==='reachable') f.gitOk(['update-ref','refs/remotes/origin/main',head(f)])
    const preview=await ops.preview(source,{action:'reword',commits:[head(f)],message:'new'})
    expect(preview.publication.state).toBe(state)
    await expect(ops.execute(source,preview.operationId,{approved:true})).rejects.toMatchObject({reason:'published-acknowledgment-required'})
    expect(f.git(['show-ref','--verify',preview.backupRef]).code).not.toBe(0)
    await expect(ops.execute(source,preview.operationId,approve)).resolves.toMatchObject({phase:'completed'})
  })
  it.each(['staged','unstaged','untracked','merge-conflict','rebase-conflict','cherry-pick-conflict'] as const)('refuses %s without overwriting state', async scenario => {
    const {f,source,create}=setup(scenario); const before=f.gitOk(['status','--porcelain=v1'])
    await expect(create().preview(source,{action:'revert',commits:[head(f)]})).rejects.toMatchObject({reason:scenario.includes('conflict')?'active-operation':'dirty-checkout'})
    expect(f.gitOk(['status','--porcelain=v1'])).toBe(before)
  })
  it.each(['--assume-unchanged','--skip-worktree'])('refuses tracked files hidden by %s', async flag => {
    const {f,source,create}=setup()
    f.gitOk(['update-index',flag,'src/app.ts']); f.write('src/app.ts','hidden precious edit\n')
    await expect(create().preview(source,{action:'revert',commits:[head(f)]})).rejects.toMatchObject({reason:'hidden-index-state'})
    expect(readFileSync(f.path('src/app.ts'),'utf8')).toBe('hidden precious edit\n')
  })
  it('revalidates dirt and HEAD after preview, within the shared mutation queue', async () => {
    const {f,source,create,runner}=setup(); const ops=create()
    const preview=await ops.preview(source,{action:'reword',commits:[head(f)],message:'new'})
    let release!:()=>void; let entered!:()=>void
    const acquired=new Promise<void>(r=>{entered=r}); const gate=new Promise<void>(r=>{release=r})
    const blocking=runner.mutate(f.gitDir,async()=>{entered();await gate; f.write('untracked','new')})
    await acquired
    const pending=ops.execute(source,preview.operationId,approve)
    release(); await blocking
    await expect(pending).rejects.toMatchObject({reason:'dirty-checkout'})
    f.remove('untracked'); f.commit('later','new','later')
    await expect(ops.execute(source,preview.operationId,approve)).rejects.toMatchObject({reason:'stale-preview'})
  })
  it('requires approval, supports preview cancellation and unique durable IDs', async () => {
    const {f,source,create}=setup(); const ops=create(); const req={action:'revert',commits:[head(f)]} as const
    const a=await ops.preview(source,req), b=await ops.preview(source,req)
    expect(a.operationId).not.toBe(b.operationId)
    await expect(ops.execute(source,a.operationId,{approved:false} as never)).rejects.toMatchObject({reason:'approval-required'})
    expect((await create().status(source,a.operationId)).phase).toBe('preview')
    expect((await create().recover(source,a.operationId,{action:'cancel'})).phase).toBe('cancelled')
    await expect(ops.execute(source,a.operationId,approve)).rejects.toMatchObject({reason:'already-started'})
    expect(f.git(['show-ref','--verify',a.backupRef]).code).not.toBe(0)
  })
  it('binds permission to source and checkout, not just shared git identity', async () => {
    const {f,source,create}=setup(); const ops=create()
    const preview=await ops.preview(source,{action:'revert',commits:[head(f)]})
    await expect(ops.status({...source,sessionId:'other'},preview.operationId)).rejects.toMatchObject({reason:'source-mismatch'})
    const linked=f.addWorktree('linked')
    await expect(ops.status({cwd:linked},preview.operationId)).rejects.toThrow()
    await expect(ops.status(source,'../../journal')).rejects.toMatchObject({reason:'invalid-operation-id'})
  })
  it('restores only recorded completed HEAD and retains journal and backup', async () => {
    const {f,source,create}=setup(); const ops=create(); const original=head(f)
    const {preview}=await apply(ops,source,{action:'reword',commits:[original],message:'new'})
    const restored=await create().recover(source,preview.operationId,{action:'restore',approved:true})
    expect(restored.phase).toBe('recovered'); expect(head(f)).toBe(original)
    expect(f.gitOk(['status','--porcelain=v1'])).toBe('')
    expect(f.gitOk(['rev-parse',preview.backupRef]).trim()).toBe(original)
    expect(existsSync(join(f.gitDir,'dsh-history',preview.operationId,'journal.json'))).toBe(true)
  })
  it('refuses restore over dirty files, another ref, or later committed work', async () => {
    const {f,source,create}=setup(); const ops=create()
    const {preview}=await apply(ops,source,{action:'reword',commits:[head(f)],message:'new'})
    f.write('keep','precious')
    await expect(ops.recover(source,preview.operationId,{action:'restore',approved:true})).rejects.toMatchObject({reason:'restore-refused'})
    f.remove('keep'); f.gitOk(['checkout','-q','-b','other'])
    await expect(ops.recover(source,preview.operationId,{action:'restore',approved:true})).rejects.toMatchObject({reason:'restore-refused'})
    f.gitOk(['checkout','-q','main']); const later=f.commit('later','keep','later')
    await expect(ops.recover(source,preview.operationId,{action:'restore',approved:true})).rejects.toMatchObject({reason:'restore-refused'})
    expect(head(f)).toBe(later)
  })
  it('failed cherry-pick is stopped with remaining steps, reloadable and abortable through Git', async () => {
    const {f,source,create,a,b}=conflictSetup(); const ops=create(); const original=head(f)
    const p=await ops.preview(source,{action:'cherry-pick',commits:[a,b]})
    const stopped=await ops.execute(source,p.operationId,approve)
    expect(stopped.phase).toBe('stopped'); expect(stopped.error).not.toBeNull()
    expect(stopped.native).toMatchObject({kind:'cherry-pick',owned:true,conflicts:['src/app.ts']})
    expect(stopped.native.remaining.join(' ')).toContain(b.slice(0,7))
    expect((await create().status(source,p.operationId)).phase).toBe('stopped')
    await expect(ops.recover(source,p.operationId,{action:'cancel'})).rejects.toMatchObject({reason:'native-abort-required'})
    expect((await create().recover(source,p.operationId,{action:'abort',discardResolutionEdits:true})).phase).toBe('aborted')
    expect(head(f)).toBe(original)
  })
  it.each(['continue','skip'] as const)('uses native %s after a batch conflict', async action => {
    const {f,source,create,a,b}=conflictSetup(); const ops=create()
    const p=await ops.preview(source,{action:'cherry-pick',commits:[a,b]})
    await ops.execute(source,p.operationId,approve)
    if(action==='continue') { f.write('src/app.ts','resolved\n'); f.gitOk(['add','src/app.ts']) }
    const result=await create().recover(source,p.operationId,{action})
    expect(result.phase).toBe('completed'); expect(result.error).toBeNull()
    expect(subjects(f).at(-1)).toBe('tail')
    expect(readFileSync(f.path('src/app.ts'),'utf8')).toBe(action==='continue'?'resolved\n':'main\n')
  })
  it('recognizes external native abort without inferring unrecorded completion', async () => {
    const {f,source,create,a,b}=conflictSetup(); const ops=create()
    const p=await ops.preview(source,{action:'cherry-pick',commits:[a,b]})
    await ops.execute(source,p.operationId,approve)
    f.gitOk(['cherry-pick','--abort'])
    expect((await create().status(source,p.operationId)).phase).toBe('aborted')
    await expect(ops.recover(source,p.operationId,{action:'continue'})).rejects.toMatchObject({reason:'operation-mismatch'})
  })
  it('reloads uncertain crash journals without replaying or enabling unsafe restore', async () => {
    const {f,source,create}=setup(); const ops=create()
    const {preview}=await apply(ops,source,{action:'reword',commits:[head(f)],message:'new'})
    const path=join(f.gitDir,'dsh-history',preview.operationId,'journal.json')
    const journal=JSON.parse(readFileSync(path,'utf8')); journal.phase='running'; journal.completedHead=null; writeFileSync(path,JSON.stringify(journal))
    expect(await create().status(source,preview.operationId)).toMatchObject({phase:'interrupted',canRestore:false})
    await expect(create().execute(source,preview.operationId,approve)).rejects.toMatchObject({reason:'already-started'})
  })
  it.each(['--upload-pack=touch','HEAD~1','HEAD:src/app.ts','x\nexec touch INJECTED','$(touch INJECTED)'])('rejects unsafe ref %s', async ref => {
    const {f,source,create}=setup()
    await expect(create().preview(source,{action:'revert',commits:[ref]})).rejects.toMatchObject({reason:'invalid-ref'})
    expect(existsSync(f.path('INJECTED'))).toBe(false)
  })
  it('resolves valid shell-looking ref names strictly as arguments', async () => {
    const {f,source,create}=setup(); const name='refs/heads/evil;echo-pwned'
    f.gitOk(['update-ref',name,head(f)])
    const preview=await create().preview(source,{action:'revert',commits:[name]})
    expect(preview.plan.selected).toEqual([head(f)])
  })
  it.each(['continue','abort'] as const)('resumes or aborts a native rebase conflict with %s', async action => {
    const {f,source,create}=setup(); const ops=create()
    const a=f.commit('ordered','A\n','A'), b=f.commit('ordered','B\n','B')
    const p=await ops.preview(source,{action:'reorder',commits:[a,b],order:[b,a]})
    const stopped=await ops.execute(source,p.operationId,approve)
    expect(stopped.phase).toBe('stopped')
    expect(stopped.native).toMatchObject({kind:'rebase',owned:true})
    if(action==='abort') {
      expect((await create().recover(source,p.operationId,{action:'abort',discardResolutionEdits:true})).phase).toBe('aborted')
      expect(head(f)).toBe(b)
    } else {
      f.write('ordered','B\n'); f.gitOk(['add','ordered'])
      const next=await create().recover(source,p.operationId,{action:'continue'})
      expect(next.phase).toBe('stopped')
      f.write('ordered','A\n'); f.gitOk(['add','ordered'])
      expect((await create().recover(source,p.operationId,{action:'continue'})).phase).toBe('completed')
      expect(subjects(f).slice(-2)).toEqual(['B','A'])
    }
  })
  it('keeps revert conflict native and supports skip', async () => {
    const {f,source,create}=setup(); const ops=create()
    const a=f.commit('ordered','A\n','A'); f.commit('ordered','B\n','B')
    const p=await ops.preview(source,{action:'revert',commits:[a]})
    const stopped=await ops.execute(source,p.operationId,approve)
    expect(stopped).toMatchObject({phase:'stopped',native:{kind:'revert',owned:true}})
    expect((await create().recover(source,p.operationId,{action:'skip'})).phase).toBe('completed')
  })
  it('does not claim a new native operation after the original was aborted externally', async () => {
    const {f,source,create,a,b}=conflictSetup(); const ops=create()
    const p=await ops.preview(source,{action:'cherry-pick',commits:[a,b]})
    await ops.execute(source,p.operationId,approve)
    f.gitOk(['cherry-pick','--abort']); f.git(['cherry-pick',a,b])
    expect((await create().status(source,p.operationId)).native.owned).toBe(false)
    await expect(ops.recover(source,p.operationId,{action:'abort',discardResolutionEdits:true})).rejects.toMatchObject({reason:'operation-mismatch'})
    f.gitOk(['cherry-pick','--abort'])
  })
  it('keeps external Continue completion uncertain rather than overwriting possible later work', async () => {
    const {f,source,create,a,b}=conflictSetup(); const ops=create()
    const p=await ops.preview(source,{action:'cherry-pick',commits:[a,b]})
    await ops.execute(source,p.operationId,approve)
    f.write('src/app.ts','resolved\n'); f.gitOk(['add','src/app.ts']); f.gitOk(['cherry-pick','--continue'])
    expect(await create().status(source,p.operationId)).toMatchObject({phase:'interrupted',canRestore:false})
    await expect(ops.recover(source,p.operationId,{action:'restore',approved:true})).rejects.toMatchObject({reason:'restore-refused'})
  })
  it('uses per-worktree gitDir journals and never rewrites the primary checkout', async () => {
    const {f,create}=setup(); const original=head(f)
    const linked=f.addWorktree('linked')
    const source={cwd:linked}
    const {preview}=await apply(create(),source,{action:'reword',commits:[original],message:'linked only'})
    expect(preview.binding.gitDir).not.toBe(f.gitDir)
    expect(preview.otherCheckouts).toContainEqual({checkout:f.dir,headRef:'refs/heads/main'})
    expect(existsSync(join(preview.binding.gitDir,'dsh-history',preview.operationId,'journal.json'))).toBe(true)
    expect(head(f)).toBe(original)
    expect(f.gitOk(['-C',linked,'log','-1','--format=%s']).trim()).toBe('linked only')
  })
  it('refuses a branch checked out elsewhere, including after preview', async () => {
    const {f,source,create}=setup(); const ops=create()
    const req={action:'reword',commits:[head(f)],message:'new'} as const
    const p=await ops.preview(source,req)
    const elsewhere=join(f.scratch('shared-branch'),'linked')
    f.gitOk(['worktree','add','--force',elsewhere,'main'])
    await expect(ops.preview(source,req)).rejects.toMatchObject({reason:'branch-checked-out-elsewhere'})
    const state=await ops.execute(source,p.operationId,approve)
    expect(state.phase).toBe('failed'); expect(state.error).toContain('checked out elsewhere')
    expect(head(f)).toBe(p.binding.head)
  })
  it('restores detached HEAD without moving any branch', async () => {
    const {f,source,create}=setup('detached'); const original=head(f); const ops=create()
    const {preview}=await apply(ops,source,{action:'reword',commits:[original],message:'detached'})
    expect(preview.binding.headRef).toBeNull()
    expect((await create().recover(source,preview.operationId,{action:'restore',approved:true})).phase).toBe('recovered')
    expect(head(f)).toBe(original)
    expect(f.gitOk(['rev-parse','main']).trim()).toBe(original)
  })
  it('rejects ambiguous ref names without guessing', async () => {
    const {f,source,create}=setup()
    f.gitOk(['update-ref','refs/heads/ambiguous',head(f)])
    f.gitOk(['update-ref','refs/remotes/ambiguous',head(f)])
    await expect(create().preview(source,{action:'revert',commits:['ambiguous']})).rejects.toMatchObject({reason:'invalid-ref'})
  })
  it('rejects modified journal command data rather than executing arbitrary todo commands', async () => {
    const {f,source,create}=setup(); const ops=create()
    const p=await ops.preview(source,{action:'reword',commits:[head(f)],message:'new'})
    const path=join(f.gitDir,'dsh-history',p.operationId,'journal.json')
    const journal=JSON.parse(readFileSync(path,'utf8'))
    journal.preview.plan.steps[0].kind='exec touch INJECTED'
    writeFileSync(path,JSON.stringify(journal))
    await expect(ops.execute(source,p.operationId,approve)).rejects.toMatchObject({reason:'invalid-journal'})
    expect(existsSync(f.path('INJECTED'))).toBe(false)
  })
  it('rejects root, merge, noncontiguous and off-branch rewrite topology', async () => {
    const {f,source,create}=setup(); const ops=create(); const root=f.gitOk(['rev-list','--max-parents=0','HEAD']).trim()
    await expect(ops.preview(source,{action:'revert',commits:[root]})).rejects.toMatchObject({reason:'root-unsupported'})
    const a=head(f), b=f.commit('b','b','B'), c=f.commit('c','c','C')
    await expect(ops.preview(source,{action:'squash',commits:[a,c],message:'x'})).rejects.toMatchObject({reason:'noncontiguous-selection'})
    f.gitOk(['checkout','-q','-b','side',b]); const side=f.commit('side','x','Side'); f.gitOk(['checkout','-q','main'])
    await expect(ops.preview(source,{action:'reword',commits:[side],message:'x'})).rejects.toMatchObject({reason:'not-current-history'})
    f.gitOk(['merge','--no-ff','--no-edit','side'])
    await expect(ops.preview(source,{action:'reword',commits:[a],message:'x'})).rejects.toMatchObject({reason:'merge-unsupported'})
    await expect(ops.preview(source,{action:'revert',commits:[head(f)]})).rejects.toMatchObject({reason:'merge-unsupported'})
  })
})
