# AI-first Git repository management

- Date: 2026-09-19
- Status: proposed implementation plan; no feature in this document is claimed to be shipped.
- Evidence: [Playwright and real-Git audit](../archive/2026-09-19-git-ux-audit.md).
- Builds on the original [Git panel concept](dsh-next-git.md). This proposal owns the follow-up design; the audit owns observed defects.

## Product decision

Build a trustworthy repository task workspace, not another collection of Git commands with sparkle icons. The user should be able to understand a change, prepare a coherent commit, repair an operation and curate history without losing control of where the agent acts.

**User requirement: every AI action asks “Current session or New session?” every time.** No remembered preference may silently bypass that choice. This applies to the existing menu, commit-message drafting, future file/hunk actions, conflicts, commit review and history-plan assistance.

**Safety prerequisite:** repair the demonstrated wrong-worktree deletion and conflict-committing bulk action before adding squash/reorder or autonomous resolution. Keep deterministic Git mechanics separate from AI suggestions.

## Product approaches considered

| Approach | Benefit | Decision |
| --- | --- | --- |
| Add more AI menu verbs | Cheap discovery | Insufficient without scope, routing and result adoption |
| Make every action a chat prompt | Flexible | Reject as the only interface: opaque plans, weak recovery, unnecessary model dependence |
| Build a complete desktop Git clone | Familiar breadth | Defer; too much surface before core safety is reliable |
| Task-oriented sidebar plus focused editors | Keeps ordinary Git fast and makes hard work explicit | Recommended |
| Isolated worktree for every AI action | Good for speculative edits | Optional for new work, wrong default for resolving an operation already bound to a checkout |
| Remove ambiguous AI decoration | Clarifies the heuristic draft immediately | Adopt: either label the deterministic suggestion honestly or replace it |
| Fully automatic “clean up my repository” | Low interaction cost | Explicit opt-in only after preview, checkpoints, permissions and recovery exist |

## 1. One AI action flow

### Destination dialog

Example:

```text
Resolve 3 conflicted files
Repository: project     Checkout: feature/login
Operation: rebase, step 2 of 5

Where should the agent work?
( ) Current session — Fix login flow
( ) New session — Resolve rebase conflicts

Scope: 3 selected files     View context
Authority: edit selected files; no commit or push

Cancel                                      Start resolution
```

- A visible choice is mandatory before submission. A default selection is acceptable only if the dialog still appears and requires explicit confirmation every time.
- Show current session name/status and exact target checkout. If the current session targets a different checkout, disable it with an explanation; do not quietly execute in the wrong repository.
- New session means a genuinely new session, not “navigate to any existing session in this workspace.” Bind it to the same active checkout by default. A fresh worktree is a separate, explicit option for suitable tasks.
- Creating a session, submitting once and navigating must have distinct failure handling. If creation succeeds but sending fails, retain the new session and offer retry; do not create duplicates or fall back to the current chat.
- A busy destination explains whether the action will be queued. Concurrent write tasks against the same checkout must be coordinated or refused, not started silently.
- Cancel sends nothing and makes no repository change. Close/escape and keyboard focus behavior match native shell modals.

### Task scope and context

Each action carries an explicit task rather than just a free-text prompt:

```text
action kind + destination
repository identity + active checkout + session cwd
HEAD/index/content fingerprint
scope: files / hunks / ordered commit IDs / operation conflicts
permission: read-only / propose edits / apply approved edits
context manifest: included, excluded, truncated, unavailable
expected result: findings / explanation / commit message / patch / history plan
```

- Review defaults to selected files if there is a selection, otherwise the explicitly stated working set. Explain diff targets the visible file/hunk, not an unrelated repository-wide diff.
- Commit-message drafting defaults to what will actually be committed: staged changes. “Commit all” context must be explicitly identified.
- Resolve is enabled only with unresolved conflicts. Scope to the selected conflict or all unresolved files before applying payload caps.
- Include both index and working-tree sides for partially staged files when the task covers both. Count every omitted file and byte budget honestly.
- Treat repository content as untrusted evidence, not executable instructions. Let users exclude sensitive files; do not automatically expose ignored credentials or setup output to a model.
- A queued task revalidates its fingerprint when execution begins. If scope changed, show what changed and rebuild/confirm context rather than silently applying stale work.

### Results return to the task

- Review: findings link to file and line, with severity and coverage limits.
- Explain: a concise answer stays attached to the selected diff.
- Draft: “Use message” or “Edit message” fills the commit box. Never auto-commit.
- Resolve: show resulting diff, remaining unmerged paths, validation/test results, and “Review resolution.” Do not equate a successful agent turn with a correct merge.
- History assistance: returns a typed proposed operation plan, not an immediately executed shell script.
- Track preparing, queued, running, needs input, needs review, failed, cancelled and completed states. Link back to the destination session, preserve failures, and refresh the affected repository surfaces.

## 2. Interactive conflict workspace

