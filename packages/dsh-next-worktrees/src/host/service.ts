/**
 * Worktrees orchestration service — the host half's brain.
 *
 * Owns the create / bind / status / list / remove flows over GitRunner and
 * RegistryStore. All DSH touchpoints are injected ports (session lookup,
 * the sandbox-knob writer), so the whole flow is testable without a live
 * harness. Invariants enforced here: git is the truth (status reconciles
 * against `git worktree list`), one owner session per worktree (bind
 * replaces), and the knob write happens only after the session cwd is
 * verified to sit inside the worktree.
 */
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DEFAULT_WORKTREE_DIR,
  registryPath,
  sessionCwdFor,
  worktreePath,
} from '../core/placement.ts'
import {
  deriveChipStatus,
  type ChipStatus,
} from '../core/status.ts'
import {
  branchName,
  generateSlug,
  sanitizeSlugSegment,
} from '../core/slug.ts'
import type { WorktreeBinding } from '../core/registry.ts'
import { reconcile } from '../core/registry.ts'
import { GitError, GitRunner } from './git.ts'
import { RegistryStore } from './registry-store.ts'

/** Host-side session port: resolve a session's recorded cwd. */
export type GetSessionCwd = (sessionId: string) => string | null

/** Host-side knob port: switch a session's sandbox mode. */
export type ApplySandboxMode = (sessionId: string, mode: 'danger-full-access') => boolean

/** Session lifecycle facts the chip renders (client-side dots come later). */
export interface SessionRunState {
  readonly running: boolean
}

/** Read-side port for sibling running/idle dots. */
export type GetSessionRunState = (sessionId: string) => SessionRunState | null

/** Creation outcome returned to the client. */
export interface CreateOutcome {
  readonly slug: string
  readonly path: string
  readonly sessionCwd: string
  readonly branch: string
  readonly baseRef: string
  readonly title: string
}

/** Status response for one session. */
export interface StatusOutcome {
  readonly bound: boolean
  readonly binding: WorktreeBinding | null
  readonly chipStatus: ChipStatus | null
  readonly ahead: number | null
  readonly dirty: boolean | null
  readonly siblings: readonly SiblingFact[]
}

/** One sibling row in the chip dropdown. */
export interface SiblingFact {
  readonly slug: string
  readonly title: string
  readonly branch: string
  readonly sessionId: string | null
  readonly running: boolean | null
}

/** Injected host ports plus the runner/store. */
export interface ServicePorts {
  readonly git: GitRunner
  readonly store: RegistryStore
  readonly getSessionCwd: GetSessionCwd
  readonly applySandboxMode: ApplySandboxMode
  readonly getSessionRunState?: GetSessionRunState
}

/** Structured failure crossing the RPC boundary. */
export class WorktreeFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'WorktreeFlowError'
  }
}

function fromGit(error: unknown): never {
  if (error instanceof GitError) {
    throw new WorktreeFlowError(error.code, error.message, error.hint)
  }
  throw error
}

/** The service. One instance per host process. */
export class WorktreesService {
  constructor(private readonly ports: ServicePorts) {}

  /** Preflight facts for the composer toggle. */
  async preflight(cwd: string): Promise<{
    ok: boolean
    degraded: boolean
    reasons: readonly string[]
    showIgnoreHint: boolean
  }> {
    const gitAvailable = await this.ports.git.available()
    if (!gitAvailable) {
      return { ok: false, degraded: true, reasons: ['git-unavailable'], showIgnoreHint: false }
    }
    try {
      const facts = await this.ports.git.facts(cwd)
      const baseRef = await this.ports.git.resolveBaseRef(cwd)
      const dirIgnored = await this.ports.git.dirIgnored(
        facts.placement.primaryRoot, DEFAULT_WORKTREE_DIR,
      )
      const ok = baseRef !== null
      return {
        ok,
        degraded: !ok,
        reasons: baseRef === null ? ['no-base-ref'] : [],
        showIgnoreHint: ok && !dirIgnored,
      }
    } catch (error) {
      if (error instanceof GitError) {
        return {
          ok: false,
          degraded: true,
          reasons: [error.code],
          showIgnoreHint: false,
        }
      }
      throw error
    }
  }

