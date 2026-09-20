/**
 * Best-effort rollback of commit-all's index, never of working-tree files.
 *
 * The real index.lock closes the compare/read-tree race for cooperating Git
 * writers. This is NOT a global transaction: another writer can act between
 * capture and add, or between add and the caller's stagedTree capture; a writer
 * producing identical logical entries is indistinguishable. HEAD/ref writers
 * and processes ignoring index.lock are not serialized by this lock. Repeated
 * path/inode/HEAD checks detect observed interference, not hostile filesystem
 * races (Node has no portable openat/renameat directory-handle API).
 */
import { constants, type Stats } from 'node:fs'
import * as fs from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import type { GitRunner } from './git-runner.ts'
import type { RepoRef } from './git-service.ts'

const MAX_INDEX_BYTES = 32 * 1024 * 1024
const snapshots = new WeakMap<IndexSnapshot, SavedIndex>()

/** Opaque, single-attempt token; retain only until the commit finishes. */
export interface IndexSnapshot {
  readonly indexPath: string
}

interface SavedIndex {
  readonly repo: RepoRef
  readonly bytes: Buffer | null
  readonly mode: number
  readonly head: string
  readonly directories: ReadonlyMap<string, Stats>
}

function sameInode(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

function sameFile(a: Stats, b: Stats): boolean {
  return sameInode(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs && a.mode === b.mode
}

async function maybeStat(path: string): Promise<Stats | null> {
  try { return await fs.lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Check every component, not just the leaf; missing tails are allowed. */
async function safePath(path: string, directories: Map<string, Stats>): Promise<Stats | null> {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Non-canonical metadata path')
  let current = parse(path).root
  const parts = path.slice(current.length).split(sep).filter(Boolean)
  let stat = await fs.lstat(current)
  for (let i = 0; i < parts.length; i++) {
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe metadata directory')
    const previous = directories.get(current)
    if (previous !== undefined && !sameInode(previous, stat)) throw new Error('Metadata directory moved')
    directories.set(current, stat)
    current = join(current, parts[i]!)
    const next = await maybeStat(current)
    if (next === null) return null
    if (next.isSymbolicLink()) throw new Error('Symlink metadata')
    stat = next
  }
  if (stat.isDirectory()) {
    const previous = directories.get(path)
    if (previous !== undefined && !sameInode(previous, stat)) throw new Error('Metadata directory moved')
    directories.set(path, stat)
  }
  return stat
}

async function readBounded(path: string, maxBytes: number): Promise<{ bytes: Buffer; stat: Stats } | null> {
  const before = await maybeStat(path)
  if (before === null) return null
  if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) throw new Error('Unsafe index file')
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!sameFile(before, stat)) throw new Error('File changed before snapshot')
    const bytes = Buffer.alloc(stat.size + 1)
    let count = 0
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, count)
      if (read.bytesRead === 0) break
      count += read.bytesRead
    }
    const after = await maybeStat(path)
    if (count !== stat.size || !sameFile(stat, await handle.stat()) || after === null || !sameFile(stat, after)) {
      throw new Error('File changed during snapshot')
    }
    return { bytes: bytes.subarray(0, count), stat }
  } finally { await handle.close() }
}

