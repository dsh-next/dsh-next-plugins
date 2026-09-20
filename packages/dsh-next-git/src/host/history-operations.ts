import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { parseWorktreeList } from '../core/worktree.ts'
import { isHistoryOid, planHistory } from '../core/history-plan.ts'
import type { HistoryApproval, HistoryBinding, HistoryCommit, HistoryNativeState, HistoryPhase, HistoryPreview, HistoryPublication, HistoryRecovery, HistoryRequest, HistorySource, HistoryStatus } from '../core/history-plan.ts'
import { GitRunner, WRITE_TIMEOUT_MS } from './git-runner.ts'
import type { RepoRef } from './git-service.ts'
import { findUntrackedCollision } from './ignored-guard.ts'

export interface HistoryOperationsPorts {
  readonly runner: GitRunner
  /** Must enforce the caller's source/session authorization; never resolve a client-supplied RepoRef. */
  readonly resolveRepo: (source: HistorySource) => Promise<RepoRef>
}
export class HistoryOperationError extends Error {
  constructor(readonly reason: string, message: string) { super(message); this.name = 'HistoryOperationError' }
}
interface Journal {
  version: 1
  preview: HistoryPreview
  phase: HistoryPhase
  completedHead: string | null
  error: string | null
  approved: boolean
  /** Filesystem identity of the native sequencer: prevents adopting a replacement operation. */
  nativeAnchor: string | null
}
interface Snapshot { head: string; headRef: string | null; clean: boolean; hiddenIndexState: boolean; native: HistoryNativeState }
const emptyNative: HistoryNativeState = { kind: null, remaining: [], conflicts: [], owned: false }
const sourceKey = (s: HistorySource): string => JSON.stringify([s.sessionId ?? null, s.cwd ?? null])
const quote = (s: string): string => "'" + s.replaceAll("'", "'\"'\"'") + "'"
function fail(reason: string, message: string): never { throw new HistoryOperationError(reason, message) }

/** Durable, checkout-scoped plans. The shared runner queue coordinates only callers using that runner.
 * External Git processes still rely on Git locks; every entry revalidates observed checkout state.
 * No fetch, push, tags, user-provided shell commands, auto-stash, or dirty-tree reset is performed.
 */
export class HistoryOperations {
  constructor(private readonly ports: HistoryOperationsPorts) {}

  async preview(source: HistorySource, request: HistoryRequest): Promise<HistoryPreview> {
    return this.scoped(source, async repo => {
      const state = await this.snapshot(repo)
      this.requireClean(state)
      if (!Array.isArray(request.commits) || request.commits.length === 0 || request.commits.length > 100) fail('invalid-selection', 'Select between 1 and 100 commits.')
      if (request.order !== undefined && (!Array.isArray(request.order) || request.order.length > 100)) fail('invalid-order', 'The ordered selection must contain at most 100 commit refs.')
      const selected: HistoryCommit[] = []
      for (const ref of request.commits) selected.push(await this.commit(repo, await this.resolveOid(repo, ref)))
      const order = request.order === undefined ? undefined : await Promise.all(request.order.map(ref => this.resolveOid(repo, ref)))
      const historyText = await this.git(repo, ['rev-list', '--parents', '--first-parent', '--max-count=1001', state.head])
      const history: HistoryCommit[] = historyText.trim().split('\n').reverse().map(line => {
        const [oid, ...parents] = line.split(' ')
        return { oid: oid!, parents, subject: '' }
      })
      const plan = planHistory({ ...request, ...(order === undefined ? {} : { order }) }, selected, history)
      if (!plan.eligible) fail(plan.reason, plan.detail)
      const binding: HistoryBinding = { source: { ...source }, checkout: repo.toplevel, gitDir: repo.gitDir, commonDir: repo.commonDir, head: state.head, headRef: state.headRef, tree: (await this.git(repo, ['rev-parse', state.head + '^{tree}'])).trim() }
      const otherCheckouts = await this.otherCheckouts(repo, state.headRef)
      const operationId = randomUUID()
      const publication = await this.publication(repo, plan.rewrites ? plan.affected.slice(0, 1) : plan.affected)
      const diffSummary = plan.base === null
        ? await this.git(repo, ['show', '--format=short', '--stat', '--no-renames', ...plan.ordered, '--'])
        : await this.git(repo, ['diff', '--stat', '--no-renames', plan.base, state.head, '--'])
      const preview: HistoryPreview = {
        operationId, createdAt: new Date().toISOString(), binding, plan, publication,
        requiresPublishedAcknowledgment: plan.rewrites,
        backupRef: 'refs/dsh/history-backups/' + operationId,
        otherCheckouts, diffSummary, diffMeaning: 'Selected source changes, not a simulation of the final result. Reordering and replay can conflict.',
        warnings: [publication.warning, 'Repository hooks and commit signing are disabled for this deterministic history operation.', 'Backup refs preserve committed history only, never ignored/untracked bytes. A clean checkout is required; colliding ignored paths must be moved aside.', 'External Git processes do not join the plugin queue; Git locks and state revalidation still apply.', ...(plan.rewrites ? ['All listed descendants are rewritten. Other branches are not moved; no force-push is performed.'] : [])],
        permission: { source: { ...source }, checkout: repo.toplevel, authority: 'apply-approved-history-plan' },
      }
      // A slow preview is also bound to the state it actually inspected.
      this.requireBinding(await this.snapshot(repo), binding)
      await this.requireIgnoredSafe(repo, preview)
      await this.privateDirectory(this.root(repo))
      await this.privateDirectory(this.directory(repo, operationId), true)
      await this.save(repo, { version: 1, preview, phase: 'preview', completedHead: null, error: null, approved: false, nativeAnchor: null })
      for (const path of [this.root(repo), repo.gitDir]) {
        const handle = await open(path, 'r')
        try { await handle.sync() } finally { await handle.close() }
      }
      return preview
    })
  }

