/**
 * Bounded cwd walk used to follow session-touched files after a move/rename.
 * Not a git status: only callers that already know a content hash should
 * look here, so another session's new files are not absorbed.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const SKIP = new Set(['.git', 'node_modules', '.dsh', '.hg', '.svn'])

/** Cap so a huge tree cannot stall a snapshot. */
export const WALK_MAX_FILES = 4000

function shouldSkip(rel: string): boolean {
  return rel.split('/').some((seg) => SKIP.has(seg))
}

/** Absolute regular-file paths under cwd, skipping VCS/deps dirs. */
export async function listFilesUnder(cwd: string): Promise<string[]> {
  if (cwd === '' || cwd === '/') return []
  let ents
  try {
    ents = await readdir(cwd, { encoding: 'utf8', withFileTypes: true, recursive: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const ent of ents) {
    if (!ent.isFile()) continue
    const parent = typeof ent.parentPath === 'string' ? ent.parentPath : cwd
    const abs = join(parent, String(ent.name))
    const rel = abs.startsWith(`${cwd}/`) ? abs.slice(cwd.length + 1) : String(ent.name)
    if (shouldSkip(rel.replace(/\\/g, '/'))) continue
    out.push(abs)
    if (out.length >= WALK_MAX_FILES) break
  }
  return out
}
