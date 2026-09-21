import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { isHistoryOid, type HistoryPlan } from '../core/history-plan.ts'
import { GitRunner } from './git-runner.ts'

/** These actions change commit identity, never the checkout's final tree. */
export function preservesHistoryTree(action: string): boolean {
  return action === 'squash' || action === 'fixup' || action === 'reword'
}

/** Construct unreachable objects only. Publishing the result is the caller's CAS responsibility.
 * Raw object plumbing (rather than commit-tree's environment-based identities) preserves original
 * author/committer timestamps, encoding and message bytes without expanding GitRunner's spawn API.
 * Invalidated signatures are removed, as with native rebase. No index, checkout or hook is used.
 */
export async function rewriteHistoryTree(runner: GitRunner, cwd: string, directory: string, plan: HistoryPlan, originalHead: string, originalTree: string): Promise<string> {
  if (!preservesHistoryTree(plan.action) || plan.base === null || plan.selected.length === 0
    || plan.affected.join() !== [...plan.selected, ...plan.descendants].join()
    || plan.affected.at(-1) !== originalHead || plan.ordered.join() !== plan.selected.join()) throw new Error('Invalid tree-preserving history plan.')
  const commits = []
  let previous = plan.base
  for (const oid of plan.affected) {
    const raw = Buffer.from(await runner.runBytesOk(['cat-file', 'commit', oid], cwd))
    const separator = raw.indexOf('\n\n')
    if (separator < 0) throw new Error('Invalid commit object.')
    const headers = raw.subarray(0, separator).toString('latin1').split(/\n(?! )/)
    const parents = headers.filter(header => header.startsWith('parent '))
    const tree = headers.find(header => header.startsWith('tree '))?.slice(5)
    if (parents.length !== 1 || parents[0] !== 'parent ' + previous || !tree || !isHistoryOid(tree)) throw new Error('History parent chain changed or is not linear.')
    commits.push({ headers, tree, message: raw.subarray(separator + 2) })
    previous = oid
  }
  if (commits.at(-1)!.tree !== originalTree) throw new Error('History final tree does not match the approved preview.')
  let parent = plan.base
  const retained = [0, ...plan.descendants.map((_, index) => plan.selected.length + index)]
  for (const index of retained) {
    const commit = commits[index]!
    const replacementMessage = index === 0 && plan.action !== 'fixup'
    const tree = index === 0 ? commits[plan.selected.length - 1]!.tree : commit.tree
    const headers = commit.headers.filter(header => !/^(tree|parent|gpgsig|gpgsig-sha256|mergetag) /.test(header)
      && !(replacementMessage && header.startsWith('encoding ')))
    const message = replacementMessage ? Buffer.from(plan.message ?? '', 'utf8') : commit.message
    const object = Buffer.concat([Buffer.from(['tree ' + tree, 'parent ' + parent, ...headers].join('\n') + '\n\n', 'latin1'), message])
    const path = join(directory, 'commit-' + index)
    const file = await open(path, 'wx', 0o600)
    try { await file.writeFile(object) } finally { await file.close() }
    parent = (await runner.runOk(['hash-object', '-t', 'commit', '-w', '--', path], cwd)).trim()
    if (!isHistoryOid(parent)) throw new Error('Git returned an invalid rewritten commit identity.')
  }
  if ((await runner.runOk(['rev-parse', parent + '^{tree}'], cwd)).trim() !== originalTree) throw new Error('Rewritten history changed the final tree.')
  return parent
}