  async execute(source: HistorySource, operationId: string, approval: HistoryApproval): Promise<HistoryStatus> {
    return this.scoped(source, async repo => {
      const journal = await this.load(repo, source, operationId)
      if (journal.phase !== 'preview') fail('already-started', 'This plan was already started or cancelled; inspect its status.')
      if (approval?.approved !== true) fail('approval-required', 'Approve the exact preview before execution.')
      if (journal.preview.requiresPublishedAcknowledgment && approval.acknowledgePublishedHistory !== true) fail('published-acknowledgment-required', 'Acknowledge potentially published history, including unknown remote state.')
      this.requireBinding(await this.snapshot(repo), journal.preview.binding)
      if (journal.preview.plan.rewrites && /[\x00-\x1f\x7f]/.test(repo.gitDir + process.execPath)) fail('unsafe-editor-path', 'Internal rebase editor paths must not contain control characters.')
      if (journal.preview.plan.rewrites && process.platform === 'win32') fail('platform-unsupported', 'Internal rebase editor commands currently require a POSIX Git shell.')
      if (journal.preview.plan.rewrites && process.env.GIT_SEQUENCE_EDITOR !== undefined) fail('editor-environment', 'Unset GIT_SEQUENCE_EDITOR before using an internally generated rebase plan.')
      await this.requireIgnoredSafe(repo, journal.preview)
      await this.prepare(repo, journal)
      this.requireBinding(await this.snapshot(repo), journal.preview.binding)
      journal.approved = true
      journal.phase = 'running'
      await this.save(repo, journal)
      try {
        await this.git(repo, ['update-ref', journal.preview.backupRef, journal.preview.binding.head, '0'.repeat(journal.preview.binding.head.length)])
        // Backup creation is not a checkout lock: revalidate again immediately before Git's mutation.
        await this.otherCheckouts(repo, journal.preview.binding.headRef)
        this.requireBinding(await this.snapshot(repo), journal.preview.binding)
        await this.requireIgnoredSafe(repo, journal.preview)
        const plan = journal.preview.plan
        const args = plan.rewrites
          ? ['rebase', '-i', '--force-rebase', '--no-autosquash', '--no-autostash', '--keep-empty', '--empty=ask', plan.base!]
          : [plan.action, '--no-edit', ...plan.ordered]
        await this.git(repo, [...this.config(repo, journal), ...args])
        return await this.finish(repo, journal)
      } catch (error) { return this.failed(repo, journal, error) }
    })
  }

