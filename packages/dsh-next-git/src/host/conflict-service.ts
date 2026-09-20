import { constants } from 'node:fs'
import { lstat, mkdir, open, readlink, realpath, rename, symlink, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parseConflictText, validateConflictResult } from '../core/conflicts.ts'
import type { ConflictChooseInput, ConflictFile, ConflictFileChoice, ConflictOperationLabels, ConflictResolvedResult, ConflictSaveInput, ConflictVersionInput, ConflictWorkspace, ConflictWriteResult } from '../core/conflict-types.ts'
import { GitError, type GitRunner, WRITE_TIMEOUT_MS } from './git-runner.ts'
import type { RepoRef, SourceRef } from './git-service.ts'

/** Both raw blobs and editable text are bounded before allocation. */
export const CONFLICT_MAX_BYTES = 2 * 1024 * 1024

export interface ConflictServicePorts {
  readonly runner: Pick<GitRunner, 'runOk' | 'runSoft' | 'runBytesOk' | 'mutate'>
  readonly resolveRepo: (source: SourceRef) => Promise<RepoRef>
}

interface FileData { dto: ConflictFile; bytes: Buffer | null; hash: string; permissions: number }
interface Snapshot {
  dto: ConflictWorkspace
  stages: { base: FileData; current: FileData; incoming: FileData }
  work: FileData
  index: string
  head: string
  context: string
}
const absent = (): FileData => ({ dto: { kind: 'absent', mode: null, oid: null, size: 0, content: null }, bytes: null, hash: '', permissions: 0 })
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
function fail(detail: string, code: 'invalid-name' | 'git-failed' | 'dirty-tree' | 'path-missing' = 'git-failed'): never {
  throw new GitError({ code, detail })
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT' }
function textOf(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
  // Buffer decoding preserves a UTF-8 BOM, unlike TextDecoder's default behavior.
  return bytes.toString('utf8')
}
function fileData(bytes: Buffer, mode: string, oid: string | null, permissions = 0o644): FileData {
  const text = mode === '120000' ? null : textOf(bytes)
  return { dto: { kind: mode === '120000' ? 'symlink' : text === null ? 'binary' : 'text', mode, oid, size: bytes.length, content: text }, bytes, hash: hash(bytes), permissions }
}

/**
 * A checked, versioned conflict workspace. The shared runner serializes plugin
 * calls only; external Git and editors are not locked out. Rechecks narrow that
 * race but Node's path APIs cannot provide an OS-wide filesystem transaction.
 */
export class ConflictService {
  constructor(private readonly ports: ConflictServicePorts) {}

  async inspect(source: SourceRef, path: string): Promise<ConflictWorkspace> {
    const repo = await this.ports.resolveRepo(source)
    return this.ports.runner.mutate(repo.commonDir, async () => (await this.snapshot(repo, path)).dto)
  }

  async save(source: SourceRef, input: ConflictSaveInput): Promise<ConflictWriteResult> {
    if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > CONFLICT_MAX_BYTES) fail('Conflict content exceeds the editable byte limit')
    const bytes = Buffer.from(input.content)
    if (textOf(bytes) === null || bytes.toString('utf8') !== input.content) fail('Conflict content must be valid UTF-8 text without NUL bytes')
    return this.write(source, input, async (repo, snapshot) => {
      if (!snapshot.dto.canSave) fail('This conflict cannot be saved as text')
      const backupId = await this.backup(repo, snapshot, 'save')
      await this.assertFresh(repo, input)
      const selected = fileData(bytes, snapshot.work.dto.mode ?? '100644', null, snapshot.work.dto.kind === 'absent' ? 0o644 : snapshot.work.permissions)
      await this.replace(repo, input, selected)
      const next = await this.snapshot(repo, input.path)
      this.assertWritten(snapshot, next, selected)
      return { workspace: next.dto, backupId }
    })
  }

  async choose(source: SourceRef, input: ConflictChooseInput): Promise<ConflictWriteResult> {
    return this.write(source, input, async (repo, snapshot) => {
      if (!snapshot.dto.choices.includes(input.side)) fail('The selected file-level conflict action is not supported')
      const selected = input.side === 'delete' ? absent() : snapshot.stages[input.side]
      if (selected.dto.kind === 'absent' && input.side !== 'delete') fail('The selected index stage is absent; choose delete explicitly')
      if (selected.dto.kind === 'symlink') this.safeLink(input.path, selected.bytes!)
      const backupId = await this.backup(repo, snapshot, input.side)
      await this.assertFresh(repo, input)
      await this.replace(repo, input, selected)
      const next = await this.snapshot(repo, input.path)
      this.assertWritten(snapshot, next, selected)
      // A durable receipt makes binary/symlink/deletion staging an explicit choice,
      // including after a host restart. Any later byte/mode/index change invalidates it.
      await this.receipt(repo, input.path, next.dto.version)
      return { workspace: { ...next.dto, canMarkResolved: this.markerFree(next.work, next.dto.markerSize) }, backupId }
    })
  }

  async markResolved(source: SourceRef, input: ConflictVersionInput): Promise<ConflictResolvedResult> {
    return this.write(source, input, async (repo, snapshot) => {
      if (!snapshot.dto.canMarkResolved) fail('Conflict result has unresolved markers or requires an explicit supported file-level choice')
      const backupId = await this.backup(repo, snapshot, 'mark-resolved')
      await this.assertFresh(repo, input)
      // Do not call GitService.stage: its public safety gate rejects conflicts.
      await this.ports.runner.runOk(['--literal-pathspecs', 'add', '--', input.path], repo.toplevel, { timeoutMs: WRITE_TIMEOUT_MS, lockRetries: 0 })
      const remaining = await this.ports.runner.runOk(['--literal-pathspecs', 'ls-files', '-u', '-z', '--', input.path], repo.toplevel)
      if (remaining !== '') fail('Git did not resolve the selected index path')
      return { path: input.path, resolved: true, backupId }
    })
  }

  private async write<T>(source: SourceRef, input: ConflictVersionInput, action: (repo: RepoRef, snapshot: Snapshot) => Promise<T>): Promise<T> {
    const repo = await this.ports.resolveRepo(source)
    return this.ports.runner.mutate(repo.commonDir, async () => action(repo, await this.assertFresh(repo, input)))
  }

  private async assertFresh(repo: RepoRef, input: ConflictVersionInput): Promise<Snapshot> {
    const snapshot = await this.snapshot(repo, input.path)
    if (typeof input.expectedVersion !== 'string' || input.expectedVersion !== snapshot.dto.version) fail('Conflict version is stale; inspect the path again before modifying it', 'dirty-tree')
    return snapshot
  }

  private async safePath(repo: RepoRef, path: string): Promise<string> {
    if (typeof path !== 'string' || path === '' || isAbsolute(path) || /[\\\0]/.test(path) || /^[A-Za-z]:/.test(path)) fail('Conflict path must be a repository-relative literal path', 'invalid-name')
    const parts = path.split('/')
    if (parts.some(part => part === '' || part === '.' || part === '..' || part.toLowerCase() === '.git' || part.toLowerCase().startsWith('.git:'))) fail('Unsafe conflict path component', 'invalid-name')
    const root = await realpath(repo.toplevel)
    let parent = root
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part)
      const stat = await lstat(parent)
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Conflict path has a symlink or non-directory ancestor', 'invalid-name')
    }
    return join(root, ...parts)
  }

  private async worktree(repo: RepoRef, path: string): Promise<FileData> {
    const target = await this.safePath(repo, path)
    let stat
    try { stat = await lstat(target) } catch (error) { if (missing(error)) return absent(); throw error }
    if (stat.isSymbolicLink()) return fileData(await readlink(target, { encoding: 'buffer' }), '120000', null, stat.mode & 0o7777)
    if (!stat.isFile()) return { dto: { kind: 'nonregular', mode: stat.mode.toString(8), oid: null, size: stat.size, content: null }, bytes: null, hash: '', permissions: stat.mode & 0o7777 }
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const before = await file.stat()
      if (!before.isFile() || before.ino !== stat.ino || before.dev !== stat.dev) fail('Conflict file changed while opening', 'dirty-tree')
      const digest = createHash('sha256')
      const chunk = Buffer.alloc(64 * 1024)
      const buffers: Buffer[] = []
      let total = 0
      while (total <= before.size) {
        const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, before.size + 1 - total), null)
        if (bytesRead === 0) break
        total += bytesRead
        digest.update(chunk.subarray(0, bytesRead))
        if (total <= CONFLICT_MAX_BYTES) buffers.push(Buffer.from(chunk.subarray(0, bytesRead)))
      }
      const after = await file.stat()
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || total !== after.size) fail('Conflict file changed while reading', 'dirty-tree')
      const mode = (stat.mode & 0o111) !== 0 ? '100755' : '100644'
      if (total > CONFLICT_MAX_BYTES) return { dto: { kind: 'oversize', mode, oid: null, size: total, content: null }, bytes: null, hash: digest.digest('hex'), permissions: stat.mode & 0o7777 }
      return fileData(Buffer.concat(buffers), mode, null, stat.mode & 0o7777)
    } finally { await file.close() }
  }

  private async stage(repo: RepoRef, mode: string, oid: string): Promise<FileData> {
    if (mode === '160000') return { dto: { kind: 'submodule', mode, oid, size: 0, content: null }, bytes: null, hash: oid, permissions: 0 }
    if (!['100644', '100755', '120000'].includes(mode)) fail('Unsupported conflict index mode')
    const size = Number((await this.ports.runner.runOk(['cat-file', '-s', oid], repo.toplevel)).trim())
    if (!Number.isSafeInteger(size) || size < 0) fail('Invalid Git blob size')
    if (size > CONFLICT_MAX_BYTES) return { dto: { kind: 'oversize', mode, oid, size, content: null }, bytes: null, hash: oid, permissions: 0 }
    const bytes = Buffer.from(await this.ports.runner.runBytesOk(['cat-file', 'blob', oid], repo.toplevel))
    if (bytes.length !== size) fail('Git blob length changed while reading')
    return fileData(bytes, mode, oid, mode === '100755' ? 0o755 : 0o644)
  }

  private async labels(repo: RepoRef): Promise<{ labels: ConflictOperationLabels; head: string }> {
    const run = (args: readonly string[]) => this.ports.runner.runSoft(args, repo.toplevel)
    const head = (await run(['rev-parse', '--verify', 'HEAD']))?.trim() ?? ''
    const branch = (await run(['symbolic-ref', '--quiet', '--short', 'HEAD']))?.trim() ?? null
    for (const [ref, operation] of [['REBASE_HEAD', 'rebase'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'], ['MERGE_HEAD', 'merge']] as const) {
      const oid = (await run(['rev-parse', '--verify', ref]))?.trim()
      if (oid) {
        const replay = operation === 'rebase' || operation === 'cherry-pick'
        // Reverting a merge can select any mainline parent. Do not guess that
        // stage 3 came from the first parent when Git does not expose that choice.
        const parents = operation === 'revert' ? (await run(['rev-list', '--parents', '-n', '1', oid]))?.trim().split(' ').slice(1) ?? [] : []
        const incomingRef = operation === 'revert' ? parents.length === 1 ? parents[0]! : null : oid
        return { head, labels: {
          operation,
          current: operation === 'rebase' ? 'Rebased-onto history (index stage 2)' : 'Current checkout (index stage 2)',
          incoming: replay ? 'Replayed commit (index stage 3)' : operation === 'revert' ? 'Reverted parent (index stage 3)' : 'Merged commit (index stage 3)',
          base: replay ? 'Parent of replayed commit (index stage 1)' : operation === 'revert' ? 'Reverted commit (index stage 1)' : 'Merge base (index stage 1)',
          currentRef: branch ?? (head || null), incomingRef,
        } }
      }
    }
    return { head, labels: { operation: 'unknown', current: 'Index stage 2', incoming: 'Index stage 3', base: 'Index stage 1', currentRef: branch ?? (head || null), incomingRef: null } }
  }

  private async markerConfig(repo: RepoRef, path: string): Promise<{ value: string; size: number | null; attributes: Record<string, string> }> {
    const names = ['conflict-marker-size', 'working-tree-encoding', 'filter', 'text', 'eol', 'ident']
    const raw = await this.ports.runner.runOk(['--literal-pathspecs', 'check-attr', '-z', ...names, '--', path], repo.toplevel)
    const fields = raw.split('\0')
    if (fields.length !== names.length * 3 + 1 || fields.at(-1) !== '') fail('Unexpected Git conflict attribute record')
    const attributes: Record<string, string> = {}
    for (let i = 0; i < fields.length - 1; i += 3) {
      if (fields[i] !== path || !names.includes(fields[i + 1]!)) fail('Unexpected Git conflict attribute record')
      attributes[fields[i + 1]!] = fields[i + 2]!
    }
    const value = attributes['conflict-marker-size']!
    if (['unspecified', 'set', 'unset'].includes(value)) return { value, size: 7, attributes }
    // Git uses a signed int. Do not emulate atoi overflow/partial parsing or
    // allocate marker strings from untrusted attributes; unsupported values block writes.
    const size = /^[0-9]+$/.test(value) ? Number(value) : NaN
    return { value, size: Number.isSafeInteger(size) && size > 0 && size <= 0x7fffffff ? size : null, attributes }
  }

  private assertWritten(before: Snapshot, after: Snapshot, selected: FileData): void {
    const regular = selected.dto.kind === 'text' || selected.dto.kind === 'binary'
    if (after.context !== before.context || after.work.hash !== selected.hash || after.work.dto.mode !== selected.dto.mode || (regular && after.work.permissions !== selected.permissions)) {
      fail('Conflict changed after writing; inspect again', 'dirty-tree')
    }
  }

  private async snapshot(repo: RepoRef, path: string): Promise<Snapshot> {
    await this.safePath(repo, path)
    const index = await this.ports.runner.runOk(['--literal-pathspecs', 'ls-files', '-u', '-z', '--', path], repo.toplevel)
    if (index === '') fail('The selected path has no unresolved index stages', 'path-missing')
    const stages = { base: absent(), current: absent(), incoming: absent() }
    for (const row of index.split('\0')) {
      if (row === '') continue
      const match = /^(\d{6}) ([a-f0-9]{40,64}) ([123])\t([\s\S]*)$/.exec(row)
      if (!match || match[4] !== path) fail('Unexpected Git conflict index record')
      const key = match[3] === '1' ? 'base' : match[3] === '2' ? 'current' : 'incoming'
      stages[key] = await this.stage(repo, match[1]!, match[2]!)
    }
    const marker = await this.markerConfig(repo, path)
    const markerSize = marker.size
    const work = await this.worktree(repo, path)
    const { labels, head } = await this.labels(repo)
    const conversionConfig = await this.ports.runner.runSoft(['config', '--null', '--get-regexp', '^(filter\\.|core\\.(autocrlf|eol|safecrlf))'], repo.toplevel)
    const context = hash(JSON.stringify([repo.toplevel, repo.gitDir, path, head, labels, index, marker.attributes, conversionConfig]))
    const version = hash(JSON.stringify([context, work.dto.kind, work.dto.mode, work.permissions, work.dto.size, work.hash]))
    const all = [...Object.values(stages), work]
    const conversion = ['working-tree-encoding', 'filter'].some(name => !['unspecified', 'unset'].includes(marker.attributes[name] ?? 'unspecified'))
    const unsupportedReason = conversion ? 'Custom working-tree encoding or Git filters require an external resolution workflow; raw blob choices would corrupt content' : markerSize === null ? 'Unsupported conflict-marker-size attribute; resolve externally or configure a positive signed integer width' : all.some(file => file.dto.kind === 'submodule') ? 'Submodule conflicts require an external Git workflow' : all.some(file => file.dto.kind === 'oversize') ? 'Conflict input exceeds the supported byte limit' : work.dto.kind === 'nonregular' ? 'Conflict worktree path is not a regular file or symlink' : null
    const canSave = unsupportedReason === null && (work.dto.kind === 'text' || work.dto.kind === 'absent') && Object.values(stages).every(file => file.dto.kind === 'text' || file.dto.kind === 'absent')
    const choices: ConflictFileChoice[] = []
    if (unsupportedReason === null) {
      for (const side of ['current', 'incoming', 'base'] as const) if (stages[side].dto.kind !== 'absent') {
        if (stages[side].dto.kind === 'symlink') { try { this.safeLink(path, stages[side].bytes!) } catch { continue } }
        choices.push(side)
      }
      choices.push('delete')
    }
    const explicit = await this.hasReceipt(repo, path, version)
    const canMarkResolved = unsupportedReason === null && this.markerFree(work, markerSize) && (canSave && work.dto.kind === 'text' || explicit)
    return { dto: { path, version, markerSize, stages: { base: stages.base.dto, current: stages.current.dto, incoming: stages.incoming.dto }, worktree: work.dto, labels, model: work.dto.content === null || markerSize === null ? null : parseConflictText(work.dto.content, markerSize), canSave, canMarkResolved, choices, unsupportedReason }, stages, work, index, head, context }
  }

  private markerFree(file: FileData, markerSize: number | null): boolean {
    return markerSize !== null && (file.dto.content === null || validateConflictResult(file.dto.content, markerSize).valid)
  }

  private safeLink(path: string, bytes: Buffer): void {
    const target = textOf(bytes)
    if (!target || isAbsolute(target) || /[\\\0]/.test(target) || /^[A-Za-z]:/.test(target)) fail('Unsafe symlink target')
    const root = resolve('/conflict-root')
    const resolved = resolve(root, dirname(path), target)
    if (!resolved.startsWith(root + '/') || resolved.split('/').some(part => part.toLowerCase() === '.git')) fail('Symlink target escapes the checkout or targets Git metadata')
  }

  private async replace(repo: RepoRef, input: ConflictVersionInput, file: FileData): Promise<void> {
    const path = input.path
    const target = await this.safePath(repo, path)
    const parent = dirname(target)
    const before = await lstat(parent)
    const temp = join(parent, '.dsh-conflict-' + randomUUID())
    try {
      if (file.dto.kind !== 'absent') {
        if (file.dto.kind === 'symlink') await symlink(file.bytes!.toString('utf8'), temp)
        else await this.durableFile(temp, file.bytes!, file.permissions)
      }
      await this.assertFresh(repo, input)
      await this.safePath(repo, path)
      const after = await lstat(parent)
      if (before.ino !== after.ino || before.dev !== after.dev) fail('Conflict parent directory changed before replacement', 'dirty-tree')
      if (file.dto.kind === 'absent') { try { await unlink(target) } catch (error) { if (!missing(error)) throw error } }
      else await rename(temp, target)
      await this.syncDirectory(parent)
    } finally { try { await unlink(temp) } catch (error) { if (!missing(error)) throw error } }
  }

  private async storage(repo: RepoRef): Promise<string> {
    const root = await realpath(repo.gitDir)
    const dir = join(root, 'dsh-conflicts')
    try { await mkdir(dir, { mode: 0o700 }); await this.syncDirectory(root) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const stat = await lstat(dir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Conflict backup storage is not a safe directory')
    return dir
  }

  private async durableFile(path: string, bytes: Uint8Array, mode: number): Promise<void> {
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode)
    try { await file.writeFile(bytes); await file.chmod(mode); await file.sync() } finally { await file.close() }
  }

  private async syncDirectory(path: string): Promise<void> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await file.sync() } finally { await file.close() }
  }

  private async backup(repo: RepoRef, snapshot: Snapshot, action: string): Promise<string> {
    const storage = await this.storage(repo)
    const id = randomUUID()
    const dir = join(storage, id)
    await mkdir(dir, { mode: 0o700 })
    for (const [name, file] of Object.entries({ ...snapshot.stages, worktree: snapshot.work })) {
      if (file.bytes !== null) await this.durableFile(join(dir, name), file.bytes, 0o600)
    }
    const manifest = { schema: 1, action, path: snapshot.dto.path, version: snapshot.dto.version, head: snapshot.head, index: snapshot.index, stages: snapshot.dto.stages, worktree: { ...snapshot.work.dto, permissions: snapshot.work.permissions }, labels: snapshot.dto.labels, markerSize: snapshot.dto.markerSize }
    await this.durableFile(join(dir, 'manifest.json'), Buffer.from(JSON.stringify(manifest)), 0o600)
    await this.syncDirectory(dir)
    await this.syncDirectory(storage)
    return id
  }

  private async receipt(repo: RepoRef, path: string, version: string): Promise<void> {
    const storage = await this.storage(repo)
    const target = join(storage, 'choice-' + hash(path))
    const temp = target + '-' + randomUUID()
    await this.durableFile(temp, Buffer.from(version), 0o600)
    try { await rename(temp, target); await this.syncDirectory(storage) } finally { try { await unlink(temp) } catch (error) { if (!missing(error)) throw error } }
  }

  private async hasReceipt(repo: RepoRef, path: string, version: string): Promise<boolean> {
    // Reads do not create operation storage.
    const dir = join(await realpath(repo.gitDir), 'dsh-conflicts')
    try {
      const stat = await lstat(dir)
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Conflict backup storage is not a safe directory')
      const file = await open(join(dir, 'choice-' + hash(path)), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size !== 64) return false
        const buffer = Buffer.alloc(64)
        const { bytesRead } = await file.read(buffer, 0, 64, 0)
        return bytesRead === 64 && buffer.toString() === version
      } finally { await file.close() }
    } catch (error) { if (missing(error)) return false; throw error }
  }
}