import type { GitRunner } from './git-runner.ts'

interface CollisionScope {
  /** Every replayed commit, not merely the net diff between its endpoints. */
  readonly commits: readonly string[]
  /** Trees Git may reset/check out, including the original and current HEAD. */
  readonly trees: readonly string[]
}

// In addition to the runner's per-command timeout/buffer caps, bound aggregate work.
const MAX_PATH_BYTES = 32 * 1024 * 1024
const MAX_PATHS = 250_000
const MAX_REVISIONS = 2_010

/**
 * Find an ignored OR ordinary untracked path overlapping any possible checkout path.
 * Call inside the caller's runner mutation queue, before changing refs/index/journals.
 * A clean baseline plus every replay patch covers transient additions/deletions;
 * target trees and the live index also cover reset/abort and conflict resolutions.
 * Paths remain byte-preserving, NUL-delimited data, never shell/pathspec arguments.
 */
export async function findUntrackedCollision(runner: Pick<GitRunner, 'runOk' | 'runBytesOk'>, cwd: string, scope: CollisionScope): Promise<string | null> {
  const commits = [...new Set(scope.commits)]
  const trees = [...new Set(scope.trees)]
  if (commits.length + trees.length > MAX_REVISIONS) throw new Error('Ignored-file safety check exceeds the revision limit.')
  let bytes = 0
  let paths = 0
  const readPaths = async (args: readonly string[]): Promise<string[]> => {
    const result = await runner.runBytesOk(args, cwd)
    bytes += result.byteLength
    if (bytes > MAX_PATH_BYTES) throw new Error('Ignored-file safety check exceeds the path byte limit.')
    // Latin-1 is a reversible byte mapping, unlike UTF-8 decoding of Git filenames.
    const entries = Buffer.from(result).toString('latin1').split(String.fromCharCode(0)).filter(Boolean)
    paths += entries.length
    if (paths > MAX_PATHS) throw new Error('Ignored-file safety check exceeds the path count limit.')
    return entries
  }
  // No exclude flags: include ignored data AND untracked files created during a pause.
  // Do not collapse directories: an ignored sibling of a tracked file is safe.
  const untracked = await readPaths(['ls-files', '--others', '-z'])
  if (untracked.length === 0) return null
  const config = await runner.runOk(['config', '--type=bool', '--default=false', '--get', 'core.ignorecase'], cwd)
  const ignoreCase = config.trim() === 'true'
  // Git's C-locale case folding is ASCII; preserve every other filename byte.
  const normalize = (path: string): string => {
    const leaf = path.endsWith('/') ? path.slice(0, -1) : path
    return ignoreCase ? leaf.replace(/[A-Z]/g, char => char.toLowerCase()) : leaf
  }
  const candidates = new Set<string>()
  const add = (entries: readonly string[]): void => { for (const path of entries) candidates.add(normalize(path)) }
  add(await readPaths(['ls-files', '--cached', '-z']))
  for (const tree of trees) add(await readPaths(['ls-tree', '-r', '--name-only', '-z', tree, '--']))
  for (const oid of commits) {
    add(await readPaths(['diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', oid, '--']))
  }
  const sorted = [...candidates].sort()
  for (const original of untracked) {
    const path = normalize(original)
    if (candidates.has(path)) return display(original)
    // Candidate file/symlink is an ancestor of an untracked file/directory.
    for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
      if (candidates.has(path.slice(0, slash))) return display(original)
    }
    // Untracked file/symlink/directory is an ancestor of a candidate. Binary
    // search avoids the quadratic untracked x candidate path Cartesian product.
    const prefix = path + '/'
    let low = 0, high = sorted.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (sorted[middle]! < prefix) low = middle + 1
      else high = middle
    }
    if (sorted[low]?.startsWith(prefix)) return display(original)
  }
  return null
}

function display(path: string): string { return Buffer.from(path, 'latin1').toString('utf8') }
