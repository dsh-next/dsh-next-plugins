/**
 * Display-path helpers. Keep path spelling consistent: key by realpath-like
 * targetKey, show a cwd-relative displayPath.
 */

/** POSIX-normalize `.` / `..` without following symlinks. */
export function normalizePosix(path: string): string {
  const raw = path.replace(/\\/g, '/')
  const absolute = raw.startsWith('/')
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const joined = parts.join('/')
  if (absolute) return `/${joined}`
  return joined
}

function stripPrivatePrefix(path: string): string {
  return path.startsWith('/private/') ? path.slice('/private'.length) : path
}

/** POSIX-style relative path from an absolute cwd. */
export function relativeToCwd(cwd: string, absPath: string): string {
  const root = stripPrivatePrefix(normalizePosix(cwd).replace(/\/+$/, ''))
  const abs = stripPrivatePrefix(normalizePosix(absPath))
  if (abs === root) return '.'
  if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1)
  return normalizePosix(absPath)
}

/**
 * Path to show in the file list: cwd-relative when the path sits in the
 * workspace, otherwise the stored display path (never a raw targetKey).
 */
export function toDisplayPath(cwd: string, pathOrKey: string): string {
  if (pathOrKey === '' || pathOrKey === '.') return pathOrKey
  if (cwd === '') return pathOrKey.replace(/\\/g, '/')
  if (!pathOrKey.startsWith('/') && !pathOrKey.includes('\\')) return pathOrKey.replace(/\\/g, '/')
  return relativeToCwd(cwd, pathOrKey)
}

/** Join cwd and a git-relative name. */
export function absFromCwd(cwd: string, relative: string): string {
  if (relative === '.' || relative === '') return normalizePosix(cwd)
  const root = normalizePosix(cwd).replace(/\/+$/, '')
  const rel = relative.replace(/\\/g, '/')
  if (rel.startsWith('/')) return normalizePosix(rel)
  return normalizePosix(`${root}/${rel}`)
}

/**
 * Resolve `relOrAbs` under cwd. Null when the result would escape the
 * session tree (`../`, absolute paths outside cwd).
 */
export function confineToCwd(cwd: string, relOrAbs: string): string | null {
  const root = normalizePosix(cwd).replace(/\/+$/, '')
  if (root === '' || root === '/') return null
  const abs = absFromCwd(root, relOrAbs)
  if (abs === root) return abs
  if (abs.startsWith(`${root}/`)) return abs
  return null
}

export function headMoved(
  current: { sha: string } | null,
  checkpoint: { sha: string } | null,
): boolean {
  if (current === null || checkpoint === null) return false
  return current.sha !== checkpoint.sha
}
