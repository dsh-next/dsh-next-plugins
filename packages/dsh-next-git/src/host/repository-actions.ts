import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, readlink, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { HunkApplyRequest, HunkPreview, HunkRequest, HunkUnsupported, RepositoryActionExecution, RepositoryActionPreview, RepositoryActionRequest, RepositoryActionResult, RepositoryInventory, RepositoryRemote, RepositoryStash } from '../core/repository-actions.ts'
import type { RepoRef, SourceRef } from './git-service.ts'
import { type GitRunner, WRITE_TIMEOUT_MS } from './git-runner.ts'

export interface RepositoryActionsPorts {
  readonly runner: Pick<GitRunner, 'runOk' | 'runSoft' | 'runBytesOk' | 'mutate'>
  /** Enforce source/session authorization here; never accept a client RepoRef. */
  readonly resolveRepo: (source: SourceRef) => Promise<RepoRef>
}
export class RepositoryActionError extends Error {
  constructor(readonly reason: string, message: string) { super(message); this.name = 'RepositoryActionError' }
}
interface Snapshot { version: string; head: string | null; dirty: boolean; stashes: RepositoryStash[] }
interface HunkData { dto: HunkPreview; prefix: string }
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
const oid = (value: unknown): value is string => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function fail(reason: string, message: string): never { throw new RepositoryActionError(reason, message) }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function keys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('invalid-request', 'Unexpected request fields are not supported.')
}
function result(status: RepositoryActionResult['status'], reason: string | null = null, message: string | null = null, stashOid: string | null = null): RepositoryActionResult {
  return { status, refresh: status !== 'rejected' || reason === 'stale-preview' || reason === 'active-operation' || reason === 'conflicts', conflictRefresh: status === 'conflicted' || status === 'failed' || reason === 'conflicts' || reason === 'active-operation', reason, message, stashOid }
}
function rejection(error: unknown): RepositoryActionResult {
  return error instanceof RepositoryActionError ? result(error.reason === 'git-failed' ? 'failed' : 'rejected', error.reason, error.message) : result('failed', 'git-failed', 'Git could not complete the action. Refresh repository state before retrying.')
}
function maskUrl(value: string): string {
  // Do not expose userinfo, tokens in queries/fragments, or helper-specific credential syntax.
  if (value.includes('://')) {
    try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString() } catch { return '[redacted remote URL]' }
  }
  return value.includes('@') || /[?#]/.test(value) ? '[redacted remote URL]' : value
}

/** Deterministic checkout-scoped actions. No network reads occur during preview.
 * The shared queue excludes other plugin writes, not external Git/editors; fresh
 * snapshots narrow that race and Git owns the final atomic index/ref updates.
 * Runtime errors intentionally omit Git output, which can contain credentials.
 */
export class RepositoryActions {
  constructor(private readonly ports: RepositoryActionsPorts) {}

  async inspectHunks(source: SourceRef, request: HunkRequest): Promise<HunkPreview> {
    return this.scoped(source, async repo => (await this.hunks(repo, request)).dto)
  }

  async applyHunks(source: SourceRef, input: HunkApplyRequest): Promise<RepositoryActionResult> {
    try {
      if (!record(input)) fail('invalid-request', 'A hunk selection is required.')
      keys(input, ['path', 'side', 'version', 'hunkIds', 'approved'])
      this.approval(input)
      if (!Array.isArray(input.hunkIds) || input.hunkIds.length === 0 || input.hunkIds.length > 1000 || input.hunkIds.some(id => !fingerprint(id)) || new Set(input.hunkIds).size !== input.hunkIds.length) fail('invalid-selection', 'Select distinct hunk IDs from the current preview.')
      return await this.scoped(source, async repo => {
        const request = { path: input.path, side: input.side }
        const before = await this.hunks(repo, request)
        if (before.dto.version !== input.version) fail('stale-preview', 'The checkout changed. Preview again before applying hunks.')
        if (before.dto.unsupported !== null) fail('unsupported-hunks', 'Use the separately approved whole-file workflow for this change.')
        const selected = new Set(input.hunkIds)
        const hunks = before.dto.hunks.filter(hunk => selected.has(hunk.id))
        if (hunks.length !== selected.size) fail('invalid-selection', 'A selected hunk is not in the current preview.')
        // Only Git-generated headers and host-selected hunks enter this private patch.
        const patch = before.prefix + hunks.map(hunk => hunk.patch).join('')
        const dir = await mkdtemp(join(await realpath(repo.gitDir), 'dsh-actions-'))
        try {
          await chmod(dir, 0o700)
          const path = join(dir, 'selected.patch')
          const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
          try { await file.chmod(0o600); await file.writeFile(patch); await file.sync() } finally { await file.close() }
          const args = ['apply', '--cached', '--whitespace=nowarn', ...(input.side === 'staged' ? ['--reverse'] : [])]
          await this.git(repo, [...args, '--check', '--', path], true)
          if ((await this.hunks(repo, request)).dto.version !== input.version) fail('stale-preview', 'The checkout changed during patch validation. Preview again.')
          await this.git(repo, [...args, '--', path], true)
          return result('completed')
        } finally { await rm(dir, { recursive: true, force: true }) }
      })
    } catch (error) { return rejection(error) }
  }

