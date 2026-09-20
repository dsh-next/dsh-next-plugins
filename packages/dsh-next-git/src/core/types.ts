/**
 * Shared vocabulary for the git plugin.
 *
 * This module is the contract between the host half (which runs git and
 * shapes the RPC envelopes) and the browser half (which renders them). It
 * must stay free of host and browser identity: plain data, no `node:`
 * imports, no DOM (see docs/package-structure.md).
 *
 * Two axes are deliberately separate:
 *
 * - `ChangeKind` / `StatusEntry` describe *what changed* in the working tree.
 * - `GitFailureCode` / `DegradedState` describe *why git could not answer*,
 *   which the panel renders as a named state with a fix instead of a raw error.
 */

/** The seven porcelain-v2 change letters, plus the two untracked buckets. */
export type ChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'ignored'
  | 'unmerged'

/** Porcelain-v2 unmerged codes (`u` records), with git's own meanings. */
export type UnmergedCode =
  | 'both-modified'
  | 'both-added'
  | 'both-deleted'
  | 'added-by-us'
  | 'added-by-them'
  | 'deleted-by-us'
  | 'deleted-by-them'

/** One path's state: `index` is the staged side, `worktree` the unstaged side. */
export interface StatusEntry {
  /** Repository-relative path with `/` separators (the new path for a rename). */
  readonly path: string
  /** The rename/copy source, present exactly on renamed/copied entries. */
  readonly oldPath?: string
  /** Staged change, or undefined when the index matches HEAD at this path. */
  readonly index?: ChangeKind
  /** Unstaged change, or undefined when the worktree matches the index. */
  readonly worktree?: ChangeKind
  /** Unmerged classification, present exactly on conflict records. */
  readonly unmerged?: UnmergedCode
  /** The raw two-letter `XY` code, kept for diagnostics. */
  readonly xy: string
  /** Whether this entry is untracked (`?`) rather than a change to a tracked path. */
  readonly untracked: boolean
  /** Whether this path is ignored (`!`); ignored entries are informational only. */
  readonly ignored: boolean
}

/** Branch position of the repository's HEAD. */
export interface HeadState {
  /** Commit id at HEAD, or null in an unborn repository. */
  readonly oid: string | null
  /** Branch name, or null when HEAD is detached (or unborn). */
  readonly branch: string | null
  /** Configured upstream (`origin/main`), or null when none is set. */
  readonly upstream: string | null
  /** Commits ahead of upstream; 0 when unknown. */
  readonly ahead: number
  /** Commits behind upstream; 0 when unknown. */
  readonly behind: number
  /** Whether HEAD is detached. */
  readonly detached: boolean
  /** Whether the branch has no commits yet. */
  readonly unborn: boolean
}

/** Everything a merge/rebase/cherry-pick/revert leaves behind. */
export type OperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'am'

/** An in-progress history operation the user can Continue or Abort. */
export interface OperationState {
  /** The operation in progress, or null when the tree is at rest. */
  readonly kind: OperationKind | null
  /** A short step label for a rebase (`2/5`), when git records one. */
  readonly step: string | null
  /** The conflict message git wrote (`MERGE_MSG`), when present. */
  readonly message: string | null
  /** Unmerged paths at the moment the state was read. */
  readonly conflicts: readonly string[]
}

/** Working-tree change summary, grouped the way the panel renders it. */
export interface ChangeSummary {
  /** Staged entries, in git's listing order. */
  readonly staged: readonly StatusEntry[]
  /** Unstaged entries (tracked paths only). */
  readonly unstaged: readonly StatusEntry[]
  /** Untracked paths. */
  readonly untracked: readonly StatusEntry[]
  /** Ignored paths; only listed when the caller asked for them. */
  readonly ignored: readonly StatusEntry[]
  /** Unmerged paths (also present in `staged`/`unstaged` with an `unmerged` code). */
  readonly conflicts: readonly StatusEntry[]
  /** Number of ignored paths when the list itself was dropped for size. */
  readonly ignoredCount: number
  /** Whether the ignored list was omitted to keep the envelope bounded. */
  readonly ignoredTruncated: boolean
}

/** One linked worktree as `git worktree list --porcelain` reports it. */
export interface WorktreeInfo {
  /** Absolute path of the worktree root. */
  readonly path: string
  /** Checked-out commit id, or null for a bare/prunable entry. */
  readonly head: string | null
  /** Checked-out branch (`refs/heads/x` shortened), or null when detached. */
  readonly branch: string | null
  /** Whether this is the main worktree (the repository root itself). */
  readonly primary: boolean
  /** Whether the entry is locked: git refuses to move, delete or prune it. */
  readonly locked: boolean
  /** The reason git recorded for the lock, when it recorded one. */
  readonly lockedReason: string | null
  /** Whether git marked the entry prunable: its directory or git dir is gone. */
  readonly prunable: boolean
  /** Whether the checkout is detached (no branch). */
  readonly detached: boolean
  /** Whether the plugin created it: sits under `.worktrees/` on a `dsh-git/` branch. */
  readonly managed: boolean
  /** The `.worktrees/<slug>` slug when managed. */
  readonly slug: string | null
  /** Working-tree cleanliness: false only when git reports changes. */
  readonly clean: boolean
  /** Commits this branch has that the comparison base does not. */
  readonly ahead: number
  /** Commits the comparison base has that this branch does not. */
  readonly behind: number
  /** Whether its branch tip is already an ancestor of the comparison base. */
  readonly merged: boolean
}

