/**
 * The worktree model: where worktrees live, what they are called, and the two
 * project-local contracts that ride along with create.
 *
 * Placement is fixed by the plugin, not discovered:
 *
 * - directory: `<repository root>/.worktrees/<slug>` — inside the working
 *   tree, the convention the agent-tool ecosystem uses, and the only shape
 *   that nests a worktree under its repository in the stock workspace browser
 *   (which nests by registered-path containment alone).
 * - branch: `dsh-git/<slug>`.
 * - the directory is ignored through `.git/info/exclude`, never the user's
 *   committed `.gitignore`.
 *
 * Pure: path arithmetic, slug validation, porcelain parsing and the two
 * project files' grammars, with no filesystem access.
 */

import type { SetupStep, WorktreeBase, WorktreeInfo, WorktreePlan } from './types.ts'

/** Directory, relative to the repository root, that holds managed worktrees. */
export const WORKTREES_DIR = '.worktrees'

/** The `.git/info/exclude` entry that keeps `git status` clean. */
export const WORKTREES_EXCLUDE_ENTRY = '.worktrees/'

/** Branch prefix every managed worktree checks out. */
export const WORKTREE_BRANCH_PREFIX = 'dsh-git/'

/** Project file, at the repository root, declaring create-time setup commands. */
export const SETUP_FILE = '.worktrees.json'

/** Project file, at a directory, listing untracked paths a fresh worktree needs. */
export const INCLUDE_FILE = '.worktreeinclude'

/** Environment variable handed to setup steps: the primary checkout's path. */
export const SETUP_ENV_ROOT = 'ROOT_WORKTREE_PATH'

/** `.worktrees.json` allows at most this many commands. */
export const SETUP_MAX_STEPS = 32

/** Slug length ceiling; `.worktrees/<slug>` has to stay readable in a sidebar. */
export const SLUG_MAX_LENGTH = 48

/** Why a requested slug was refused. */
export type SlugIssue = 'empty' | 'too-long' | 'invalid-character' | 'reserved' | 'separator'

/** A slug decision: either the value to use, or the reason it was refused. */
export type SlugVerdict = { readonly ok: true; readonly slug: string } | { readonly ok: false; readonly issue: SlugIssue }

/**
 * Validate a user-typed worktree name.
 *
 * Accepts lowercase letters, digits, `.` and `-`, starting and ending with a
 * letter or digit, at most {@link SLUG_MAX_LENGTH} characters. Uppercase and
 * underscores are normalized rather than rejected (see {@link normalizeSlug});
 * anything else is refused with a named issue.
 *
 * @param input - the raw name.
 * @returns the slug to use, or the issue to show.
 */
export function validateSlug(input: string): SlugVerdict {
  const slug = input.trim()
  if (slug === '') return { ok: false, issue: 'empty' }
  if (slug.includes('/') || slug.includes('\\')) return { ok: false, issue: 'separator' }
  if (slug === '.' || slug === '..') return { ok: false, issue: 'reserved' }
  if (slug.length > SLUG_MAX_LENGTH) return { ok: false, issue: 'too-long' }
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(slug)) return { ok: false, issue: 'invalid-character' }
  if (!/[a-z0-9]$/.test(slug)) return { ok: false, issue: 'invalid-character' }
  return { ok: true, slug }
}

/**
 * Fold a human-typed name into slug shape.
 *
 * - lowercases;
 * - replaces whitespace and underscores with `-`;
 * - drops everything outside `[a-z0-9.-]`;
 * - collapses runs of separators and trims leading/trailing ones;
 * - truncates at a separator boundary at {@link SLUG_MAX_LENGTH}.
 *
 * @param input - the raw name.
 * @returns the best-effort slug; empty when nothing usable survived.
 */
export function normalizeSlug(input: string): string {
  const folded = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/[.-]{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '')
  if (folded.length <= SLUG_MAX_LENGTH) return folded
  const clipped = folded.slice(0, SLUG_MAX_LENGTH).replace(/[.-]+$/, '')
  return clipped
}

/** `dsh-git/<slug>`. */
export function branchForSlug(slug: string): string {
  return `${WORKTREE_BRANCH_PREFIX}${slug}`
}