  async inventory(source: SourceRef): Promise<RepositoryInventory> {
    return this.scoped(source, async repo => ({ remotes: await this.remotes(repo), stashes: await this.stashes(repo) }))
  }

  async preview(source: SourceRef, request: RepositoryActionRequest): Promise<RepositoryActionPreview> {
    return this.scoped(source, repo => this.plan(repo, request))
  }

  async execute(source: SourceRef, input: RepositoryActionExecution): Promise<RepositoryActionResult> {
    try {
      if (!record(input)) fail('invalid-request', 'An approved action preview is required.')
      keys(input, ['request', 'version', 'approved'])
      this.approval(input)
      return await this.scoped(source, async repo => {
        const preview = await this.plan(repo, input.request)
        if (preview.version !== input.version) fail('stale-preview', 'The repository or action changed. Preview again before execution.')
        const request = preview.request
        const beforeStashes = await this.stashes(repo)
        // Revalidate after all planning/lookup reads and immediately before the write.
        if ((await this.plan(repo, request)).version !== input.version) fail('stale-preview', 'The checkout changed during validation. Preview again.')
        try {
          if (request.action === 'fetch') {
            await this.git(repo, ['fetch', '--no-tags', '--no-prune-tags', '--no-recurse-submodules', '--refmap=', request.prune ? '--prune' : '--no-prune', '--', request.remote, 'refs/heads/*:refs/remotes/' + request.remote + '/*'], true)
          } else if (request.action === 'push') {
            // Explicit OID and destination bypass configured force refspecs/defaults.
            await this.git(repo, ['-c', 'push.autoSetupRemote=false', '-c', 'push.gpgSign=false', 'push', '--porcelain', '--no-force', '--no-mirror', '--no-follow-tags', '--recurse-submodules=no', '--', request.remote, preview.head! + ':refs/heads/' + request.branch], true)
          } else if (request.action === 'stash-save') {
            await this.git(repo, ['stash', 'push', ...(request.includeUntracked ? ['--include-untracked'] : []), '--message', request.message ?? 'Saved from Source Control'], true)
            const after = await this.stashes(repo)
            const saved = after[0]?.oid ?? null
            if (saved === (beforeStashes[0]?.oid ?? null) && after.length === beforeStashes.length) return result('noop', null, 'No changes matched the stash options.')
            if (saved === null) return result('failed', 'stash-not-created', 'Git did not create a stash entry.')
            return result('completed', null, null, saved)
          } else {
            await this.git(repo, ['stash', 'apply', request.stashOid], true)
            if (!(await this.stashes(repo)).some(stash => stash.oid === request.stashOid)) return result('failed', 'stash-changed', 'The stash list changed externally; refresh repository state.')
          }
          return result('completed')
        } catch {
          // stash apply can fail after writing conflicted index/worktree state; never call pop/drop.
          const conflicts = await this.git(repo, ['ls-files', '-u', '-z']).catch(() => null)
          return conflicts ? result('conflicted', 'conflicts', 'The action left conflicts. Refresh the conflict workspace; stash entries were not dropped.') : result('failed', 'git-failed', 'Git rejected or could not complete the action. Refresh before retrying; no force or stash drop was attempted.')
        }
      })
    } catch (error) { return rejection(error) }
  }