async function validatePaths(runner: GitRunner, repo: RepoRef, directories: Map<string, Stats>): Promise<string> {
  // Conventional primary and linked worktrees only. Separate/outside metadata
  // and alternate active indexes decline rollback rather than guessing authority.
  if (repo.commonDir !== join(repo.root, '.git')) throw new Error('Outside common metadata')
  const local = relative(repo.commonDir, repo.gitDir)
  if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new Error('Outside git metadata')
  for (const path of [repo.root, repo.toplevel, repo.commonDir, repo.gitDir]) {
    if (!(await safePath(path, directories))?.isDirectory()) throw new Error('Missing metadata directory')
  }
  for (const path of [join(repo.toplevel, '.git'), join(repo.gitDir, 'HEAD'), join(repo.gitDir, 'commondir'),
    join(repo.commonDir, 'config'), join(repo.gitDir, 'config.worktree'),
    join(repo.commonDir, 'objects'), join(repo.commonDir, 'refs'), join(repo.commonDir, 'packed-refs')]) {
    await safePath(path, directories)
  }
  const index = join(repo.gitDir, 'index')
  const stat = await safePath(index, directories)
  if (stat !== null && (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_INDEX_BYTES)) throw new Error('Unsafe index file')
  const paths = (await runner.runOk(['rev-parse', '--path-format=absolute', '--absolute-git-dir',
    '--git-common-dir', '--show-toplevel', '--git-path', 'index'], repo.toplevel)).trimEnd().split('\n')
  if (paths.length !== 4 || paths[0] !== repo.gitDir || paths[1] !== repo.commonDir
    || paths[2] !== repo.toplevel || paths[3] !== index) throw new Error('Active repository path changed')
  // A raw split index depends on an independently removable sharedindex file.
  if ((await runner.runOk(['rev-parse', '--shared-index-path'], repo.toplevel)).trim() !== '') {
    throw new Error('Split index snapshot unsupported')
  }
  return index
}

async function headState(runner: GitRunner, repo: RepoRef, directories: Map<string, Stats>): Promise<string> {
  const path = join(repo.gitDir, 'HEAD')
  await safePath(path, directories)
  const file = await readBounded(path, 4096)
  if (file === null) throw new Error('Missing HEAD')
  const head = file.bytes.toString('utf8').trim()
  const ref = head.startsWith('ref: ') ? head.slice(5) : null
  if (ref !== null) {
    if (!/^refs\/heads\/[A-Za-z0-9_./-]+$/.test(ref) || ref.split('/').some(part => part === '..' || part === '.')) {
      throw new Error('Uncertain symbolic HEAD')
    }
    const refPath = join(repo.commonDir, ref)
    await safePath(refPath, directories)
    const loose = await readBounded(refPath, 4096)
    if (loose !== null && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?\n?$/.test(loose.bytes.toString('utf8'))) {
      throw new Error('Uncertain HEAD ref')
    }
  } else if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(head)) throw new Error('Invalid HEAD')
  const outcome = await runner.run(['rev-parse', '--verify', '--quiet', 'HEAD'], repo.toplevel)
  const oid = outcome.stdout.trim()
  if (outcome.code === 0 && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(oid)) return head + '\0' + oid
  if (outcome.code === 1 && ref !== null) {
    const exists = await runner.run(['show-ref', '--verify', '--quiet', ref], repo.toplevel)
    if (exists.code === 1) return head + '\0unborn'
  }
  throw new Error('Cannot establish HEAD')
}

/**
 * Call under the shared runner mutation queue, immediately BEFORE plugin add.
 * Null means capture is unsafe/unavailable; callers may proceed without rollback.
 * Never infer an absent index from a permission, size, or read error.
 */
export async function captureIndexSnapshot(runner: GitRunner, repo: RepoRef): Promise<IndexSnapshot | null> {
  try {
    const directories = new Map<string, Stats>()
    const indexPath = await validatePaths(runner, repo, directories)
    if (await maybeStat(indexPath + '.lock') !== null) return null
    const head = await headState(runner, repo, directories)
    const file = await readBounded(indexPath, MAX_INDEX_BYTES)
    await validatePaths(runner, repo, directories)
    if (await headState(runner, repo, directories) !== head || await maybeStat(indexPath + '.lock') !== null) return null
    const after = await maybeStat(indexPath)
    if (file === null ? after !== null : after === null || !sameFile(file.stat, after)) return null
    const snapshot: IndexSnapshot = Object.freeze({ indexPath })
    snapshots.set(snapshot, { repo: { ...repo }, bytes: file?.bytes ?? null, mode: (file?.stat.mode ?? 0o600) & 0o7777, head, directories })
    return snapshot
  } catch { return null }
}