/**
 * How the Worktrees section picked the branch its status columns compare
 * against. The panel shows this, because "2 ahead" means nothing without a
 * "of what".
 */
export type WorktreeBaseSource = 'default-branch' | 'primary' | 'panel' | 'none'

/** The branch the Worktrees status columns are measured against. */
export interface WorktreeBase {
  /** Ref name (`origin/main`, `main`), or null when the repository has none. */
  readonly name: string | null
  /** Where the name came from. */
  readonly source: WorktreeBaseSource
  /** Local branches the panel may switch the base to, in read order. */
  readonly candidates: readonly string[]
}

/** One local branch for the branch picker. */
export interface BranchInfo {
  /** Short branch name. */
  readonly name: string
  /** Whether this is the currently checked-out branch. */
  readonly current: boolean
  /** Commit id at the branch tip. */
  readonly oid: string
  /** Upstream short name, or null. */
  readonly upstream: string | null
  /** Whether the branch exists on a remote only (checkout candidate). */
  readonly remote: boolean
}

/** Commit identity configuration, surfaced so commit can name its missing half. */
export interface IdentityState {
  readonly name: string | null
  readonly email: string | null
}

/** The per-repository read model one panel refresh produces. */
export interface PanelState {
  /** Absolute active checkout root; not necessarily the primary worktree. */
  readonly root: string
  /** Absolute git directory (`rev-parse --absolute-git-dir`). */
  readonly gitDir: string
  /** Whether the repository is bare. */
  readonly bare: boolean
  /** HEAD position. */
  readonly head: HeadState
  /** In-progress operation, or at-rest. */
  readonly operation: OperationState
  /** Grouped working tree changes. */
  readonly changes: ChangeSummary
  /** Linked worktrees, primary first. */
  readonly worktrees: readonly WorktreeInfo[]
  /** Branch the worktrees' ahead/behind/merged columns compare against. */
  readonly worktreeBase: WorktreeBase
  /** Local branches. */
  readonly branches: readonly BranchInfo[]
  /** Tag names, for the worktree create picker. */
  readonly tags: readonly string[]
  /** Commit identity from git config. */
  readonly identity: IdentityState
  /** Absolute path of the directory the session runs in. */
  readonly cwd: string
}

/** One commit row in the history section. */
export interface CommitSummary {
  readonly hash: string
  /** Abbreviated hash (`%h`). */
  readonly short: string
  /** Parent hashes, in order; empty for the root commit. */
  readonly parents: readonly string[]
  readonly author: string
  /** Unix epoch seconds. */
  readonly timestamp: number
  readonly subject: string
  /** Ref decorations (`HEAD -> main, origin/main`), already split. */
  readonly refs: readonly string[]
}

/** One commit's place in the rendered graph column. */
export interface GraphLane {
  /** 0-based column the commit dot sits in. */
  readonly lane: number
  /** Columns the connector lines occupy, each with the lane it travels to. */
  readonly edges: readonly GraphEdge[]
}

/** One vertical connector between a commit row and the row below it. */
export interface GraphEdge {
  readonly from: number
  readonly to: number
}

/** History page: commits plus their computed lanes. */
export interface HistoryPage {
  /** Immutable revision used by this window, for stable cursor reads. */
  readonly anchor?: string
  readonly commits: readonly CommitSummary[]
  readonly lanes: readonly GraphLane[]
  /** Whether the requested window was fully served (false when a limit clipped it). */
  readonly hasMore: boolean
}

/** A file's diff, ready for `DiffBlock` or the size-cap fallback. */
export interface DiffFile {
  /** Repository-relative path. */
  readonly path: string
  /** Display path for a rename (`old -> new`). */
  readonly displayPath: string
  /** Per-hunk fragments for `DiffBlock`; each is a small exact comparison. */
  readonly hunks: readonly DiffHunkText[]
  /** Added line count from `git diff --numstat`. */
  readonly added: number
  /** Removed line count from `git diff --numstat`. */
  readonly removed: number
  /** Whether git reports the file as binary. */
  readonly binary: boolean
  /** Whether the file crossed the size cap and only `patch` is usable. */
  readonly tooLarge: boolean
  /** No file bytes were read past the host safety budget; line counts are unknown. */
  readonly byteLimited?: boolean
  /** The raw unified patch, always present so the panel can copy it. */
  readonly patch: string
}

