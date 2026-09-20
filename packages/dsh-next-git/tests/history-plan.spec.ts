import { describe, expect, it } from 'vitest'
import { defaultHistoryOrder, isHistoryOid, planHistory } from '../src/core/history-plan.ts'
import type { HistoryAction, HistoryCommit, HistoryRequest } from '../src/core/history-plan.ts'
const oid = (n: number): string => n.toString(16).padStart(40, '0')
const commit = (n: number, parents = [oid(n - 1)]): HistoryCommit => ({ oid: oid(n), parents, subject: String(n) })
const history = [commit(1, []), commit(2), commit(3), commit(4), commit(5)]
const request = (action: HistoryAction, commits: readonly HistoryCommit[], extra: Partial<HistoryRequest> = {}): HistoryRequest => ({ action, commits: commits.map(c => c.oid), ...extra })
describe('history plan', () => {
  it('defaults cherry-pick oldest first and revert newest first without mutating input', () => {
    const ids = [oid(2), oid(3)]
    expect(defaultHistoryOrder('cherry-pick', ids)).toEqual(ids)
    expect(defaultHistoryOrder('revert', ids)).toEqual([...ids].reverse())
    expect(ids).toEqual([oid(2), oid(3)])
  })
  it('recognizes only full SHA1 and SHA256 OIDs', () => {
    expect(isHistoryOid(oid(1))).toBe(true)
    expect(isHistoryOid('a'.repeat(64))).toBe(true)
    for (const value of ['HEAD', '-x', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(41)]) expect(isHistoryOid(value)).toBe(false)
  })
  it.each(['cherry-pick', 'revert'] as const)('preserves explicit %s order', action => {
    const selected = [commit(4), commit(2)]
    expect(planHistory(request(action, selected), selected, history)).toMatchObject({ eligible: true, ordered: [oid(4), oid(2)], rewrites: false, base: null })
  })
  it.each(['squash', 'fixup'] as const)('plans %s and every descendant without flattening', action => {
    const selected = [commit(3), commit(2)]
    const plan = planHistory(request(action, selected, { message: 'combined' }), selected, history)
    expect(plan).toMatchObject({ eligible: true, selected: [oid(2), oid(3)], base: oid(1), affected: [oid(2), oid(3), oid(4), oid(5)], descendants: [oid(4), oid(5)] })
    if (!plan.eligible) throw new Error('expected plan')
    expect(plan.steps.map(s => s.kind)).toEqual(action === 'fixup' ? ['pick', 'fixup', 'pick', 'pick'] : ['pick', 'fixup', 'message', 'pick', 'pick'])
    expect(plan.message).toBe(action === 'fixup' ? null : 'combined')
  })
  it('reorders only selected range, replaying descendants afterwards', () => {
    const selected = [commit(2), commit(3)]
    const plan = planHistory(request('reorder', selected, { order: [oid(3), oid(2)] }), selected, history)
    expect(plan).toMatchObject({ eligible: true, ordered: [oid(3), oid(2)], steps: [{kind:'pick',oid:oid(3)}, {kind:'pick',oid:oid(2)}, {kind:'pick',oid:oid(4)}, {kind:'pick',oid:oid(5)}] })
  })
  it('keeps hostile message bytes as data', () => {
    const message = 'hello\nexec touch /tmp/never\n$(echo no); quoted'
    expect(planHistory(request('reword', [commit(3)], { message }), [commit(3)], history)).toMatchObject({ eligible: true, message, descendants: [oid(4),oid(5)] })
  })
  const rejects: [string, HistoryRequest, HistoryCommit[], HistoryCommit[], string][] = [
    ['empty', request('revert', []), [], history, 'empty-selection'],
    ['limit', request('revert', []), Array.from({length:101}, (_,i)=>commit(i+2)), history, 'too-many-commits'],
    ['OID', request('revert', []), [{...commit(2),oid:'--evil'}], history, 'invalid-oid'],
    ['duplicate', request('revert', []), [commit(2),commit(2)], history, 'duplicate-commit'],
    ['merge', request('revert', []), [commit(2,[oid(1),oid(9)])], history, 'merge-unsupported'],
    ['root', request('revert', []), [commit(1,[])], history, 'root-unsupported'],
    ['unknown action', {action:'exec' as HistoryAction, commits:[]}, [commit(2)], history, 'unsupported-action'],
    ['off branch', request('reword', []), [commit(9)], history, 'not-current-history'],
    ['gap', request('squash', [], {message:'x'}), [commit(2),commit(4)], history, 'noncontiguous-selection'],
    ['many rewords', request('reword', [], {message:'x'}), [commit(2),commit(3)], history, 'invalid-order'],
    ['one squash', request('squash', [], {message:'x'}), [commit(2)], history, 'invalid-order'],
    ['descendant merge', request('reword', [], {message:'x'}), [commit(2)], [...history.slice(0,3), commit(4,[oid(3),oid(8)])], 'merge-unsupported'],
    ['ambiguous', request('reword', [], {message:'x'}), [commit(2)], [commit(2),commit(4)], 'ambiguous-topology'],
    ['missing order', request('reorder', []), [commit(2),commit(3)], history, 'invalid-order'],
    ['duplicate order', request('reorder', [], {order:[oid(2),oid(2)]}), [commit(2),commit(3)], history, 'invalid-order'],
    ['foreign order', request('reorder', [], {order:[oid(2),oid(9)]}), [commit(2),commit(3)], history, 'invalid-order'],
  ]
  it.each(rejects)('rejects %s with a clear reason', (_name, req, selected, current, reason) => {
    expect(planHistory(req, selected, current)).toMatchObject({eligible:false, reason, detail:expect.any(String)})
  })
  it.each([undefined, '', '  ', 'bad\0message', 'x'.repeat(65537)])('rejects invalid message %#', message => {
    const req: HistoryRequest = { action:'reword', commits:[oid(2)], ...(message === undefined ? {} : { message }) }
    expect(planHistory(req, [commit(2)], history)).toMatchObject({eligible:false, reason:'invalid-message'})
  })
})