  private async scoped<T>(source: SourceRef, run: (repo: RepoRef) => Promise<T>): Promise<T> {
    try {
      const repo = await this.ports.resolveRepo(source)
      return await this.ports.runner.mutate(repo.commonDir, () => run(repo))
    } catch (error) {
      if (error instanceof RepositoryActionError) throw error
      // Raw git stderr (including remote URLs) must not cross the RPC boundary.
      throw new RepositoryActionError('git-failed', 'Git could not inspect or update this repository. Refresh and retry.')
    }
  }
  private git(repo: RepoRef, args: readonly string[], write = false): Promise<string> {
    return this.ports.runner.runOk(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'core.quotePath=true', ...args], repo.toplevel, write ? { timeoutMs: WRITE_TIMEOUT_MS, lockRetries: 0 } : {})
  }
  private approval(input: { approved?: unknown; version?: unknown }): void {
    if (input.approved !== true) fail('approval-required', 'Explicit approval of the preview is required.')
    if (!fingerprint(input.version)) fail('invalid-version', 'A current preview fingerprint is required.')
  }
  private async safePath(repo: RepoRef, path: unknown): Promise<string> {
    if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) fail('invalid-path', 'Choose a literal checkout-relative path.')
    let current = repo.toplevel
    const parts = path.split('/')
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]!)
      try {
        const stat = await lstat(current)
        if (stat.isSymbolicLink()) fail('unsafe-path', 'Symlink paths are not supported by partial staging.')
        if (i < parts.length - 1 && !stat.isDirectory()) fail('unsafe-path', 'A path parent is not a directory.')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return path
  }
  private async activeGuard(repo: RepoRef): Promise<void> {
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_START', 'index.lock']) {
      try { await lstat(join(repo.gitDir, marker)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      fail('active-operation', 'Finish or abort the active Git operation before changing repository state.')
    }
    if (await this.git(repo, ['ls-files', '-u', '-z'])) fail('conflicts', 'Resolve existing conflicts before starting this action.')
    const flags = await this.git(repo, ['ls-files', '-v', '-z'])
    if (flags.split('\0').some(entry => /^[a-zS] /.test(entry))) fail('hidden-index-state', 'Assume-unchanged and skip-worktree entries are not supported by these actions.')
  }
  private async stashes(repo: RepoRef): Promise<RepositoryStash[]> {
    const text = await this.git(repo, ['stash', 'list', '--format=%H'])
    return text.trim().split('\n').filter(Boolean).map((value, index) => {
      if (!oid(value)) fail('invalid-stash', 'Git returned an invalid stash identifier.')
      return { oid: value, label: 'stash@{' + index + '}' }
    })
  }
  private async snapshot(repo: RepoRef, untrackedContents = false): Promise<Snapshot> {
    await this.activeGuard(repo)
    const head = (await this.ports.runner.runSoft(['rev-parse', '--verify', 'HEAD'], repo.toplevel))?.trim() ?? null
    const headRef = await this.ports.runner.runSoft(['symbolic-ref', '-q', 'HEAD'], repo.toplevel)
    const index = await this.git(repo, ['ls-files', '--stage', '-z'])
    const status = await this.git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    const diff = await this.ports.runner.runBytesOk(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-renames'], repo.toplevel)
    const staged = await this.ports.runner.runBytesOk(['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-renames'], repo.toplevel)
    const refs = await this.git(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])
    const config = await this.git(repo, ['config', '--null', '--list'])
    const stashes = await this.stashes(repo)
    const untracked: string[] = []
    if (untrackedContents) {
      const paths = (await this.git(repo, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
      for (const path of paths) {
        // Never follow an untracked symlink or a symlink parent while fingerprinting.
        const full = join(repo.toplevel, path)
        const stat = await lstat(full)
        if (stat.isSymbolicLink()) { untracked.push(hash(path + '\0' + await readlink(full))); continue }
        await this.safePath(repo, path)
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) fail('unsupported-untracked', 'An untracked file is not regular or exceeds the stash preview limit.')
        const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW)
        try { untracked.push(hash(path + '\0' + hash(await file.readFile()))) } finally { await file.close() }
      }
    }
    return { version: hash(JSON.stringify([repo.toplevel, repo.gitDir, head, headRef, index, status, hash(diff), hash(staged), refs, config, stashes, untracked])), head, dirty: status !== '', stashes }
  }

  private async hunks(repo: RepoRef, request: HunkRequest): Promise<HunkData> {
    if (!record(request)) fail('invalid-request', 'A path and diff side are required.')
    keys(request, ['path', 'side'])
    if (request.side !== 'staged' && request.side !== 'unstaged') fail('invalid-side', 'Choose the staged or unstaged side.')
    const path = await this.safePath(repo, request.path)
    const tracked = await this.git(repo, ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', path])
    // A literal directory pathspec still recurses in Git. Only one exact index path
    // may participate; otherwise a selected block could contain another file header.
    if (tracked.split('\0').filter(Boolean).some(row => row.slice(row.indexOf('\t') + 1) !== path)) fail('invalid-path', 'Choose one file, not a directory pathspec.')
    try {
      const stat = await lstat(join(repo.toplevel, path))
      if (!stat.isFile() && !(stat.isDirectory() && tracked.startsWith('160000 '))) fail('invalid-path', 'Choose one regular tracked file.')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const state = await this.snapshot(repo)
    const side = request.side === 'staged' ? ['--cached'] : []
    const base = ['--literal-pathspecs', 'diff', ...side, '--no-ext-diff', '--no-textconv']
    const raw = await this.ports.runner.runBytesOk([...base, '--no-renames', '--full-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3', '--', path], repo.toplevel)
    let patch = ''
    let unsupported: HunkUnsupported | null = null
    try { patch = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw) } catch { unsupported = 'non-text' }
    if ([...patch.matchAll(/^diff --git /gm)].length > 1) fail('invalid-path', 'A partial patch must describe exactly one file.')
    const changes = (await this.git(repo, [...base, '--name-status', '-z', '--find-renames'])).split('\0')
    for (let i = 0; i < changes.length && changes[i];) {
      const kind = changes[i++]!
      const first = changes[i++]
      const second = /^[RC]/.test(kind) ? changes[i++] : undefined
      if ((first === path || second === path) && /^[RC]/.test(kind)) unsupported = 'rename'
    }
    if (/^new file mode /m.test(patch)) unsupported ??= 'new-file'
    if (/^deleted file mode /m.test(patch)) unsupported ??= 'deleted-file'
    if (/^old mode /m.test(patch)) unsupported ??= 'mode-change'
    if (/^(?:old mode |new mode |new file mode |deleted file mode )?120000$/m.test(patch) || /^index .* 120000$/m.test(patch)) unsupported = 'symlink'
    if (/^index .* 160000$/m.test(patch)) unsupported = 'submodule'
    if (/^Binary files /m.test(patch) || patch.includes('\0')) unsupported ??= 'binary'
    if (!tracked && patch === '') {
      const others = await this.git(repo, ['--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '-z', '--', path])
      if (others) unsupported = 'new-file'
    }
    const starts = [...patch.matchAll(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@[^\n]*\n/gm)]
    const prefix = patch.slice(0, starts[0]?.index ?? patch.length)
    const version = hash(JSON.stringify([state.version, path, request.side, hash(raw), unsupported]))
    const hunks = unsupported !== null ? [] : starts.map((match, i) => {
      const content = patch.slice(match.index!, starts[i + 1]?.index ?? patch.length)
      return { id: hash(JSON.stringify([path, request.side, prefix, content])), header: match[0].trimEnd(), patch: content }
    })
    if ((await this.snapshot(repo)).version !== state.version) fail('stale-preview', 'The checkout changed while reading the diff. Refresh and retry.')
    return { prefix, dto: { path, side: request.side, version, hunks, unsupported, wholeFileFallback: unsupported !== null } }
  }
  private async remoteName(repo: RepoRef, name: unknown): Promise<string> {
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) || name.includes('..') || name.endsWith('/') || name.includes('//')) fail('invalid-remote', 'Select a configured remote name, not a URL or command option.')
    const names = (await this.git(repo, ['remote'])).trim().split('\n')
    if (!names.includes(name)) fail('invalid-remote', 'The selected remote is not configured.')
    if (await this.ports.runner.runSoft(['check-ref-format', 'refs/remotes/' + name + '/check'], repo.toplevel) === null) fail('invalid-remote', 'The configured remote name is not supported.')
    return name
  }
  private async remotes(repo: RepoRef): Promise<RepositoryRemote[]> {
    const names = (await this.git(repo, ['remote'])).trim().split('\n').filter(Boolean)
    const remotes: RepositoryRemote[] = []
    for (const name of names) {
      // Unusual/unsafe names are not actionable, but do not hide valid remotes.
      try { await this.remoteName(repo, name) } catch (error) { if (error instanceof RepositoryActionError && error.reason === 'invalid-remote') continue; throw error }
      const fetchUrls = (await this.git(repo, ['remote', 'get-url', '--all', name])).trim().split('\n').filter(Boolean).map(maskUrl)
      const pushUrls = (await this.git(repo, ['remote', 'get-url', '--push', '--all', name])).trim().split('\n').filter(Boolean).map(maskUrl)
      remotes.push({ name, fetchUrls, pushUrls })
    }
    return remotes
  }
  private async plan(repo: RepoRef, input: RepositoryActionRequest): Promise<RepositoryActionPreview> {
    if (!record(input)) fail('invalid-request', 'A supported repository action is required.')
    let request: RepositoryActionRequest
    let summary: string
    switch (input.action) {
      case 'fetch':
        keys(input, ['action', 'remote', 'prune'])
        if (typeof input.prune !== 'boolean') fail('invalid-request', 'Choose explicitly whether fetch should prune remote-tracking branches.')
        request = { action: 'fetch', remote: await this.remoteName(repo, input.remote), prune: input.prune }
        summary = 'Fetch branches into remote-tracking refs' + (input.prune ? ' and prune removed remote branches.' : ' without pruning.')
        break
      case 'push':
        keys(input, ['action', 'remote', 'branch'])
        if (typeof input.branch !== 'string' || !input.branch || /^[+-]/.test(input.branch) || /[\x00-\x20\x7f:]/.test(input.branch) || await this.ports.runner.runSoft(['check-ref-format', 'refs/heads/' + input.branch], repo.toplevel) === null) fail('invalid-ref', 'Choose a valid destination branch name.')
        request = { action: 'push', remote: await this.remoteName(repo, input.remote), branch: input.branch }
        summary = 'Push the previewed HEAD to the selected remote branch without force.'
        break
      case 'stash-save':
        keys(input, ['action', 'includeUntracked', 'message'])
        if (typeof input.includeUntracked !== 'boolean' || input.message !== undefined && (typeof input.message !== 'string' || input.message.length > 4096 || input.message.includes('\0'))) fail('invalid-request', 'Choose includeUntracked explicitly and use a valid optional stash message.')
        request = { action: 'stash-save', includeUntracked: input.includeUntracked, ...(input.message === undefined ? {} : { message: input.message }) }
        summary = input.includeUntracked ? 'Save tracked and untracked changes in a stash; ignored files stay in place.' : 'Save tracked changes in a stash; untracked and ignored files stay in place.'
        break
      case 'stash-apply':
        keys(input, ['action', 'stashOid'])
        if (!oid(input.stashOid)) fail('invalid-stash', 'Choose an exact stash object ID from the stash inventory.')
        request = { action: 'stash-apply', stashOid: input.stashOid }
        summary = 'Apply the selected stash to this checkout, keeping the stash entry even if conflicts occur.'
        break
      default: fail('invalid-request', 'This repository action is not supported.')
    }
    const state = await this.snapshot(repo, request.action === 'stash-save' && request.includeUntracked)
    if (request.action !== 'fetch' && state.head === null) fail('unborn-head', 'This action requires an existing HEAD commit.')
    if (request.action === 'stash-apply') {
      if (!state.stashes.some(stash => stash.oid === request.stashOid)) fail('invalid-stash', 'The selected object is no longer in the stash inventory.')
      if (state.dirty) fail('dirty-tree', 'Stash apply requires a clean checkout, including untracked files.')
    }
    return {
      version: hash(JSON.stringify([state.version, request])), request, checkout: repo.toplevel, head: state.head, summary,
      warnings: ['No network operation has run during preview. Remote state may change before execution.', 'External Git and editors do not join the plugin queue; refresh state after execution.'],
    }
  }
}