/** One hunk fragment: the exact old/new text `DiffBlock` compares. */
export interface DiffHunkText {
  /** Hunk header without the leading `@@` (`-12,7 +12,9 @@ fn()`). */
  readonly header: string
  readonly oldText: string
  readonly newText: string
}

/** Which side of the index a diff is taken against. */
export type DiffSide = 'staged' | 'unstaged'

/** Diff result for one path; `binary` and `tooLarge` are terminal states. */
export interface DiffResult {
  readonly path: string
  readonly side: DiffSide
  readonly file: DiffFile | null
  /** Set when the path vanished or was never changed on that side. */
  readonly empty: boolean
}

/** Named failure states. Every one has a dictionary key and an actionable fix. */
export type GitFailureCode =
  | 'git-unavailable'
  | 'git-too-old'
  | 'not-a-repository'
  | 'bare-repository'
  | 'permission-denied'
  | 'identity-missing'
  | 'index-locked'
  | 'operation-in-progress'
  | 'dirty-tree'
  | 'not-merged'
  | 'detached-head'
  | 'current-branch'
  | 'worktree-primary'
  | 'worktree-current'
  | 'branch-exists'
  | 'worktree-exists'
  | 'invalid-name'
  | 'setup-stale'
  | 'no-upstream'
  | 'nothing-to-commit'
  | 'path-missing'
  | 'hook-failed'
  | 'hook-cancelled'
  | 'cancelled'
  | 'timeout'
  | 'git-failed'

/** A classified failure: the code drives a named panel state, `detail` the log line. */
export interface GitFailure {
  readonly code: GitFailureCode
  /** Raw git stderr/stdout tail, bounded. */
  readonly detail: string
  /** Exit code when a git process produced it. */
  readonly exitCode?: number
}

/** Degraded read state: git cannot serve the panel at all, with the fix. */
export interface DegradedState {
  readonly code: Extract<
    GitFailureCode,
    'git-unavailable' | 'git-too-old' | 'not-a-repository' | 'bare-repository' | 'permission-denied'
  >
  /** Raw detail, bounded and safe to show. */
  readonly detail: string
  /** Required git version for `git-too-old`, else null. */
  readonly requiredVersion: string | null
  /** Installed version for `git-too-old`, else null. */
  readonly installedVersion: string | null
}

/** Result envelope every RPC method returns. */
export type RpcOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: GitFailure }

/** Payload of `getState`: the whole panel in one round trip. */
export interface StatePayload {
  readonly state: PanelState
  /** A preflight-independent notice, e.g. an in-flight hook from an earlier commit. */
  readonly notice: HookNotice | null
}

/** Output of a commit hook that failed, for the panel's hook-output section. */
export interface HookNotice {
  readonly hook: string
  readonly output: string
  readonly exitCode: number
  /** The message the failed commit was attempted with, so Retry can repeat it. */
  readonly message: string
}

/** Actions the preflight model knows about. */
export type PreflightAction =
  | 'discard'
  | 'delete-worktree'
  | 'switch-branch'
  | 'delete-branch'
  | 'merge'
  | 'update'
  | 'checkout-commit'
  | 'revert'
  | 'cherry-pick'
  | 'remove-untracked'

/** Outcome of a preflight check. */
export type PreflightDecision =
  | { readonly verdict: 'allow' }
  | { readonly verdict: 'confirm'; readonly code: GitFailureCode; readonly paths: readonly string[]; readonly detail: string }
  | { readonly verdict: 'block'; readonly code: GitFailureCode; readonly paths: readonly string[]; readonly detail: string }

/** One worktree-create request's validated inputs. */
export interface WorktreePlan {
  /** The `.worktrees/<slug>` slug. */
  readonly slug: string
  /** Absolute path the worktree will occupy. */
  readonly path: string
  /** Branch the worktree checks out; null when the base is a tag (detached). */
  readonly branch: string | null
  /** Base ref the branch starts from. */
  readonly base: string
  /** `.worktrees.json` steps resolved for this platform. */
  readonly setup: readonly SetupStep[]
}

/** One create-time setup step from `.worktrees.json`. */
export type SetupStep =
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'script'; readonly path: string }

/** Result of running the setup steps, for the panel's setup section. */
export interface SetupReport {
  readonly ran: number
  readonly failed: boolean
  readonly output: string
}

/** The reclaim seam `dsh-next-reset` and `dsh-next-checkpoints` resolve. */
export interface ReclaimResult {
  readonly claimed: boolean
  readonly reason: 'not-a-worktree' | 'reclaimed'
  readonly path: string | null
  readonly branch: string | null
}