/** Byte-reversible filenames, including tabs/newlines and invalid UTF-8. */
function entries(bytes: Uint8Array, tree: boolean): Map<string, string> {
  const text = Buffer.from(bytes).toString('latin1')
  if (text !== '' && !text.endsWith('\0')) throw new Error('Truncated Git metadata')
  const result = new Map<string, string>()
  for (const record of text.split('\0').slice(0, -1)) {
    const tab = record.indexOf('\t')
    const metadata = record.slice(0, tab)
    const path = record.slice(tab + 1)
    const match = tree
      ? /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40}(?:[a-f0-9]{24})?)$/.exec(metadata)
      : /^(100644|100755|120000|160000) ([a-f0-9]{40}(?:[a-f0-9]{24})?) 0$/.exec(metadata)
    if (tab < 0 || path === '' || match === null || result.has(path)) throw new Error('Uncertain index entries')
    result.set(path, match[1]! + ' ' + match[tree ? 3 : 2]!)
  }
  return result
}

/**
 * Single attempt; never throws, retries, steals a lock, or writes worktree files.
 * stagedTree must be the full tree captured immediately after successful add.
 * The original commit/hook error must be rethrown by the caller regardless of
 * this boolean. False leaves the current index alone (cleanup is best effort).
 */
export async function restoreIndexSnapshot(
  runner: GitRunner, repo: RepoRef, snapshot: IndexSnapshot, stagedTree: string,
): Promise<boolean> {
  const saved = snapshots.get(snapshot)
  snapshots.delete(snapshot)
  if (saved === undefined || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(stagedTree)) return false
  if (Object.keys(saved.repo).some(key => saved.repo[key as keyof RepoRef] !== repo[key as keyof RepoRef])) return false
  const directories = new Map(saved.directories)
  const lockPath = snapshot.indexPath + '.lock'
  let lock: fs.FileHandle | undefined
  let owned: Stats | undefined
  let installed = false
  const ownsLock = async (): Promise<boolean> => {
    if (owned === undefined) return false
    await safePath(dirname(lockPath), directories)
    const current = await maybeStat(lockPath)
    return current !== null && current.isFile() && current.nlink === 1 && sameInode(owned, current)
  }
  try {
    const indexPath = await validatePaths(runner, repo, directories)
    // O_EXCL also refuses a dangling symlink; no lock-contention retry is safe.
    lock = await fs.open(lockPath, 'wx', 0o600)
    owned = await lock.stat()
    if (!(await ownsLock())) return false
    await validatePaths(runner, repo, directories)
    if (await headState(runner, repo, directories) !== saved.head) return false
    const currentFile = await readBounded(indexPath, MAX_INDEX_BYTES)
    const expected = entries(await runner.runBytesOk(['ls-tree', '-r', '-z', '--full-tree', stagedTree, '--'], repo.toplevel), true)
    const current = entries(await runner.runBytesOk(['ls-files', '--stage', '-z'], repo.toplevel), false)
    if (current.size !== expected.size || [...current].some(([path, value]) => expected.get(path) !== value)) return false
    if (saved.bytes !== null) {
      await lock.writeFile(saved.bytes)
      await lock.chmod(saved.mode)
      await lock.sync()
    }
    await validatePaths(runner, repo, directories)
    if (await headState(runner, repo, directories) !== saved.head || !(await ownsLock())) return false
    const final = await maybeStat(indexPath)
    if (currentFile === null ? final !== null : final === null || !sameFile(currentFile.stat, final)) return false
    if (saved.bytes === null) {
      // An unborn repository can genuinely have no index. Delete only the
      // verified installed index, with our lock still held; never touch files.
      if (final !== null) await fs.unlink(indexPath)
    } else {
      await fs.rename(lockPath, indexPath)
      installed = true
    }
    return true
  } catch { return false } finally {
    // Check identity before unlinking: a process ignoring the lock protocol
    // might have replaced our path. Never remove that process's lock.
    try { if (!installed && await ownsLock()) await fs.unlink(lockPath) } catch { /* Best effort; do not mask the hook error. */ }
    try { await lock?.close() } catch { /* The original operation error wins. */ }
  }
}
