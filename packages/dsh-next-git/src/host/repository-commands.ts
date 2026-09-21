import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, realpath, readFile, readlink, mkdir, open, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseRepositoryCommand, type RepositoryCommandRequest, type RepositoryCommandPreview, type RepositoryCommandExecution, type RepositoryStashInspection, type RepositoryCommandOutput } from '../core/repository-commands.ts'
import type { RepositoryActionResult } from '../core/repository-actions.ts'
import { RepositoryActionError, type RepositoryActionsPorts } from './repository-actions.ts'
import type { RepoRef, SourceRef } from './git-service.ts'
import { WRITE_TIMEOUT_MS } from './git-runner.ts'
import { findUntrackedCollision } from './ignored-guard.ts'

export type RepositoryCommandsPorts = RepositoryActionsPorts
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const oid = (value: string): boolean => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
const fail = (reason: string, message: string): never => { throw new RepositoryActionError(reason, message) }
const result = (status: RepositoryActionResult['status'], reason: string | null = null): RepositoryActionResult => ({ status, reason, refresh: true, conflictRefresh: status === 'conflicted' || status === 'failed', message: reason === null ? null : 'Git could not safely complete this command. Refresh and preview again.', stashOid: null })
interface Plan { preview: RepositoryCommandPreview; stashes: string[]; remoteOid: string; target: string; remotes: string[]; tags: string[] }
const safeOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'push.gpgSign=false', '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', '-c', 'protocol.https.allow=always', '-c', 'protocol.http.allow=always', '-c', 'protocol.ssh.allow=always', '-c', 'submodule.recurse=false', '-c', 'rebase.updateRefs=false', '-c', 'rebase.autoSquash=false', '-c', 'rebase.rebaseMerges=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false']

/** Uses the service's shared runner lease. External Git writers remain outside that lease. */
export class RepositoryCommands {
  private readonly logs = new Map<string, string[]>()
  constructor(private readonly ports: RepositoryCommandsPorts) {}

