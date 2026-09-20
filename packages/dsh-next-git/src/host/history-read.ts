import { applyNumstat, parseNumstat, parseUnifiedDiff } from '../core/diff.ts'
import { LOG_FORMAT, parseLog } from '../core/log.ts'
import type { AgentCommitContext } from '../core/agent-history.ts'
import { isHistoryOid, type HistorySource } from '../core/history-plan.ts'
import type { CommitComparison, CommitDetails, CommitFile } from '../core/history-view.ts'
import type { DiffResult } from '../core/types.ts'
import { isUnsafeRelativePath } from '../core/worktree.ts'
import { GitError, type GitRunner, STATUS_TIMEOUT_MS } from './git-runner.ts'
import type { RepoRef } from './git-service.ts'

interface HistoryReadPorts {
  readonly runner: GitRunner
  readonly resolveRepo: (source: HistorySource) => Promise<RepoRef>
}

/** Immutable commit inspection; merge diffs explicitly use the first parent. */
export class HistoryRead {
  constructor(private readonly ports: HistoryReadPorts) {}

  private async commit(source: HistorySource, hash: string) {
    if (!isHistoryOid(hash)) throw new GitError({ code: 'invalid-name', detail: 'Select a full commit ID' })
    const repo = await this.ports.resolveRepo(source)
    const oid = (await this.ports.runner.runOk(['rev-parse', '--verify', '--end-of-options', hash + '^{commit}'], repo.toplevel)).trim()
    const raw = await this.ports.runner.runOk(['log', '-1', '-z', '--format=' + LOG_FORMAT, oid, '--'], repo.toplevel)
    const commit = parseLog(raw)[0]
    if (!commit) throw new GitError({ code: 'path-missing', detail: 'Commit is unavailable' })
    return { repo, commit, parent: commit.parents[0] ?? null }
  }

  private diffArgs(hash: string, parent: string | null): string[] {
    return parent === null ? ['show', '--format=', '--root', hash] : ['diff', parent, hash]
  }

  async inspect(source: HistorySource, hash: string): Promise<CommitDetails> {
    const { repo, commit, parent } = await this.commit(source, hash)
    const [message, names] = await Promise.all([
      this.ports.runner.runOk(['show', '-s', '--format=%B', commit.hash, '--'], repo.toplevel),
      this.ports.runner.runOk([...this.diffArgs(commit.hash, parent), '--name-status', '-z', '-M', '--'], repo.toplevel, { timeoutMs: STATUS_TIMEOUT_MS }),
    ])
    const tokens = names.split('\0')
    const files: CommitFile[] = []
    for (let i = 0; i < tokens.length;) {
      const status = tokens[i++]!
      if (!status) continue
      const first = tokens[i++]
      if (first === undefined) break
      if (/^[RC]/.test(status)) {
        const path = tokens[i++]
        if (path !== undefined) files.push({ path, oldPath: first, status })
      } else files.push({ path: first, status })
    }
    return { commit, parent, message: message.trimEnd(), files }
  }

  async diff(source: HistorySource, hash: string, path: string, oldPath?: string): Promise<DiffResult> {
    const paths = oldPath === undefined ? [path] : [oldPath, path]
    if (paths.some(value => !value || isUnsafeRelativePath(value) || value.split('/').some(part => part.toLowerCase() === '.git'))) {
      throw new GitError({ code: 'path-missing', detail: 'Invalid commit path' })
    }
    const { repo, commit, parent } = await this.commit(source, hash)
    const base = this.diffArgs(commit.hash, parent)
    const literal = ['--', ...paths.map(value => ':(literal)' + value)]
    const [patch, numstat] = await Promise.all([
      this.ports.runner.runOk([...base, '-M', ...literal], repo.toplevel, { timeoutMs: STATUS_TIMEOUT_MS }),
      this.ports.runner.runOk([...base, '--numstat', '-z', '-M', ...literal], repo.toplevel, { timeoutMs: STATUS_TIMEOUT_MS }),
    ])
    const files = applyNumstat(parseUnifiedDiff(patch), parseNumstat(numstat))
    const file = files.find(item => item.path === path) ?? files[0] ?? null
    return { path, side: 'unstaged', file, empty: file === null }
  }

  async context(source: HistorySource, hashes: readonly string[]): Promise<{ commits: AgentCommitContext[]; omittedCommits: string[] }> {
    if (hashes.length > 100 || hashes.some(hash => !isHistoryOid(hash)) || new Set(hashes).size !== hashes.length) {
      throw new GitError({ code: 'invalid-name', detail: 'Choose up to 100 distinct commit IDs' })
    }
    const commits: AgentCommitContext[] = []
    for (const hash of hashes.slice(0, 20)) {
      const { repo, commit, parent } = await this.commit(source, hash)
      const [message, patch] = await Promise.all([
        this.ports.runner.runOk(['show', '-s', '--format=%B', commit.hash, '--'], repo.toplevel),
        this.ports.runner.runOk([...this.diffArgs(commit.hash, parent), '--'], repo.toplevel, { timeoutMs: STATUS_TIMEOUT_MS }),
      ])
      commits.push({ hash: commit.hash, subject: commit.subject, message: message.slice(0, 2000), patch: patch.slice(0, 8000), patchTruncated: patch.length > 8000 || message.length > 2000 })
    }
    return { commits, omittedCommits: hashes.slice(20) }
  }

  async compare(source: HistorySource, from: string, to: string): Promise<CommitComparison> {
    const before = await this.commit(source, from)
    const after = await this.commit(source, to)
    if (before.repo.toplevel !== after.repo.toplevel) throw new GitError({ code: 'dirty-tree', detail: 'Checkout changed during comparison' })
    const args = ['diff', before.commit.hash, after.commit.hash]
    const [summary, patch] = await Promise.all([
      this.ports.runner.runOk([...args, '--stat', '--'], before.repo.toplevel, { timeoutMs: STATUS_TIMEOUT_MS }),
      this.ports.runner.runOk([...args, '--'], before.repo.toplevel, { timeoutMs: STATUS_TIMEOUT_MS }),
    ])
    const cap = 128_000
    return { from: before.commit.hash, to: after.commit.hash, summary, patch: patch.slice(0, cap), truncated: patch.length > cap }
  }
}