Yes: offer an IDE-style resolution surface alongside AI delegation. These are complementary paths, not alternatives.

### Presentation

- Keep a persistent operation banner in the sidebar: kind, target checkout, current step, remaining files and “Open resolver.” Conflicts stay discoverable even when Changes is folded.
- Open the resolver in a wide tab/full-width surface. Show **base**, **current**, **incoming**, and editable **result**. Base may be collapsible; do not squeeze all panes into the narrow sidebar.
- Label sides with actual branch/commit names and the operation meaning. During rebase, “ours” and “theirs” do not mean what many users expect; explain this instead of presenting ambiguous buttons.
- Per hunk: accept current, accept incoming, accept both with an explicit order, edit manually, explain conflict with AI, resolve with AI. Both AI commands go through the same session chooser.
- File navigation shows unresolved/resolved/needs-review states, next unresolved, and accessible keyboard actions. Drag is never the sole interaction.

### Resolution lifecycle

1. Read base/index stages, worktree content and conflict type for the active checkout.
2. Edit or accept a proposal against a content fingerprint; refuse stale saves.
3. Save atomically. Validate conflict markers, diff integrity and available project checks; marker absence alone does not establish semantic correctness.
4. Offer explicit **Mark resolved** to stage the reviewed result. Show the staged diff and allow correction before continuing.
5. Enable **Continue** only when Git’s unmerged index is empty and the operation’s other preconditions hold.
6. On success or failure, re-read the operation, changed paths and history. A new conflict at the next step is progress, not a generic stale error.

Handle rename/delete, add/add, binary files, symlinks, submodules and missing sides explicitly. Do not invent a text merge for non-text content. File-level choices need clear consequences.

### AI automatic resolution

Offer “Resolve selected with AI…” and “Resolve all with AI…”. After destination choice and permission preview, an opt-in agent task may edit the allowed files and run approved checks. Preserve the original resolution inputs, show the produced diff, and return a structured unresolved/review-needed result. Stage/continue can be a separately approved mode; never implicitly commit, finish a rebase or push just because the agent says it is done.

A new session used for a merge/rebase conflict must remain in the checkout containing that operation. Making an unrelated fresh worktree would not resolve the original index.

### Operation controls

Provide Continue, safe Abort, and Skip where the specific Git operation supports it. Explain what Skip drops. Abort must warn about resolution edits it will discard and offer an appropriate recovery snapshot. Distinguish merge, rebase, cherry-pick, revert and patch application; persist stopped-commit/sequence metadata across reloads.

## 3. Multi-commit history and a plan editor

Yes to multi-selection, squash, cherry-pick and reorder—but selection should produce a reviewable operation plan, not immediately execute a batch of commands.

### Selection and inspection

- Add checkboxes or a deliberate selection mode, Shift-range and Cmd/Ctrl-toggle, keyboard navigation and a clear selected count. Keep selection by immutable commit ID, not visible row index.
- Ordinary click opens commit details, changed files and diff. Provide search, branch/ref scope, author/date filters and real cursor pagination.
- Show topology with connected graph edges, branch labels and a legend. Do not assume visual row adjacency implies an ancestor range.
- Multi-select toolbar: Compare, Explain selection with AI, Cherry-pick…, Revert…, Squash…, Edit history…. Explain disabled actions.

### Operation eligibility

| Operation | First safe version | Important guard |
| --- | --- | --- |
| Cherry-pick | Ordered list into an explicit target branch/checkout; oldest dependency first by default | Preview exact order, merge mainline requirements, empty commits and conflict recovery |
| Squash/fixup | Contiguous, linear commits on the current branch; choose message | Show every rewritten descendant; reject unsupported roots/merges/noncontiguous selections |
| Reorder | Edit a linear rebase plan using drag **and** Move up/down | Include all intervening commits; show old/new order and dependency/conflict risk |
| Reword | Edit commit message through the same rewrite plan | Explain that descendant IDs change even without code changes |
| Batch revert | Explicit plan, usually newest-first | Merge commits need mainline selection; stop and recover consistently on conflicts |

Topology-aware merge-preserving rewriting is a later capability. Do not silently flatten merges or reinterpret an arbitrary selection as a safe contiguous range.

### Plan preview and apply

Preview target branch/checkout, ordered actions, affected commit IDs and descendants, expected diff, dirty index/worktree status, active operations, branches checked out elsewhere and published-history implications.

Published state may be **unknown** when remote data is stale or unavailable. Do not call a commit “unpublished” merely because no matching local remote ref is known. Fetch only with the user’s authorization. Warn and require explicit consent for rewriting shared/published history; never auto-force-push. If push is later offered, default to a lease-based policy, not an unqualified force.

Before apply, create a durable backup ref and record original HEAD, relevant refs, index state and plan. A backup ref does **not** back up dirty or untracked files: require a clean checkout or provide a separate explicit snapshot/stash policy that preserves those files safely. Revalidate the preview fingerprint immediately before mutation.