  async status(source: HistorySource, operationId: string): Promise<HistoryStatus> {
    return this.scoped(source, async repo => this.inspect(repo, await this.load(repo, source, operationId)))
  }

  /** Native conflict controls remain native Git operations. Abort requires explicit loss acknowledgment.
   * Restore is allowed ONLY for a durably recorded completed result, never an inferred external result.
   */
  async recover(source: HistorySource, operationId: string, recovery: HistoryRecovery): Promise<HistoryStatus> {
    return this.scoped(source, async repo => {
      if (!['cancel', 'continue', 'skip', 'abort', 'restore'].includes(recovery.action)) fail('unsupported-recovery', 'Unsupported recovery action.')
      const journal = await this.load(repo, source, operationId)
      const status = await this.inspect(repo, journal)
      if (recovery.action === 'cancel') {
        if (journal.phase !== 'preview') fail('native-abort-required', 'Started operations must use native Abort, not preview cancellation.')
        journal.phase = 'cancelled'
        await this.save(repo, journal)
        return this.inspect(repo, journal)
      }
      if (recovery.action === 'restore') {
        if (recovery.approved !== true || !status.canRestore) fail('restore-refused', 'Restore requires approval, a clean checkout and the exact recorded completed HEAD/ref; later work is never overwritten.')
        const backup = await this.resolveOid(repo, journal.preview.backupRef)
        if (backup !== journal.preview.binding.head) fail('backup-changed', 'The retained backup ref no longer matches the original HEAD.')
        await this.requireIgnoredSafe(repo, journal.preview, false)
        journal.phase = 'recovering'
        await this.save(repo, journal)
        try {
          await this.otherCheckouts(repo, journal.preview.binding.headRef)
          const state = await this.snapshot(repo)
          this.requireClean(state)
          if (state.head !== journal.completedHead || state.headRef !== journal.preview.binding.headRef) fail('restore-refused', 'HEAD/ref changed before restoration.')
          await this.requireIgnoredSafe(repo, journal.preview, false)
          const ref = state.headRef ?? 'HEAD'
          // Compare-and-swap refuses commits added after the last state read. Two-tree read-tree
          // updates the checkout with Git's dirty-file guards rather than reset --hard.
          await this.git(repo, ['update-ref', ...(state.headRef === null ? ['--no-deref'] : []), ref, backup, journal.completedHead!])
          await this.git(repo, ['read-tree', '-u', '-m', journal.completedHead!, backup])
          const restored = await this.snapshot(repo)
          if (!restored.clean || restored.head !== backup || restored.headRef !== journal.preview.binding.headRef) fail('restore-interrupted', 'Concurrent changes detected after restoring the ref; inspect the checkout.')
          journal.phase = 'recovered'
          journal.error = null
          await this.save(repo, journal)
          return this.inspect(repo, journal)
        } catch (error) { return this.failed(repo, journal, error) }
      }
      if (!status.native.owned || status.native.kind === null || status.native.kind === 'other') fail('operation-mismatch', 'No matching native operation remains. Do not overwrite unrelated work.')
      if (recovery.action === 'abort' && recovery.discardResolutionEdits !== true) fail('abort-acknowledgment-required', 'Abort discards conflict resolution edits; explicit acknowledgment is required.')
      // Re-read ignored/untracked data created while paused before native reset/replay.
      // A refusal must not consume a step or alter the durable stopped journal.
      await this.requireIgnoredSafe(repo, journal.preview)
      const command = status.native.kind
      try {
        await this.git(repo, [...this.config(repo, journal), command, '--' + recovery.action])
        if (recovery.action === 'abort') {
          const state = await this.snapshot(repo)
          if (state.native.kind !== null || state.head !== journal.preview.binding.head || state.headRef !== journal.preview.binding.headRef) fail('abort-incomplete', 'Git did not restore the original checkout; inspect status.')
          journal.phase = 'aborted'
          journal.error = null
          await this.save(repo, journal)
          return this.inspect(repo, journal)
        }
        return await this.finish(repo, journal)
      } catch (error) { return this.failed(repo, journal, error) }
    })
  }