  async preview(source: SourceRef, request: RepositoryCommandRequest): Promise<RepositoryCommandPreview> {
    return this.scoped(source, async repo => (await this.plan(repo, request)).preview)
  }
  async execute(source: SourceRef, input: RepositoryCommandExecution): Promise<RepositoryActionResult> {
    try {
      if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'approved,request,version' || input.approved !== true || typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version)) fail('approval-required', 'Approve a current command preview first.')
      return await this.scoped(source, async repo => {
        const plan = await this.plan(repo, input.request)
        if (plan.preview.version !== input.version) fail('stale-preview', 'The request or repository changed; preview again.')
        // Re-read network advertisements and local state directly before the mutation.
        if ((await this.plan(repo, input.request)).preview.version !== input.version) fail('stale-preview', 'State changed during validation; preview again.')
        let outcome: RepositoryActionResult
        try { outcome = await this.run(repo, plan) } catch (error) {
          const conflicts = await this.git(repo, ['ls-files', '-u', '-z']).catch(() => '')
          outcome = result(conflicts ? 'conflicted' : error instanceof RepositoryActionError ? 'rejected' : 'failed', conflicts ? 'conflicts' : error instanceof RepositoryActionError ? error.reason : 'git-failed')
        }
        const lines = this.logs.get(repo.toplevel) ?? []
        lines.push(plan.preview.request.action + ': ' + outcome.status)
        this.logs.delete(repo.toplevel)
        this.logs.set(repo.toplevel, lines.slice(-100))
        if (this.logs.size > 100) this.logs.delete(this.logs.keys().next().value!)
        return outcome
      })
    } catch (error) { return result(error instanceof RepositoryActionError && error.reason !== 'git-failed' ? 'rejected' : 'failed', error instanceof RepositoryActionError ? error.reason : 'invalid-request') }
  }
  async inspectStash(source: SourceRef, stashOid: string): Promise<RepositoryStashInspection> {
    return this.scoped(source, async repo => {
      if (typeof stashOid !== 'string' || !oid(stashOid) || !(await this.stashes(repo)).includes(stashOid)) fail('invalid-stash', 'Select a current stash object ID.')
      const patch = await this.git(repo, ['stash', 'show', '--patch', '--include-untracked', '--no-ext-diff', '--no-textconv', '--no-color', stashOid])
      return { stashOid, patch: patch.slice(0, 256 * 1024) }
    })
  }
  async output(source: SourceRef): Promise<RepositoryCommandOutput> {
    return this.scoped(source, async repo => ({ text: (this.logs.get(repo.toplevel) ?? []).join('\n') }))
  }
  private async scoped<T>(source: SourceRef, run: (repo: RepoRef) => Promise<T>): Promise<T> {
    try { const repo = await this.ports.resolveRepo(source); return await this.ports.runner.mutate(repo.commonDir, () => run(repo)) }
    catch (error) { if (error instanceof RepositoryActionError) throw error; throw new RepositoryActionError('git-failed', 'Git could not safely inspect or update this repository.') }
  }
  private git(repo: RepoRef, args: string[], write = false): Promise<string> {
    return this.ports.runner.runOk([...safeOptions, ...args], repo.toplevel, write ? { timeoutMs: WRITE_TIMEOUT_MS, lockRetries: 0 } : {})
  }
  private async optional(repo: RepoRef, args: string[]): Promise<string | null> { return this.ports.runner.runSoft([...safeOptions, ...args], repo.toplevel) }
  private async stashes(repo: RepoRef): Promise<string[]> { await this.validateStashPaths(repo); return (await this.git(repo, ['stash', 'list', '--format=%H'])).trim().split('\n').filter(Boolean) }
  private async metadataPath(repo: RepoRef, path: string): Promise<string> {
    const root = resolve(repo.commonDir)
    if (await realpath(root) !== root) fail('unsafe-stash-path', 'Stash metadata must use real repository directories.')
    const parts = relative(root, path).split(sep)
    if (parts.some(part => part === '..' || !part)) fail('unsafe-stash-path', 'Invalid stash metadata path.')
    let current = root
    const identities: unknown[] = []
    const rootStat = await lstat(root)
    identities.push([rootStat.dev, rootStat.ino])
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]!)
      const stat = await lstat(current).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
      if (!stat) { identities.push(null); continue }
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) || await realpath(current) !== current) fail('unsafe-stash-path', 'Symlinked or non-regular stash metadata is not supported.')
      identities.push([stat.dev, stat.ino])
    }
    return hash(identities)
  }
  private async validateStashPaths(repo: RepoRef): Promise<void> {
    for (const path of ['refs/stash', 'logs/refs/stash', 'packed-refs']) await this.metadataPath(repo, join(repo.commonDir, path))
  }
  private name(value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || value.includes('..') || value.includes('//') || value.endsWith('/') || value.endsWith('.lock')) fail('invalid-name', 'Use a literal branch, tag or remote name.')
  }
  private async ref(repo: RepoRef, value: string): Promise<string> {
    if (!value || /^[+-]/.test(value) || /[\x00-\x20\x7f:]/.test(value)) fail('invalid-ref', 'Choose a commit reference, not an option.')
    const target = (await this.git(repo, ['rev-parse', '--verify', '--end-of-options', value + '^{commit}'])).trim()
    if (!oid(target)) fail('invalid-ref', 'The reference must resolve to a commit.')
    return target
  }
  private url(value: string): void {
    if (!value || /^[+-]/.test(value) || /[\x00-\x20\x7f]/.test(value) || value.includes('::')) fail('unsafe-remote', 'Remote helpers and unsafe URLs are not supported.')
    if (isAbsolute(value)) return
    if (/^(?:https?|ssh|file):\/\//.test(value)) {
      try { const url = new URL(value); if (url.search || url.hash || (url.protocol === 'file:' && url.hostname && url.hostname !== 'localhost')) throw new Error(); return } catch { fail('unsafe-remote', 'Use a supported literal remote URL.') }
    }
    // Require an unambiguous host and a non-option repository path.
    if (!value.includes('://') && /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*:[A-Za-z0-9_./~][^:]*$/.test(value)) return
    fail('unsafe-remote', 'Use an absolute local path, SCP-style SSH, or an HTTP(S), SSH or file URL.')
  }
  private async remote(repo: RepoRef, name: string, push: boolean): Promise<string> {
    this.name(name)
    if (!(await this.git(repo, ['remote'])).trim().split('\n').includes(name)) fail('invalid-remote', 'Select a configured remote.')
    const urls = (await this.git(repo, ['remote', 'get-url', ...(push ? ['--push'] : []), '--all', name])).trim().split('\n')
    if (urls.length !== 1) fail('unsafe-remote', 'Exactly one remote URL is required.')
    this.url(urls[0]!)
    return urls[0]!
  }
  private async destination(repo: RepoRef, directory: string): Promise<string> {
    if (!directory || isAbsolute(directory) || directory.includes('\\') || directory.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) fail('unsafe-destination', 'Choose a new relative directory within the source workspace.')
    const root = await realpath(repo.cwd)
    const target = resolve(root, directory)
    if (relative(root, target).startsWith('..' + sep) || target === root) fail('unsafe-destination', 'Clone must stay inside the source workspace.')
    const parts = directory.split('/')
    let current = root
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]!)
      try {
        const stat = await lstat(current)
        if (stat.isSymbolicLink() || !stat.isDirectory() || i === parts.length - 1) fail('unsafe-destination', 'Clone requires an absent destination and real directory parents.')
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && i === parts.length - 1) return target; throw error }
    }
    return fail('unsafe-destination', 'The destination already exists.')
  }
  private async state(repo: RepoRef, network: boolean, metadata: boolean): Promise<{ version: string; head: string | null; status: string; ignored: string; stashes: string[] }> {
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_START', 'index.lock']) {
      try { await lstat(join(repo.gitDir, marker)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      fail('active-operation', 'Finish the active Git operation first.')
    }
    if (await this.git(repo, ['ls-files', '-u', '-z'])) fail('conflicts', 'Resolve existing conflicts first.')
    const flags = await this.git(repo, ['ls-files', '-v', '-z'])
    if (flags.split('\0').some(row => /^[a-zS] /.test(row))) fail('hidden-index-state', 'Hidden index entries are not supported.')
    const config = await this.git(repo, ['config', '--null', '--list'])
    // Never silently bypass configured remote helpers/commands. Refuse before contacting a remote.
    if (config.split('\0').some(row => (!metadata && /^(?:filter\..*\.(?:clean|smudge|process)|merge\..*\.driver)\n/i.test(row)) || (network && /^(?:remote\..*\.(?:vcs|uploadpack|receivepack|proxy)|url\..*\.(?:insteadof|pushinsteadof)|core\.sshcommand|ssh\.variant)\n/i.test(row)))) fail('unsafe-config', 'Executable filters, URL rewrites and remote helper overrides are not supported.')
    const head = (await this.optional(repo, ['rev-parse', '--verify', 'HEAD']))?.trim() ?? null
    const symbolic = await this.optional(repo, ['symbolic-ref', '-q', 'HEAD'])
    // Metadata commands never inspect worktree contents: even diff --no-textconv
    // can execute clean filters. Their approval binds metadata, not unrelated edits.
    if (metadata) {
      const index = await this.git(repo, ['ls-files', '--stage', '-z'])
      const refs = await this.git(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])
      const stashes = await this.stashes(repo)
      return { head, status: '', ignored: '', stashes, version: hash([repo.cwd, repo.toplevel, repo.gitDir, head, symbolic, index, refs, config, stashes]) }
    }
    const status = await this.git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    const ignored = await this.git(repo, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])
    const index = await this.git(repo, ['ls-files', '--stage', '-z'])
    const refs = await this.git(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])
    const diff = await this.ports.runner.runBytesOk([...safeOptions, 'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv'], repo.toplevel)
    const staged = await this.ports.runner.runBytesOk([...safeOptions, 'diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv'], repo.toplevel)
    const stashes = await this.stashes(repo)
    const others = (await this.git(repo, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
    const contents: string[] = []
    // Ignored build/dependency trees can be huge; collision checks inspect their
    // paths immediately before checkout, not their unrelated contents.
    for (const path of others) {
      const full = join(repo.toplevel, path)
      const stat = await lstat(full)
      if (stat.isSymbolicLink()) contents.push(hash([path, await readlink(full)]))
      else {
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) fail('unsupported-file', 'Untracked or ignored data exceeds the safe preview limit.')
        if (!(await realpath(full)).startsWith(await realpath(repo.toplevel) + sep)) fail('unsafe-path', 'External symlink contents are not inspected.')
        contents.push(hash([path, await readFile(full)]))
      }
    }
    return { head, status, ignored, stashes, version: hash([repo.cwd, repo.toplevel, repo.gitDir, head, symbolic, status, ignored, index, refs, config, diff, staged, stashes, contents]) }
  }
  private async plan(repo: RepoRef, input: RepositoryCommandRequest): Promise<Plan> {
    let request: RepositoryCommandRequest
    try { request = parseRepositoryCommand(input) } catch { return fail('invalid-request', 'Choose a supported command with exact fields.') }
    await this.validateStashPaths(repo)
    const metadata = !['pull', 'sync', 'merge', 'rebase', 'stash-pop', 'stash-staged', 'clone'].includes(request.action)
    const state = await this.state(repo, ['pull', 'sync', 'push-force', 'fetch-all', 'publish', 'remote-branch-delete', 'remote-tag-delete', 'tags-push', 'clone'].includes(request.action), metadata)
    let target = '', remoteOid = ''
    let remotes: string[] = [], tags: string[] = []
    const action = request.action
    if (['pull', 'sync', 'merge', 'rebase', 'stash-pop'].includes(action) && state.status) fail('dirty-tree', 'This command requires a clean checkout, including untracked files.')
    if (['pull', 'sync', 'merge', 'rebase', 'push-force', 'publish', 'stash-staged', 'undo-commit'].includes(action) && !state.head) fail('unborn-head', 'This command requires an existing commit.')
    if ('branch' in request) { this.name(request.branch); await this.git(repo, ['check-ref-format', 'refs/heads/' + request.branch]) }
    if ('tag' in request) { this.name(request.tag); await this.git(repo, ['check-ref-format', 'refs/tags/' + request.tag]) }
    if (request.action === 'remote-remove') {
      this.name(request.remote)
      if (!(await this.git(repo, ['remote'])).trim().split('\n').includes(request.remote)) fail('invalid-remote', 'Select a configured remote.')
    }
    if ('remote' in request && request.action !== 'remote-remove') {
      const push = ['sync', 'publish', 'push-force', 'remote-branch-delete', 'remote-tag-delete', 'tags-push'].includes(action)
      const url = await this.remote(repo, request.remote, push)
      if (['push-force', 'remote-branch-delete', 'remote-tag-delete', 'pull', 'sync'].includes(action)) {
        const ref = 'tag' in request ? 'refs/tags/' + request.tag : 'refs/heads/' + ('branch' in request ? request.branch : '')
        const ad = await this.git(repo, ['ls-remote', '--refs', '--', url, ref])
        remoteOid = ad.trim().split(/\s/)[0] ?? ''
        if (!oid(remoteOid)) fail('missing-remote-ref', 'The remote reference does not exist.')
        if (action === 'sync' && url !== await this.remote(repo, request.remote, false)) fail('unsafe-remote', 'Sync requires identical fetch and push URLs.')
      }
    }
    if ('ref' in request) target = await this.ref(repo, request.ref)
    if (action === 'remote-add') { this.name(request.name); this.url(request.url); if ((await this.git(repo, ['remote'])).trim().split('\n').includes(request.name)) fail('remote-exists', 'The remote name already exists.') }
    if (action === 'fetch-all') { remotes = (await this.git(repo, ['remote'])).trim().split('\n').filter(Boolean); for (const name of remotes) await this.remote(repo, name, false) }
    if (action === 'tag-create') { this.name(request.name); await this.git(repo, ['check-ref-format', 'refs/tags/' + request.name]); if (await this.optional(repo, ['show-ref', '--verify', 'refs/tags/' + request.name])) fail('tag-exists', 'The tag already exists.') }
    if (action === 'tag-delete') { target = (await this.git(repo, ['rev-parse', '--verify', 'refs/tags/' + request.tag])).trim() }
    if (action === 'tags-push') tags = (await this.git(repo, ['for-each-ref', '--format=%(objectname):%(refname)', 'refs/tags/'])).trim().split('\n').filter(Boolean)
    if (action === 'stash-pop' || action === 'stash-drop') { if (!oid(request.stashOid) || !state.stashes.includes(request.stashOid)) fail('invalid-stash', 'Select an existing stash object ID.'); if (state.stashes.filter(id => id === request.stashOid).length !== 1) fail('ambiguous-stash', 'Duplicate stash objects cannot be dropped safely.') }
    if (action === 'stash-staged') {
      const unstaged = new Set((await this.git(repo, ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv'])).split('\0').filter(Boolean))
      const staged = (await this.git(repo, ['diff', '--cached', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv'])).split('\0').filter(Boolean)
      if (staged.some(path => unstaged.has(path))) fail('unstaged-changes', 'Staged-only stash refuses staged and unstaged edits in the same file; disjoint edits and untracked files remain untouched.')
    }
    if (action === 'undo-commit') { if (!(await this.optional(repo, ['symbolic-ref', '-q', 'HEAD']))) fail('detached-head', 'Undo requires a checked-out branch.'); target = await this.ref(repo, 'HEAD^') }
    if (action === 'publish' && (await this.optional(repo, ['symbolic-ref', '--short', '-q', 'HEAD']))?.trim() !== request.branch) fail('branch-mismatch', 'Publish requires the current branch name.')
    if (action === 'clone') { this.url(request.url); target = await this.destination(repo, request.directory) }
    return { preview: { version: hash([state.version, request, target, remoteOid, remotes, tags]), request, checkout: repo.toplevel, head: state.head, summary: 'Run ' + action + ' on the approved repository state.', warnings: ['External Git writers do not join this queue. Refresh after execution.', ...(action === 'clone' ? ['Clone checks out files with hooks disabled; submodules are not initialized. Configured executable filters are refused. Existing directories are never removed.'] : []), ...(['pull', 'sync', 'push-force', 'remote-branch-delete', 'remote-tag-delete'].includes(action) ? ['Preview contacts the remote to pin its advertised object ID.'] : [])] }, stashes: state.stashes, target, remoteOid, remotes, tags }
  }
  private async drop(repo: RepoRef, ids: string[], expected: string[], apply = false): Promise<void> {
    // Ordinals are not identities. Hold Git's actual files-backend ref lock so
    // external stash writers cannot shift the reflog between selection and drop.
    const storage = await this.optional(repo, ['config', '--get', 'extensions.refStorage'])
    if (storage && storage.trim().toLowerCase() !== 'files') fail('unsupported-ref-storage', 'Stash deletion requires the files reference backend.')
    if (!expected.length) return
    const ref = join(repo.commonDir, 'refs/stash'), log = join(repo.commonDir, 'logs/refs/stash')
    const packedPath = join(repo.commonDir, 'packed-refs')
    const paths = new Map<string, string>()
    for (const path of [ref, log, packedPath]) paths.set(path, await this.metadataPath(repo, path))
    const locks = new Map<string, { handle: Awaited<ReturnType<typeof open>>; identity: string }>()
    const revalidate = async () => {
      for (const [path, identity] of paths) if (await this.metadataPath(repo, path) !== identity) fail('stash-changed', 'Stash metadata paths changed during the operation.')
      for (const [path, lock] of locks) {
        const stat = await lstat(path)
        const owned = await lock.handle.stat()
        if (stat.dev !== owned.dev || stat.ino !== owned.ino || await this.metadataPath(repo, path) !== lock.identity) fail('stash-changed', 'A stash lock was replaced by another writer.')
      }
    }
    const acquire = async (path: string) => {
      await this.metadataPath(repo, path)
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try {
        const stat = await handle.stat()
        const identity = await this.metadataPath(repo, path)
        locks.set(path, { handle, identity })
        const current = await lstat(path)
        if (stat.dev !== current.dev || stat.ino !== current.ino) fail('stash-changed', 'A stash lock was replaced by another writer.')
        await revalidate()
        return handle
      } catch (error) {
        if (!locks.has(path)) await handle.close()
        throw error
      }
    }
    const read = async (path: string): Promise<Buffer> => {
      await revalidate()
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await handle.stat(), current = await lstat(path)
        if (!stat.isFile() || stat.dev !== current.dev || stat.ino !== current.ino) fail('stash-changed', 'Stash metadata changed while opening it.')
        await revalidate()
        return await handle.readFile()
      } finally { await handle.close() }
    }
    try {
      const refLock = await acquire(ref + '.lock')
      // Exclude pack-refs publishing an old stash value during the update.
      await acquire(packedPath + '.lock')
      const logLock = await acquire(log + '.lock')
      const packed = (await read(packedPath).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0); throw error })).toString('utf8')
      const current = (await read(ref)).toString('utf8').trim()
      if (packed.split('\n').some(line => line.endsWith(' refs/stash')) || !oid(current)) fail('unsupported-stash-ref', 'Stash deletion requires a loose, unpacked stash reference.')
      if (current !== expected[0]) fail('stash-changed', 'The stash inventory changed; nothing was dropped.')
      if ((await lstat(log)).size > 8 * 1024 * 1024) fail('stash-log-too-large', 'The stash reflog exceeds the safe update limit.')
      const raw = (await read(log)).toString('latin1')
      if (!raw.endsWith('\n')) fail('invalid-stash-log', 'The stash reflog is malformed; nothing was dropped.')
      const lines = raw.slice(0, -1).split('\n')
      const rows = lines.map(line => line.match(/^([a-f0-9]{40}|[a-f0-9]{64}) ([a-f0-9]{40}|[a-f0-9]{64})( .*)$/))
      if (rows.some(row => !row) || JSON.stringify(rows.map(row => row![2]).reverse()) !== JSON.stringify(expected)) fail('stash-changed', 'The stash inventory changed; nothing was dropped.')
      if (apply) {
        await this.guardCheckout(repo, ids[0]!, false, true)
        await this.git(repo, ['stash', 'apply', ids[0]!], true)
      }
      const kept = rows.filter(row => !ids.includes(row![2]!))
      // Rewrite predecessor IDs exactly as reflog delete --rewrite would do.
      let previous = '0'.repeat(expected[0]!.length)
      const rewritten = kept.map(row => { const line = previous + ' ' + row![2] + row![3]; previous = row![2]!; return line }).join('\n')
      await revalidate()
      await logLock.writeFile(Buffer.from(rewritten ? rewritten + '\n' : '', 'latin1'))
      await logLock.sync()
      if (kept.length) { await refLock.writeFile(previous + '\n'); await refLock.sync() }
      await revalidate()
      await rename(log + '.lock', log)
      paths.set(log, await this.metadataPath(repo, log))
      await logLock.close()
      locks.delete(log + '.lock')
      await revalidate()
      if (kept.length) { await rename(ref + '.lock', ref); await refLock.close(); locks.delete(ref + '.lock') }
      else {
        // update-ref honours the lock we hold; remove only the validated loose
        // stash reference. Packed refs are refused before entering this path.
        await unlink(ref)
      }
    } finally {
      for (const [path, lock] of locks) {
        try {
          const owned = await lock.handle.stat(), current = await lstat(path)
          // Never delete a foreign replacement, including a replaced ancestor.
          if (owned.dev === current.dev && owned.ino === current.ino && await this.metadataPath(repo, path) === lock.identity) await unlink(path)
        } catch { /* Missing, replaced or unsafe locks belong to external writers. */ }
        finally { await lock.handle.close() }
      }
    }
  }
  private async guardCheckout(repo: RepoRef, target: string, replay: boolean, stash = false): Promise<void> {
    const head = await this.ref(repo, 'HEAD')
    const commits = replay ? (await this.git(repo, ['rev-list', '--max-count=2011', target + '..' + head])).trim().split('\n').filter(Boolean) : []
    const trees = [head, target]
    if (stash) {
      trees.push(await this.ref(repo, target + '^1'), await this.ref(repo, target + '^2'))
      const untracked = await this.optional(repo, ['rev-parse', '--verify', target + '^3'])
      if (untracked) trees.push(untracked.trim())
    }
    const safeReads = {
      runOk: (args: readonly string[], cwd: string) => this.ports.runner.runOk([...safeOptions, ...args], cwd),
      runBytesOk: (args: readonly string[], cwd: string) => this.ports.runner.runBytesOk([...safeOptions, ...args], cwd),
    }
    if (await findUntrackedCollision(safeReads, repo.toplevel, { commits, trees })) fail('ignored-collision', 'An ignored or untracked path would overlap this checkout. Move it aside first.')
  }
  private async push(repo: RepoRef, remote: string, specs: string[], lease?: string): Promise<void> {
    await this.git(repo, ['-c', 'push.autoSetupRemote=false', 'push', '--porcelain', '--no-mirror', '--no-follow-tags', '--recurse-submodules=no', ...(lease ? ['--force-with-lease=' + lease] : ['--no-force']), '--', remote, ...specs], true)
  }
  private async fetch(repo: RepoRef, remote: string, prune: boolean): Promise<void> {
    await this.git(repo, ['fetch', '--no-tags', '--no-prune-tags', '--no-recurse-submodules', '--refmap=', prune ? '--prune' : '--no-prune', '--', remote, '+refs/heads/*:refs/remotes/' + remote + '/*'], true)
  }
  private async run(repo: RepoRef, plan: Plan): Promise<RepositoryActionResult> {
    const r = plan.preview.request
    switch (r.action) {
      case 'pull': case 'sync': {
        await this.fetch(repo, r.remote, false)
        const fetched = (await this.git(repo, ['rev-parse', '--verify', 'refs/remotes/' + r.remote + '/' + r.branch])).trim()
        if (fetched !== plan.remoteOid) return result('rejected', 'stale-preview')
        await this.guardCheckout(repo, plan.remoteOid, r.action === 'pull' && r.rebase)
        await this.git(repo, r.action === 'pull' && r.rebase ? ['-c', 'rebase.autoStash=false', 'rebase', '--no-autostash', plan.remoteOid] : ['-c', 'merge.autoStash=false', 'merge', '--ff-only', '--no-autostash', plan.remoteOid], true)
        if (r.action === 'sync') await this.push(repo, r.remote, [(await this.ref(repo, 'HEAD')) + ':refs/heads/' + r.branch])
        break
      }
      case 'push-force': await this.push(repo, r.remote, [plan.preview.head! + ':refs/heads/' + r.branch], 'refs/heads/' + r.branch + ':' + plan.remoteOid); break
      case 'fetch-all': for (const remote of plan.remotes) await this.fetch(repo, remote, r.prune); break
      case 'publish': await this.push(repo, r.remote, [plan.preview.head! + ':refs/heads/' + r.branch]); await this.git(repo, ['config', 'branch.' + r.branch + '.remote', r.remote], true); await this.git(repo, ['config', 'branch.' + r.branch + '.merge', 'refs/heads/' + r.branch], true); break
      case 'merge': await this.guardCheckout(repo, plan.target, false); await this.git(repo, ['-c', 'merge.autoStash=false', 'merge', '--no-edit', '--no-autostash', plan.target], true); break
      case 'rebase': await this.guardCheckout(repo, plan.target, true); await this.git(repo, ['-c', 'rebase.autoStash=false', 'rebase', '--no-autostash', plan.target], true); break
      case 'remote-add': await this.git(repo, ['remote', 'add', '--', r.name, r.url], true); break
      case 'remote-remove': await this.git(repo, ['remote', 'remove', r.remote], true); break
      case 'remote-branch-delete': await this.push(repo, r.remote, [':refs/heads/' + r.branch], 'refs/heads/' + r.branch + ':' + plan.remoteOid); break
      case 'remote-tag-delete': await this.push(repo, r.remote, [':refs/tags/' + r.tag], 'refs/tags/' + r.tag + ':' + plan.remoteOid); break
      case 'tag-create': await this.git(repo, ['tag', '--no-sign', ...(r.message ? ['--annotate', '--message', r.message] : []), '--', r.name, plan.target], true); break
      case 'tag-delete': await this.git(repo, ['update-ref', '-d', 'refs/tags/' + r.tag, plan.target], true); break
      case 'tags-push': if (plan.tags.length) await this.push(repo, r.remote, plan.tags); else return result('noop'); break
      case 'stash-staged': {
        await this.git(repo, ['stash', 'push', '--staged', '--message', r.message], true)
        const after = await this.stashes(repo)
        return after[0] === plan.stashes[0] ? result('noop') : { ...result('completed'), stashOid: after[0] ?? null }
      }
      case 'stash-pop': await this.drop(repo, [r.stashOid], plan.stashes, true); break
      case 'stash-drop': await this.drop(repo, [r.stashOid], plan.stashes); break
      case 'stash-clear': await this.drop(repo, plan.stashes, plan.stashes); break
      case 'undo-commit': await this.git(repo, ['reset', '--soft', plan.target], true); break
      case 'clone': await this.destination(repo, r.directory); await mkdir(plan.target, { mode: 0o700 }); await this.git(repo, ['clone', '--no-recurse-submodules', '--no-local', '--template=', '--', r.url, plan.target], true); break
    }
    return result('completed')
  }
}
