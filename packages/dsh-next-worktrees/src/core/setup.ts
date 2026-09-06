/**
 * `.worktrees.json` — optional create-time setup commands (Cursor's
 * worktrees.json idea, our filename). Pure parse/resolve; the host reads
 * the file and shells out.
 */

export const SETUP_ENV_ROOT = 'ROOT_WORKTREE_PATH'

const MAX_STEPS = 32

/** One shell step after `git worktree add`. */
export type SetupStep =
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'script'; readonly path: string }

export interface WorktreesSetupFile {
  readonly 'setup-worktree'?: unknown
  readonly 'setup-worktree-unix'?: unknown
  readonly 'setup-worktree-windows'?: unknown
}

export type SetupPlatform = 'unix' | 'windows'

/** Config paths: local override first, then the committed project file. */
export function worktreesJsonCandidates(primary: string): readonly string[] {
  const posix = primary.replace(/\\/g, '/')
  return [
    `${posix}/.dsh/worktrees.json`,
    `${posix}/.worktrees.json`,
  ]
}

export function setupPlatform(nodePlatform: string): SetupPlatform {
  return nodePlatform === 'win32' ? 'windows' : 'unix'
}

/**
 * Parse a JSON document. Returns an error string when the file is present
 * but not an object (so the host can fail create instead of skipping).
 */
export function parseWorktreesJson(raw: string): WorktreesSetupFile | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return { error: '.worktrees.json is not valid JSON' }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { error: '.worktrees.json must be a JSON object' }
  }
  return value as WorktreesSetupFile
}

/**
 * Pick OS-specific commands, falling back to `setup-worktree`.
 * Empty / missing → no steps.
 */
export function resolveSetupSteps(
  file: WorktreesSetupFile,
  platform: SetupPlatform,
): SetupStep[] | { error: string } {
  const specific = platform === 'windows'
    ? file['setup-worktree-windows']
    : file['setup-worktree-unix']
  const raw = specific !== undefined ? specific : file['setup-worktree']
  if (raw === undefined) return []
  return stepsFromValue(raw)
}

function stepsFromValue(raw: unknown): SetupStep[] | { error: string } {
  if (typeof raw === 'string') {
    const path = raw.trim()
    if (path === '') return []
    if (isUnsafeSetupPath(path)) {
      return { error: 'setup script path must be relative and stay inside the project' }
    }
    return [{ kind: 'script', path }]
  }
  if (!Array.isArray(raw)) {
    return { error: 'setup-worktree must be an array of commands or a script path' }
  }
  if (raw.length > MAX_STEPS) {
    return { error: `setup-worktree is limited to ${MAX_STEPS} commands` }
  }
  const steps: SetupStep[] = []
  for (const item of raw) {
    if (typeof item !== 'string') {
      return { error: 'setup-worktree commands must be strings' }
    }
    const command = item.trim()
    if (command === '') continue
    steps.push({ kind: 'command', command })
  }
  return steps
}

/** Absolute paths and `..` would run outside the project. */
export function isUnsafeSetupPath(entry: string): boolean {
  const posix = entry.replace(/\\/g, '/')
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) return true
  return posix.split('/').includes('..')
}