  /**
   * Create a worktree and register the binding. Retries with a fresh slug
   * on collisions so creation stays one-click; title is display-only.
   */
  async create(input: {
    cwd: string
    title?: string
    baseRef?: string
  }): Promise<CreateOutcome> {
    const facts = await this.ports.git.facts(input.cwd).catch(fromGit)
    const primary = facts.placement.primaryRoot
    const baseRef = input.baseRef !== undefined && input.baseRef !== ''
      ? input.baseRef
      : await this.ports.git.resolveBaseRef(primary)
    if (baseRef === null) {
      throw new WorktreeFlowError('no-base-ref', 'no base ref resolved for creation')
    }

    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      const slug = sanitizeSlugSegment(generateSlug())
      if (slug === '') continue
      const path = worktreePath(primary, slug)
      const branch = branchName(slug)
      try {
        await this.ports.git.createWorktree({ primaryRoot: primary, path, branch, baseRef })
      } catch (error) {
        const isCollision = error instanceof GitError
          && (error.code === 'branch-exists' || error.code === 'worktree-exists')
        if (!isCollision) throw error
        lastError = error
        continue
      }
      // A cwd that escaped the toplevel (symlinks) still lands the session
      // at the worktree root — isolation over path fidelity.
      const sessionCwd = sessionCwdFor(path, facts.toplevel, input.cwd) ?? path
      const title = input.title ?? ''
      await this.copyIncludeFiles(primary, path)
      const binding: WorktreeBinding = {
        slug,
        path,
        branch,
        baseRef,
        title,
        sessionId: null,
        role: 'owner',
        createdAt: new Date().toISOString(),
      }
      await this.ports.store.upsert(primary, registryPath(primary), binding)
      return { slug, path, sessionCwd, branch, baseRef, title }
    }
    throw lastError instanceof Error
      ? new WorktreeFlowError('slug-collision', lastError.message)
      : new WorktreeFlowError('slug-collision', 'could not generate a free slug')
  }

  /** Copy `.worktreeinclude` files (one path per line, files only). */
  private async copyIncludeFiles(primary: string, path: string): Promise<void> {
    const entries = await this.ports.git.worktreeInclude(primary)
    for (const entry of entries) {
      const from = `${primary}/${entry}`
      const to = `${path}/${entry}`
      try {
        const info = await stat(from)
        if (!info.isFile()) continue
        await mkdir(dirname(to), { recursive: true })
        await copyFile(from, to)
      } catch {
        // Missing include entries are skipped: isolation must not fail on
        // an optional convenience copy.
      }
    }
  }

  /**
   * Bind a session to its worktree and switch the sandbox knob. The session
   * cwd must sit inside the worktree (root or sub-path); anything else is a
   * binding mismatch, never a silent knob write.
   */
  async bind(sessionId: string): Promise<{ slug: string; path: string }> {
    const cwd = this.ports.getSessionCwd(sessionId)
    if (cwd === null) {
      throw new WorktreeFlowError('session-not-found', `session ${sessionId} has no cwd`)
    }
    const facts = await this.ports.git.facts(cwd).catch(fromGit)
    const primary = facts.placement.primaryRoot
    const bindings = await this.reconciled(primary)
    const binding = bindings.find(
      (b) => cwd === b.path || cwd.startsWith(`${b.path}/`),
    )
    if (binding === undefined) {
      throw new WorktreeFlowError('not-a-worktree-session', 'session cwd is not a plugin worktree')
    }
    const applied = this.ports.applySandboxMode(sessionId, 'danger-full-access')
    if (!applied) {
      throw new WorktreeFlowError('knob-write-failed', 'sandbox mode switch was rejected')
    }
    await this.ports.store.bindSession(primary, registryPath(primary), binding.slug, sessionId)
    return { slug: binding.slug, path: binding.path }
  }

  /** Chip facts for a session plus reconciled siblings of the same repo. */
  async status(sessionId: string): Promise<StatusOutcome> {
    const cwd = this.ports.getSessionCwd(sessionId)
    if (cwd === null) return { bound: false, binding: null, chipStatus: null, ahead: null, dirty: null, siblings: [] }
    let primary: string
    try {
      primary = (await this.ports.git.facts(cwd)).placement.primaryRoot
    } catch {
      return { bound: false, binding: null, chipStatus: null, ahead: null, dirty: null, siblings: [] }
    }
    const bindings = await this.reconciled(primary)
    const binding = bindings.find(
      (b) => b.sessionId === sessionId && (cwd === b.path || cwd.startsWith(`${b.path}/`)),
    ) ?? bindings.find((b) => b.sessionId === sessionId) ?? null
    if (binding === null) {
      return { bound: false, binding: null, chipStatus: null, ahead: null, dirty: null, siblings: [] }
    }
    const [ahead, dirty] = await Promise.all([
      this.ports.git.aheadCount(primary, binding.baseRef, binding.branch),
      this.ports.git.dirty(binding.path),
    ])
    // Siblings exclude the session's own worktree: the chip already names it,
    // and a self row would make the empty state unreachable.
    const siblings: SiblingFact[] = bindings
      .filter((b) => b.slug !== binding.slug)
      .map((b) => ({
        slug: b.slug,
        title: b.title,
        branch: b.branch,
        sessionId: b.sessionId,
        running: b.sessionId !== null && this.ports.getSessionRunState
          ? (this.ports.getSessionRunState(b.sessionId)?.running ?? null)
          : null,
      }))
    return {
      bound: true,
      binding,
      chipStatus: deriveChipStatus({ dirty: dirty === true, aheadOk: ahead !== null }),
      ahead,
      dirty,
      siblings,
    }
  }

  /** Remove a worktree and its binding; dirty refusal surfaces as structured error. */
  async remove(input: { cwd: string; slug: string; force: boolean }): Promise<void> {
    const facts = await this.ports.git.facts(input.cwd).catch(fromGit)
    const primary = facts.placement.primaryRoot
    const bindings = await this.reconciled(primary)
    const binding = bindings.find((b) => b.slug === input.slug)
    if (binding === undefined) {
      throw new WorktreeFlowError('unknown-slug', `no worktree bound to slug ${input.slug}`)
    }
    await this.ports.git.removeWorktree({
      primaryRoot: primary,
      path: binding.path,
      force: input.force,
    }).catch(fromGit)
    await this.ports.store.remove(primary, registryPath(primary), input.slug)
  }

  /** Bindings reconciled against `git worktree list`; stale rows are dropped. */
  private async reconciled(primary: string): Promise<readonly WorktreeBinding[]> {
    const path = registryPath(primary)
    const [bindings, worktrees] = await Promise.all([
      this.ports.store.load(primary, path),
      this.ports.git.listWorktrees(primary),
    ])
    const { kept, dropped } = reconcile(bindings, worktrees)
    if (dropped.length > 0) {
      await this.ports.store.replaceAll(primary, path, kept)
    }
    return kept
  }
}

// (No helper stubs: creation fallbacks live inline above.)
/** Fresh request ids (reserved for M2 shuttle preflight). */
export function newRequestId(): string {
  return randomUUID()
}