Execute through the deterministic host operation module. Persist operation ID, current step, expected state and recovery information. Reuse the conflict workspace on a stop. Recovery must explain what is restored and refuse to overwrite later unrelated work; “Undo” is not a promise that resetting HEAD restores everything.

### AI-assisted history

Good AI jobs: propose coherent commit groups, suggest squash/fixup, draft messages, explain a range, identify risky dependencies, and summarize the planned rewrite. Every job still asks for current/new session. The AI proposes; the user reviews; the Git executor validates and applies. This avoids handing irreversible semantics to unconstrained generated commands.

## 4. Other high-value AI-first workflows

1. **Prepare a clean commit:** selected changes → suggested grouping → hunk review/staging → AI message → human commit.
2. **Review before commit:** staged diff with test status, possible secrets and omitted-context warnings; findings link back into the panel.
3. **Explain repository state:** explain ahead/behind, detached HEAD, current operation and the safest next step, scoped to the actual checkout.
4. **Bring a branch up to date:** compare merge versus rebase, preview consequences, then deterministic execution and conflict recovery.
5. **Finish an agent task:** inspect agent-produced diff, run approved tests, adopt a message, commit or request changes. Agent completion is not automatically a commit.
6. **Worktree health:** identify dirty/merged/stale/locked checkouts and their active sessions; propose cleanup without deleting until confirmed.
7. **Recover safely:** operation journal, backup refs and guided restoration. Make recovery part of the feature, not a terminal escape hatch.

Fetch/push/upstream management, stash/apply, branch creation/rename and hunk staging are useful deterministic basics. Add them where they close an observed task gap; do not turn every routine click into a paid model call.

## 5. Module design and SDK constraints

Keep the existing core/host/client structure and official npm SDK contract. Do not modify the DSH checkout.

- **Repository identity module:** one interface that distinguishes common git identity, active checkout, primary checkout and session cwd; owns literal path/ref validation.
- **Operation module:** `preview`, `execute`, `status`, `continue`, `skip`, `abort`; owns capabilities, fingerprints, serialization, unique IDs, cancellation, journals and recovery. Restrict methods to supported operations rather than accepting arbitrary shell.
- **AI task module:** owns typed scope, payload accounting, destination choice result, exact-once submission intent, permission description, task progress and result adoption. Current-session and new-session transports are concrete adapters at this seam.
- **Conflict module:** owns index stages, typed conflict cases, content-versioned save/mark-resolved and operation continuation rules.
- Focused client surfaces for the existing sidebar, destination dialog, history plan and conflict workspace. Extract from the large panel/service deliberately instead of adding another chain of special cases.

Validate session creation/navigation and lifecycle subscriptions against the installed official SDK. The current workspace opener only navigates a workspace and was absent in the isolated Git-only mount; it is not evidence of a reliable new-session factory. If the SDK lacks a required capability, report that constraint explicitly. Never silently route New session back to Current session.

A plugin mutex does not control arbitrary external Git processes or agent shell commands. Combine host serialization with snapshot revalidation, Git locks, visible ownership and a pause/refusal policy for concurrent mutating tasks. Do not hold an invisible long-lived lock while waiting for a model or human.

## 6. Delivery sequence and acceptance gates

### A. Stabilize before feature expansion

Fix wrong-root paths, nested cwd, bulk conflict staging, stage-failure continuation, cancellation IDs, host guards, remote branch wiring, keyboard bubbling, stale views and draft retention. Convert each audit reproduction into a permanent regression test. Correct README claims that exceed reachable behavior.

### B. Universal AI destination and task handoff

Acceptance: each existing AI entry point asks every time; cancel submits nothing; both destinations target the correct checkout; failures do not reroute or duplicate; queued scope is revalidated; payload omissions are accurate; drafting has an explicit “Use message” return path; English/Chinese dictionary parity holds.

### C. Interactive conflict workspace

Acceptance: real merge/rebase/cherry-pick/revert fixtures can be inspected, edited, staged, continued and aborted entirely in the GUI; rename/delete and binary cases are explicit; Continue is blocked until ready; stale writes are rejected; AI uses the same chooser and returns reviewable results.

### D. History selection and deterministic planning

Acceptance: keyboard/range selection, commit details and cursor pagination work first. Then ordered cherry-pick, contiguous squash/fixup and reorder each have preflight, backup/recovery, reload-resume and conflict tests. Unsupported topology is refused clearly. No silent force push.

### E. Task-oriented repository management

Add grouping, hunk staging, review-before-commit, upstream workflows and worktree cleanup as separate slices. Measure time-to-safe-completion, recovery success, destination mistakes, retained drafts, AI result adoption and context coverage—not merely the number of AI buttons.

For every slice: exhaustive pure/host/RPC/client tests, a real packaged Playwright path with on-disk assertions, error/abort/retry cases, two-session races, light/dark screenshots, keyboard checks, bilingual UI strings and the repository’s full required gates. Live-model evaluation is a separate opt-in lane with explicit cost and credentials.
