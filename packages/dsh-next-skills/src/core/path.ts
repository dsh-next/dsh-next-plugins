/**
 * Pure, browser-safe path join. Joins parts with POSIX separators and collapses
 * duplicate slashes. Node's filesystem APIs accept forward slashes on every
 * platform, so this single implementation serves both the host (via node:fs)
 * and any pure core logic that composes skill-root paths.
 */
export function joinPath(...parts: string[]): string {
  let result = parts.join('/').replace(/\/{2,}/g, '/')
  if (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1)
  return result
}

/** POSIX dirname for a path already joined with `/`. */
export function dirnamePath(p: string): string {
  const idx = p.lastIndexOf('/')
  if (idx === -1) return '.'
  if (idx === 0) return '/'
  return p.slice(0, idx)
}

/** The last non-empty segment of a path: `basenamePath('/a/b/web')` is `web`. */
export function basenamePath(p: string): string {
  const segments = p.split('/')
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] !== '') return segments[i]
  }
  return p
}

/**
 * Whether a path is a safe relative sub-path (no leading slash, no empty/`.`/`..`
 * segments). Used to reject path traversal in registry-provided file paths.
 */
export function isSafeRelativePath(p: string): boolean {
  if (p === '' || p.startsWith('/')) return false
  const segments = p.split('/')
  return segments.length > 0 && !segments.some((s) => s === '' || s === '.' || s === '..')
}