  private async scoped<T>(source: HistorySource, work: (repo: RepoRef) => Promise<T>): Promise<T> {
    const first = await this.ports.resolveRepo(source)
    return this.ports.runner.mutate(first.commonDir, async () => {
      const repo = await this.ports.resolveRepo(source)
      if (repo.commonDir !== first.commonDir || repo.gitDir !== first.gitDir || repo.toplevel !== first.toplevel) fail('source-changed', 'The authorized source checkout changed while waiting for the mutation queue.')
      return work(repo)
    })
  }
  private async otherCheckouts(repo: RepoRef, headRef: string | null): Promise<HistoryPreview['otherCheckouts']> {
    const checkouts = parseWorktreeList(await this.git(repo, ['worktree', 'list', '--porcelain']))
      .filter(checkout => checkout.path !== repo.toplevel)
      .map(checkout => ({ checkout: checkout.path, headRef: checkout.branch }))
    if (headRef !== null && checkouts.some(checkout => checkout.headRef === headRef)) fail('branch-checked-out-elsewhere', 'The current branch is checked out elsewhere; this plan cannot safely update both checkouts.')
    return checkouts
  }
  private git(repo: RepoRef, args: readonly string[]): Promise<string> {
    return this.ports.runner.runOk(args, repo.toplevel, { timeoutMs: WRITE_TIMEOUT_MS })
  }
  private async requireIgnoredSafe(repo: RepoRef, preview: HistoryPreview, replay = true): Promise<void> {
    let collision: string | null
    try {
      collision = await findUntrackedCollision(this.ports.runner, repo.toplevel, {
        commits: replay ? preview.plan.affected : [],
        trees: [preview.binding.head, 'HEAD', ...(replay && preview.plan.base !== null ? [preview.plan.base] : [])],
      })
    } catch (error) {
      fail('ignored-guard-unavailable', 'Cannot safely inspect ignored/untracked paths: ' + (error instanceof Error ? error.message : String(error)))
    }
    if (collision !== null) fail('ignored-path-collision', 'Ignored or untracked path ' + JSON.stringify(collision) + ' collides with a history checkout/replay path. Move it outside the checkout before retrying; backup refs do not preserve these bytes.')
  }
  private root(repo: RepoRef): string { return join(repo.gitDir, 'dsh-history') }
  private directory(repo: RepoRef, id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) fail('invalid-operation-id', 'Invalid history operation ID.')
    return join(this.root(repo), id)
  }
  private async privateDirectory(path: string, exclusive = false): Promise<void> {
    try { await mkdir(path, { mode: 0o700 }) } catch (error) {
      if (exclusive || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail('unsafe-journal-directory', 'The history journal must be a private, nonsymlink directory.')
  }
  private async durable(path: string, text: string): Promise<void> {
    const temp = path + '.' + randomUUID() + '.tmp'
    const file = await open(temp, 'wx', 0o600)
    try { await file.writeFile(text, 'utf8'); await file.sync() } finally { await file.close() }
    await rename(temp, path)
  }
  private async save(repo: RepoRef, journal: Journal): Promise<void> {
    const dir = this.directory(repo, journal.preview.operationId)
    await this.durable(join(dir, 'journal.json'), JSON.stringify(journal, null, 2) + '\n')
    const handle = await open(dir, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }
  private async load(repo: RepoRef, source: HistorySource, id: string): Promise<Journal> {
    const dir = this.directory(repo, id)
    for (const path of [this.root(repo), dir]) {
      const stat = await lstat(path)
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail('unsafe-journal-directory', 'History journals must remain in private nonsymlink directories.')
    }
    const journal = JSON.parse(await readFile(join(dir, 'journal.json'), 'utf8')) as Journal
    if (journal.version !== 1 || journal.preview?.operationId !== id) fail('invalid-journal', 'Unsupported or corrupt history journal.')
    const b = journal.preview.binding
    if (sourceKey(source) !== sourceKey(b.source) || repo.gitDir !== b.gitDir || repo.commonDir !== b.commonDir || repo.toplevel !== b.checkout) fail('source-mismatch', 'This plan is authorized only for its original source and checkout.')
    const plan = journal.preview.plan
    if (!isHistoryOid(b.head) || !['cherry-pick', 'revert', 'squash', 'fixup', 'reorder', 'reword'].includes(plan.action)
      || plan.rewrites !== (plan.action !== 'cherry-pick' && plan.action !== 'revert')
      || (plan.rewrites && plan.base === null)
      || [plan.affected, plan.selected, plan.ordered, plan.descendants].some(ids => !Array.isArray(ids) || ids.some(id => !isHistoryOid(id)))
      || (plan.base !== null && !isHistoryOid(plan.base))
      || !Array.isArray(plan.steps) || plan.steps.some(step => !['pick', 'fixup', 'message'].includes(step.kind) || !isHistoryOid(step.oid))
      || journal.preview.backupRef !== 'refs/dsh/history-backups/' + id
      || (journal.completedHead !== null && !isHistoryOid(journal.completedHead))) fail('invalid-journal', 'Invalid journal plan or commit identities.')
    return journal
  }
  private async resolveOid(repo: RepoRef, ref: string): Promise<string> {
    if (typeof ref !== 'string' || ref.length === 0 || ref.length > 1024 || /^[ -]/.test(ref) || /[\x00-\x20\x7f~^:{}\\]/.test(ref)) fail('invalid-ref', 'Provide a literal commit OID or unambiguous ref, not a revision expression or option.')
    const result = await this.ports.runner.run(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'], repo.toplevel)
    const oid = result.stdout.trim()
    if (result.code !== 0 || /ambiguous/i.test(result.stderr) || !isHistoryOid(oid)) fail('invalid-ref', 'The selected ref does not identify one unambiguous commit.')
    return oid
  }
  private async commit(repo: RepoRef, oid: string): Promise<HistoryCommit> {
    const text = await this.git(repo, ['show', '-s', '--format=%H%n%P%n%s', oid, '--'])
    const [resolved, parents, subject] = text.split('\n')
    return { oid: resolved!, parents: parents === '' ? [] : parents!.split(' '), subject: subject ?? '' }
  }
  private async publication(repo: RepoRef, oids: readonly string[]): Promise<HistoryPublication> {
    const refs = new Set<string>()
    for (const oid of oids) {
      const result = await this.ports.runner.run(['for-each-ref', '--format=%(refname)', '--contains=' + oid, 'refs/remotes/'], repo.toplevel)
      if (result.code !== 0) return { state: 'unknown', refs: [...refs], warning: 'Published history is unknown: local remote reachability could not be read. No fetch was performed.' }
      for (const ref of result.stdout.trim().split('\n')) if (ref !== '') refs.add(ref)
    }
    return refs.size > 0
      ? { state: 'reachable', refs: [...refs], warning: 'Affected commits are reachable from local remote-tracking refs and may be published/shared. Remote data may be stale; no fetch was performed.' }
      : { state: 'unknown', refs: [], warning: 'Published history is unknown. Missing local remote reachability is not evidence that commits are unpublished. No fetch was performed.' }
  }
  private async marker(repo: RepoRef, name: string): Promise<string | null> {
    try { return await readFile(join(repo.gitDir, name), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'EISDIR') return null
      throw error
    }
  }
  private async exists(repo: RepoRef, name: string): Promise<boolean> {
    try { await lstat(join(repo.gitDir, name)); return true } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  private async nativeAnchor(repo: RepoRef): Promise<string | null> {
    for (const name of ['rebase-merge', 'rebase-apply', 'sequencer', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
      try {
        const stat = await lstat(join(repo.gitDir, name))
        return JSON.stringify([name, stat.dev, stat.ino, stat.birthtimeMs])
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return null
  }
  private async snapshot(repo: RepoRef, journal?: Journal): Promise<Snapshot> {
    const head = (await this.git(repo, ['rev-parse', '--verify', 'HEAD'])).trim()
    const symbolic = await this.ports.runner.run(['symbolic-ref', '-q', 'HEAD'], repo.toplevel)
    if (symbolic.code !== 0 && symbolic.code !== 1) fail('head-unavailable', 'Unable to read the current HEAD ref.')
    const headRef = symbolic.code === 0 ? symbolic.stdout.trim() : null
    const dirty = await this.git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'])
    const indexFlags = await this.git(repo, ['ls-files', '-v', '-z'])
    // These flags can hide tracked edits from status. Refuse rather than promise a clean backup.
    const hiddenIndexState = indexFlags.split('\0').some(entry => /^[a-zS] /.test(entry))
    let native: HistoryNativeState = emptyNative
    const rebase = await this.exists(repo, 'rebase-merge') || await this.exists(repo, 'rebase-apply')
    const cherry = await this.marker(repo, 'CHERRY_PICK_HEAD')
    const revert = await this.marker(repo, 'REVERT_HEAD')
    const todo = await this.marker(repo, 'sequencer/todo')
    const hasSequencer = await this.exists(repo, 'sequencer')
    const other = await this.exists(repo, 'MERGE_HEAD') || await this.exists(repo, 'BISECT_START') || await this.exists(repo, 'index.lock')
    if (rebase || cherry !== null || revert !== null || hasSequencer || other) {
      const kind = rebase ? 'rebase' : cherry !== null ? 'cherry-pick' : revert !== null ? 'revert' : todo?.startsWith('pick ') ? 'cherry-pick' : todo?.startsWith('revert ') ? 'revert' : 'other'
      const remaining = (rebase ? await this.marker(repo, 'rebase-merge/git-rebase-todo') : todo)?.split('\n').filter(l => l.trim() !== '' && !l.startsWith('#')) ?? []
      const stopped = rebase ? await this.marker(repo, 'REBASE_HEAD') : cherry ?? revert
      if (stopped !== null) remaining.unshift('stopped ' + stopped.trim())
      let owned = false
      if (journal?.approved && ['running', 'stopped'].includes(journal.phase) && !other && journal.nativeAnchor !== null && journal.nativeAnchor === await this.nativeAnchor(repo)) {
        const b = journal.preview.binding
        if (kind === 'rebase' && journal.preview.plan.rewrites) {
          const orig = await this.marker(repo, 'rebase-merge/orig-head')
          const branch = await this.marker(repo, 'rebase-merge/head-name')
          owned = orig?.trim() === b.head && branch?.trim() === (b.headRef ?? 'detached HEAD')
        } else if (kind === journal.preview.plan.action && headRef === b.headRef) {
          const orig = await this.marker(repo, 'sequencer/head')
          owned = orig?.trim() === b.head || (!hasSequencer && head === b.head && stopped !== null && journal.preview.plan.selected.includes(stopped.trim()))
        }
      }
      const conflicts = (await this.git(repo, ['diff', '--name-only', '--diff-filter=U', '-z', '--'])).split('\0').filter(Boolean)
      native = { kind, remaining, conflicts, owned }
    }
    return { head, headRef, clean: dirty === '' && !hiddenIndexState, hiddenIndexState, native }
  }
  private requireClean(state: Snapshot): void {
    if (state.native.kind !== null) fail('active-operation', 'Finish or abort the active Git operation (or remove a stale Git lock) first.')
    if (state.hiddenIndexState) fail('hidden-index-state', 'Assume-unchanged and skip-worktree entries (including sparse checkouts) are not supported by history plans.')
    if (!state.clean) fail('dirty-checkout', 'Tracked files, the index and untracked files must all be clean; no automatic stash is performed.')
  }
  private requireBinding(state: Snapshot, binding: HistoryBinding): void {
    this.requireClean(state)
    if (state.head !== binding.head || state.headRef !== binding.headRef) fail('stale-preview', 'HEAD or the checked-out ref changed. Create and approve a new preview.')
  }
  private config(repo: RepoRef, journal: Journal): string[] {
    const dir = this.directory(repo, journal.preview.operationId)
    const editor = quote(process.execPath) + ' ' + quote(join(dir, 'copy.cjs'))
    return ['-c', 'core.hooksPath=' + join(dir, 'hooks'), '-c', 'commit.gpgSign=false', '-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', '-c', 'rebase.abbreviateCommands=false', '-c', 'rebase.rescheduleFailedExec=true', '-c', 'sequence.editor=' + editor + ' ' + quote(join(dir, 'todo')), '-c', 'core.editor=' + editor + ' ' + quote(join(dir, 'message'))]
  }
  private async prepare(repo: RepoRef, journal: Journal): Promise<void> {
    const dir = this.directory(repo, journal.preview.operationId)
    await this.privateDirectory(join(dir, 'hooks'))
    // This constant editor contains no user strings and only copies data. Paths are shell-quoted
    // arguments, never interpolated into executable source. Git supplies the destination argument.
    await this.durable(join(dir, 'copy.cjs'), "const fs = require('node:fs'); fs.copyFileSync(process.argv[2], process.argv[3]);\n")
    await this.durable(join(dir, 'message'), journal.preview.plan.message ?? '')
    const todo = journal.preview.plan.steps.map(step => {
      if (step.kind !== 'message') return step.kind + ' ' + step.oid
      // GitRunner fixes GIT_EDITOR=true, overriding core.editor. A fixed native amend command
      // reads message bytes as data instead; users cannot supply exec lines or command fragments.
      return 'exec git -c core.hooksPath=' + quote(join(dir, 'hooks')) + ' -c commit.gpgSign=false commit --amend --no-verify --no-gpg-sign --cleanup=verbatim --file=' + quote(join(dir, 'message'))
    }).join('\n') + '\n'
    await this.durable(join(dir, 'todo'), todo)
  }
  private async finish(repo: RepoRef, journal: Journal): Promise<HistoryStatus> {
    const state = await this.snapshot(repo, journal)
    if (state.native.kind !== null || !state.clean || state.headRef !== journal.preview.binding.headRef) fail('incomplete-operation', 'Git returned without a clean completed checkout; inspect the native remaining step.')
    journal.phase = 'completed'
    journal.completedHead = state.head
    journal.error = null
    await this.save(repo, journal)
    return this.inspect(repo, journal)
  }
  private async failed(repo: RepoRef, journal: Journal, error: unknown): Promise<HistoryStatus> {
    journal.error = error instanceof Error ? error.message : String(error)
    // Bind a newly started native operation once. Reload/status must never adopt a replacement.
    if (journal.phase === 'running') journal.nativeAnchor = await this.nativeAnchor(repo)
    // Never translate a failed cherry-pick/rebase into success. Reread Git's actual markers.
    const state = await this.snapshot(repo, journal)
    journal.phase = state.native.owned ? 'stopped' : 'failed'
    await this.save(repo, journal)
    return this.inspect(repo, journal)
  }
  private async inspect(repo: RepoRef, journal: Journal): Promise<HistoryStatus> {
    const state = await this.snapshot(repo, journal)
    let phase = journal.phase
    if (['running', 'stopped', 'recovering'].includes(phase)) {
      if (state.native.owned) phase = 'stopped'
      else if (state.native.kind === null && state.head === journal.preview.binding.head && state.headRef === journal.preview.binding.headRef && phase === 'stopped') phase = 'aborted'
      else phase = 'interrupted'
    }
    const canRestore = phase === 'completed' && state.clean && state.native.kind === null && state.head === journal.completedHead && state.headRef === journal.preview.binding.headRef
    const nextStep = phase === 'stopped' ? 'Resolve conflicts, then Continue; Skip drops the current commit; Abort discards resolution edits.'
      : phase === 'interrupted' ? 'Inspect Git status and retained backup. Completion was not durably recorded; automatic replay and restore are refused.'
      : phase === 'failed' ? 'Inspect the error and current Git state. Do not replay this plan blindly.'
      : phase === 'preview' ? 'Review the exact plan and approve execution, or cancel without changing Git.'
      : phase === 'completed' ? (canRestore ? 'Completed. The retained backup can restore committed history with approval.' : 'Completed result has changed; backup restore is refused to protect later work.')
      : 'No remaining planner step; the backup ref and journal are retained.'
    return { preview: journal.preview, phase, native: state.native, currentHead: state.head, currentRef: state.headRef, clean: state.clean, completedHead: journal.completedHead, error: journal.error, nextStep, canRestore }
  }
}