/** `<root>/.worktrees/<slug>`, with `/` separators on every platform. */
export function worktreePathFor(root: string, slug: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${base}/${WORKTREES_DIR}/${slug}`
}

/** Whether a path sits at or under the managed `.worktrees/` directory. */
export function isManagedWorktreePath(path: string): boolean {
  return path.replace(/\\/g, '/').includes(`/${WORKTREES_DIR}/`)
}

/** The slug encoded in a managed worktree path, or null when it is not one. */
export function slugFromWorktreePath(path: string): string | null {
  const posix = path.replace(/\\/g, '/')
  const marker = `/${WORKTREES_DIR}/`
  const at = posix.lastIndexOf(marker)
  if (at < 0) return null
  const slug = posix.slice(at + marker.length).split('/')[0]
  return slug === undefined || slug === '' ? null : slug
}

/**
 * The `.worktrees/<slug>` slug a ref would get when checked out into a worktree.
 *
 * `main` stays `main`; `origin/feature/x` and `refs/heads/feature/x` both
 * become `feature/x`'s last segment, because a slug may not contain a slash.
 */
export function slugForRef(ref: string): string {
  const trimmed = ref.trim().replace(/^refs\/(heads|remotes|tags)\//, '')
  const leaf = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed
  return normalizeSlug(leaf)
}

/**
 * The local branch a remote-tracking ref would create.
 *
 * `origin/feature/x` -> `feature/x`; a ref without a remote prefix passes
 * through. The result is a branch name, not a slug: slashes are legal there.
 */
export function localBranchForRemoteRef(ref: string): string {
  const trimmed = ref.trim().replace(/^refs\/remotes\//, '')
  const slash = trimmed.indexOf('/')
  return slash < 0 ? trimmed : trimmed.slice(slash + 1)
}

/** The slug of a `dsh-git/<slug>` branch, or null for any other branch. */
export function slugFromBranch(branch: string | null): string | null {
  if (branch === null) return null
  const short = branch.startsWith('refs/heads/') ? branch.slice('refs/heads/'.length) : branch
  if (!short.startsWith(WORKTREE_BRANCH_PREFIX)) return null
  const slug = short.slice(WORKTREE_BRANCH_PREFIX.length)
  return slug === '' ? null : slug
}

/**
 * One parsed `git worktree list --porcelain` entry, before enrichment.
 */
export interface ParsedWorktree {
  readonly path: string
  readonly head: string | null
  readonly branch: string | null
  readonly bare: boolean
  readonly detached: boolean
  readonly locked: boolean
  /** The reason git recorded with `locked`, when it recorded one. */
  readonly lockedReason: string | null
  /** Git marked the entry prunable: its directory or git dir is gone. */
  readonly prunable: boolean
}

/**
 * Parse `git worktree list --porcelain` (newline-framed, blank-line records).
 *
 * @param raw - process stdout.
 * @returns entries in git's order (the primary worktree first).
 */
export function parseWorktreeList(raw: string): ParsedWorktree[] {
  const entries: ParsedWorktree[] = []
  let current: {
    path: string
    head: string | null
    branch: string | null
    bare: boolean
    detached: boolean
    locked: boolean
    lockedReason: string | null
    prunable: boolean
  } | null = null

  const flush = (): void => {
    if (current !== null && current.path !== '') entries.push(current)
    current = null
  }

  for (const line of raw.split('\n')) {
    if (line === '') {
      flush()
      continue
    }
    const space = line.indexOf(' ')
    const key = space < 0 ? line : line.slice(0, space)
    const value = space < 0 ? '' : line.slice(space + 1)
    if (key === 'worktree') {
      flush()
      current = {
        path: value,
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        lockedReason: null,
        prunable: false,
      }
      continue
    }
    if (current === null) continue
    switch (key) {
      case 'HEAD':
        current.head = value === '' ? null : value
        break
      case 'branch':
        current.branch = value === '' ? null : value
        break
      case 'bare':
        current.bare = true
        break
      case 'detached':
        current.detached = true
        break
      case 'locked':
        current.locked = true
        current.lockedReason = value === '' ? null : value
        break
      case 'prunable':
        current.prunable = true
        break
      default:
        break
    }
  }
  flush()
  return entries
}

/** Extra facts the host derives for each worktree, so this stays pure. */
export interface WorktreeEnrichment {
  /** Whether the working tree has changes (`git status --porcelain` non-empty). */
  readonly clean: boolean
  /** Commits this branch has that the comparison base does not. */
  readonly ahead: number
  /** Commits the comparison base has that this branch does not. */
  readonly behind: number
  /** Whether the branch tip is already an ancestor of the comparison base. */
  readonly merged: boolean
}

/**
 * Turn parsed worktree list entries into the panel's rows.
 *
 * @param entries - {@link parseWorktreeList} output.
 * @param enrichment - per-path facts the host measured; a missing entry means clean/merged/0.
 * @returns rows with the managed-path convention applied.
 */
export function describeWorktrees(
  entries: readonly ParsedWorktree[],
  enrichment: Readonly<Record<string, WorktreeEnrichment>> = {},
): WorktreeInfo[] {
  return entries.map((entry, index) => {
    const facts = enrichment[entry.path]
    const slug = isManagedWorktreePath(entry.path)
      ? slugFromWorktreePath(entry.path)
      : slugFromBranch(entry.branch)
    return {
      path: entry.path,
      head: entry.head,
      branch: shortBranch(entry.branch),
      primary: index === 0,
      locked: entry.locked,
      lockedReason: entry.lockedReason,
      prunable: entry.prunable,
      detached: entry.detached,
      managed: slug !== null,
      slug,
      clean: facts?.clean ?? entry.bare,
      ahead: facts?.ahead ?? 0,
      behind: facts?.behind ?? 0,
      merged: facts?.merged ?? false,
    }
  })
}

/** `refs/heads/main` -> `main`; already-short names pass through. */
export function shortBranch(branch: string | null): string | null {
  if (branch === null) return null
  const prefix = 'refs/heads/'
  return branch.startsWith(prefix) ? branch.slice(prefix.length) : branch
}

/**
 * Pick the branch the Worktrees status columns compare against.
 *
 * Precedence is deliberate: a branch the user picked in the panel wins, then
 * the repository's default branch (`origin/HEAD`, which is what a pull request
 * compares against), and only then the primary checkout's current branch as the
 * last resort. Comparing against "whatever the main checkout happens to have
 * checked out" was the old behaviour, and it made the same worktree read
 * "2 ahead" or "Merged" depending on where the root happened to be.
 *
 * @param input - the resolved candidates.
 * @returns the base and where it came from.
 */
export function resolveWorktreeBase(input: {
  /** `origin/HEAD` short name when the repository has one. */
  readonly defaultBranch: string | null
  /** The primary checkout's current branch, the final fallback. */
  readonly primaryBranch: string | null
  /** A branch the user picked in the panel, when any. */
  readonly requested?: string | null
  /** Local branch names offered as alternatives. */
  readonly candidates?: readonly string[]
}): WorktreeBase {
  const candidates = input.candidates ?? []
  const requested = input.requested ?? null
  if (requested !== null && requested !== '') {
    return { name: requested, source: 'panel', candidates }
  }
  if (input.defaultBranch !== null && input.defaultBranch !== '') {
    return { name: input.defaultBranch, source: 'default-branch', candidates }
  }
  if (input.primaryBranch !== null && input.primaryBranch !== '') {
    return { name: input.primaryBranch, source: 'primary', candidates }
  }
  return { name: null, source: 'none', candidates }
}

/* ------------------------------------------------------------------ setup */

/** The parsed `.worktrees.json` document, unvalidated. */
export interface SetupFile {
  readonly 'setup-worktree'?: unknown
  readonly 'setup-worktree-unix'?: unknown
  readonly 'setup-worktree-windows'?: unknown
}

/** Which OS family's command list applies. */
export type SetupPlatform = 'unix' | 'windows'

/** Map `process.platform` to the setup platform. */
export function setupPlatform(nodePlatform: string): SetupPlatform {
  return nodePlatform === 'win32' ? 'windows' : 'unix'
}

/**
 * Parse `.worktrees.json`.
 *
 * @param raw - file contents.
 * @returns the document, or an error key the panel shows.
 */
export function parseSetupFile(raw: string): SetupFile | { error: 'setup-not-object' } {
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return { error: 'setup-not-object' }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'setup-not-object' }
  }
  return value as SetupFile
}

/**
 * Resolve the steps for one platform.
 *
 * A string value names a project-relative script; an array holds commands.
 * The OS-specific key wins over the shared one. An empty or missing value
 * means "no steps", not an error.
 *
 * @param file - parsed document.
 * @param platform - platform selected by {@link setupPlatform}.
 * @returns the steps, or the error key to show.
 */
export function resolveSetupSteps(
  file: SetupFile,
  platform: SetupPlatform,
): SetupStep[] | { error: 'setup-invalid' | 'setup-too-many' | 'setup-unsafe-path' } {
  const specific = platform === 'windows' ? file['setup-worktree-windows'] : file['setup-worktree-unix']
  const raw = specific !== undefined ? specific : file['setup-worktree']
  if (raw === undefined) return []
  if (typeof raw === 'string') {
    const path = raw.trim()
    if (path === '') return []
    if (isUnsafeRelativePath(path)) return { error: 'setup-unsafe-path' }
    return [{ kind: 'script', path }]
  }
  if (!Array.isArray(raw)) return { error: 'setup-invalid' }
  if (raw.length > SETUP_MAX_STEPS) return { error: 'setup-too-many' }
  const steps: SetupStep[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return { error: 'setup-invalid' }
    const command = item.trim()
    if (command === '') continue
    steps.push({ kind: 'command', command })
  }
  return steps
}

/**
 * Whether a project-relative path escapes the project.
 *
 * Absolute paths, drive letters, UNC prefixes and `..` segments would let a
 * project file read or write outside the checkout, so they are refused.
 *
 * @param entry - the path as written in the project file.
 * @returns whether it is unsafe.
 */
export function isUnsafeRelativePath(entry: string): boolean {
  const posix = entry.replace(/\\/g, '/')
  if (posix.startsWith('/') || posix.startsWith('//')) return true
  if (/^[a-zA-Z]:/.test(posix)) return true
  return posix.split('/').includes('..')
}

/**
 * Environment for a `.worktrees.json` step.
 *
 * The DSH host may inherit `npm_*` / `PNPM_*` / `INIT_CWD` from however it was
 * launched; a nested worktree inside the checkout would make pnpm walk up into
 * that workspace. Dropping the inheritance and pinning cwd-related variables
 * to the worktree keeps installs local.
 *
 * @param parent - `process.env`.
 * @param extra - plugin-owned variables (`ROOT_WORKTREE_PATH`).
 * @param cwd - the fresh worktree.
 * @returns the environment for the step.
 */
export function setupChildEnv(
  parent: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>>,
  cwd: string,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (lower.startsWith('npm_') || lower.startsWith('pnpm_')) continue
    if (key === 'NODE_PATH' || key === 'INIT_CWD' || key === 'PWD') continue
    env[key] = value
  }
  Object.assign(env, extra)
  env.INIT_CWD = cwd
  env.PWD = cwd
  env.NPM_CONFIG_WORKSPACE_DIR = cwd
  env.npm_config_workspace_dir = cwd
  env.npm_config_confirm_modules_purge = 'false'
  env.NPM_CONFIG_CONFIRM_MODULES_PURGE = 'false'
  if (env.CI === undefined) env.CI = 'true'
  return env
}

/* ---------------------------------------------------------------- include */

/**
 * Parse `.worktreeinclude`: one literal relative path per line, `#` comments.
 *
 * The grammar is deliberately not a glob: an entry names something that
 * exists in the primary checkout, and the host copies it verbatim. Unsafe
 * entries (absolute, drive-lettered, `..`) are dropped rather than refused,
 * so one bad line cannot break create.
 *
 * @param raw - file contents.
 * @returns the safe relative paths, in file order.
 */
export function parseWorktreeInclude(raw: string): string[] {
  const entries: string[] = []
  for (const line of raw.split('\n')) {
    const entry = line.trim()
    if (entry === '' || entry.startsWith('#')) continue
    if (isUnsafeRelativePath(entry)) continue
    if (!entries.includes(entry)) entries.push(entry)
  }
  return entries
}

/* ------------------------------------------------------------------- plan */

/**
 * Build the create plan for a slug.
 *
 * @param input - repository root, slug, resolved base ref and setup steps.
 * @returns the plan the host executes and the panel shows before it runs.
 */
export function planWorktree(input: {
  root: string
  slug: string
  base: string
  /** Branch to check out; defaults to `dsh-git/<slug>`. `null` means detached. */
  branch?: string | null
  setup?: readonly SetupStep[]
}): WorktreePlan {
  return {
    slug: input.slug,
    path: worktreePathFor(input.root, input.slug),
    branch: input.branch === undefined ? branchForSlug(input.slug) : input.branch,
    base: input.base,
    setup: input.setup ?? [],
  }
}

/**
 * Whether the exclude file already covers the worktrees directory.
 *
 * @param raw - current `.git/info/exclude` contents.
 * @returns whether an entry matching {@link WORKTREES_EXCLUDE_ENTRY} is present.
 */
export function excludesWorktrees(raw: string): boolean {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === WORKTREES_EXCLUDE_ENTRY || line === WORKTREES_DIR || line === `${WORKTREES_DIR}/*`)
}

/**
 * Append the exclude entry when it is missing.
 *
 * @param raw - current `.git/info/exclude` contents.
 * @returns the contents to write, or null when nothing needs writing.
 */
export function withWorktreesExcluded(raw: string): string | null {
  if (excludesWorktrees(raw)) return null
  const base = raw === '' || raw.endsWith('\n') ? raw : `${raw}\n`
  return `${base}${WORKTREES_EXCLUDE_ENTRY}\n`
}
