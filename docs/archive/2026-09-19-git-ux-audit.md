# Git UX and safety audit — 2026-09-19

- Status: review completed; findings below are not fixes.
- Checkout: `edd39217c1f82801732deb2f6363a5c956a3b1a1`.
- Runtime: DSH 0.1.6-alpha.2, Node 22.23.2, Apple Git 2.50.1; packaged Git plugin in an isolated keyless profile.
- Product follow-up: [AI-first repository management proposal](../ideas/dsh-next-git-ai-first.md).

## Executive assessment

The panel has a useful everyday-Git foundation, but it is not safe enough yet to add unattended history rewriting. Two destructive defects were reproduced through real browser controls: linked-worktree discard deletes a file in the wrong checkout, and Commit All can commit unresolved merge markers. Fix these before expanding automation.

The AI menu is currently prompt delivery, not a managed task workflow: all four actions immediately submit to the current session. There is no destination choice, context preview, result adoption, or interactive conflict editor. The requested current/new-session choice should be an invariant shared by every AI entry point.

## Method and limits

- Playwright Chromium exercised the packaged plugin against real Git repositories and local-only remote refs. Mutations, conflicts, destructive confirmations, and history rewrites used disposable fixtures, never the project history or user worktrees.
- The existing GUI at `http://127.0.0.1:3080` returned an authentication-required page to the fresh browser. Its authenticated installed profile was therefore **not** audited. The isolated runtime was verified at `http://127.0.0.1:52396`; it was not a replacement for the user GUI.
- `pnpm --filter @dsh-next/dsh-next-git test`: **426 tests passed across 18 files**, exit 0. The isolated workflow also built and packed the Git plugin successfully.
- Independent real-Git probes exercised the current source through controller, RPC, and host layers for nested paths, incomplete AI context, bulk-commit failure, cancellation, and history freshness. [Recorded host evidence](git-ux-audit-2026-09-19/host-evidence.json).
- AI prompts were observed arriving in chat. Fake credentials deliberately prevented model execution. Resolution correctness, model quality, real credentials, cost, and successful AI output adoption were **not** tested.
- Browser runs included light/dark themes, 1440×1000 and 1100×820 viewports, keyboard interaction, clipboard, and native file viewing. No page exceptions or dead-slot markers were recorded in the completed edge/UX runs. This is not an exhaustive accessibility or performance certification.
- Initial harness failures involved onboarding timing, pane restoration, awaiting staging, and an incorrect success-notice expectation. These were investigated and corrected. An early cherry-pick assertion selected an empty/current-branch commit; the supported replay was subsequently verified using a reverted ancestor. Observational scripts can report a reproduced product bug as a passed observation; they are not green regression tests.
- No production plugin implementation, existing profile, DSH checkout, or pre-existing user changes were modified. No full monorepo static gate or stock all-plugin E2E suite was run for this documentation-only review.

## Functionality exercised

| Area | Browser result | Remaining limitation |
| --- | --- | --- |
| Default layout | Changes, Worktrees and History start collapsed; keyboard expansion works | Expansion and unsent commit draft disappear on tab-body remount |
| Changes | Whole-file stage/unstage and bulk stage/unstage work, verified on disk | Keyboard activation of a nested Stage button opens diff instead |
| Diffs | Tracked/untracked text, clipboard patch, binary fallback, large-file fallback and native file-viewer handoff work | Conflicts show an empty diff; open diffs do not refresh with external edits |
| Discard | Cancel preserves content; tracked restore and untracked deletion work in primary checkout | Wrong-checkout deletion in linked checkout; confirmation says “Delete anyway” even for restore |
| Commit | Staged commit, keyboard shortcut after staging completes, amend and Commit All happy path work | Conflict and staging-failure defects; message-only amend unavailable |
| Hooks/identity | Failed-hook output and Retry work; missing identity has a useful banner | Running-hook Cancel is not offered; cross-session cancellation is broken |
| Empty states | Non-repository guidance and unborn header work | Expanding History before the first commit produces a generic error |
| Branches | Local switch and detached checkout confirmation work | Remote selection fails; create/rename/delete have host support but no visible branch-menu controls |
| Worktree creation | New branch, existing branch, remote ref and detached tag creation work | Setup/include paths have existing unit coverage, not a new browser walkthrough here |
| Worktree maintenance | Comparison base, update, merge, unlock, delete cancellation/confirmation and missing-folder prune work | Merge is immediate with no preflight confirmation; session-opening button absent in this isolated mount |
| Upstream update | Header action merges the cached upstream ref | No fetch/push/sync UI; this is not a network pull |
| History | Load more, copy hash, checkout, revert and cherry-pick of a reverted ancestor work | No multi-select/details/search/ref selection; pagination stalls at 500 |
| Operations | Merge banner, failed premature Continue, Abort, externally resolved Continue; rebase banner/Abort; cherry-pick conflict Continue work | No interactive resolver, mark-resolved action, Skip, or complete sequence recovery |
| AI menu | Review, Explain, Draft and Resolve all deliver prompts to the same current chat | No chooser; fake-key model calls intentionally fail; no structured return path |
| State refresh | Own commits update history; explicit History refresh works | External edits/HEAD changes and branch switches can leave visible diff/history stale |

Not newly browser-tested: absent/old Git binaries, OS permission failures, bare repositories, index-lock stress, real network credentials, setup-script trust, rename/delete/binary conflict resolution, successful rebase Continue, revert-conflict recovery, and live model completion. Existing unit coverage is evidence only for the cases it actually exercises, not a substitute for these browser paths.

## Findings, ordered by risk

### P0 — Discard can delete a file in the wrong worktree

**Browser-reproduced.** Created the same untracked filename in primary and linked checkouts with different content. The linked session diff showed the PRIMARY content. Confirming Discard removed the primary file, while the linked file remained. The operation is classified against linked status but resolved against the primary root.

Source: [repository identity](../../packages/dsh-next-git/src/host/git-service.ts#L204-L211), [untracked deletion](../../packages/dsh-next-git/src/host/git-service.ts#L446-L469), [untracked diff](../../packages/dsh-next-git/src/host/git-service.ts#L338-L351). [Browser evidence](git-ux-audit-2026-09-19/results-linked-confirmed.json).

Fix: distinguish common repository identity, primary checkout, active checkout root and session cwd. Resolve all file reads/writes against the active checkout, with validated literal paths. Keep the common git directory only for shared-ref identity/coordination. Add regression fixtures where a primary tracked file has the same name as a linked untracked file.

### P0 — Commit All commits unresolved conflict markers

**Browser-reproduced.** Started a conflicted merge, added another untracked file, then selected Commit All Changes. It committed `<<<<<<<`, `=======` and `>>>>>>>` into the tracked file, emptied the unmerged index and ended the merge.

Source: [bulk staging](../../packages/dsh-next-git/src/client/controller.ts#L398-L413) filters unmerged entries from the unstaged collection but not the staged collection. Real porcelain puts the conflict into both. The existing test uses an unrealistic conflict fixture. [Browser evidence](git-ux-audit-2026-09-19/results-safety.json).

Fix: reject bulk commit when index stages remain unresolved, enforced on the host. Do not silently stage conflicted paths. Separately validate the saved resolution and require explicit resolution staging. Use real porcelain-derived fixtures; marker scanning alone is not sufficient proof of resolution.

### P1 — Bulk commit reports success after staging fails

**Real-Git host reproduction.** With one previously staged file, one unstaged tracked file and a now-missing untracked file, stage-all failed with exit 128. The controller then committed the old partial index and cleared the error. The intended tracked edit remained uncommitted.

Source: [write catches failure](../../packages/dsh-next-git/src/client/controller.ts#L330-L340), [unconditional commit](../../packages/dsh-next-git/src/client/controller.ts#L398-L413). [Evidence](git-ux-audit-2026-09-19/host-evidence.json#L87-L158). Fix with an explicit success result/short circuit, preferably one host-owned stage-and-commit transaction with an index recovery policy.

### P1 — Concurrent sessions cancel one another’s commits

**Real-Git host reproduction, two repositories.** Both stores send request ID `commit`. Starting B cancels A. A then clears B’s replacement registry entry, so cancelling B reports false while B continues.

Source: [constant ID](../../packages/dsh-next-git/src/client/controller.ts#L416-L426), [registry replacement/cleanup](../../packages/dsh-next-git/src/host/git-runner.ts#L234-L258). [Evidence](git-ux-audit-2026-09-19/host-evidence.json#L159-L230). Use unique operation IDs, session ownership and identity-checked cleanup; expose cancellation while the action is actually running.

### P1 — Preflight exists but does not protect the button flows

**Browser plus source.** Revert, cherry-pick and worktree merge executed immediately; network records contained the mutation, not a preflight round trip. Hand-built dialogs protect some other actions, but the existing preflight helper is not the canonical path. Several branch/history/worktree mutations also bypass the runner mutation queue. Git’s own protections still apply; this is not a claim that every immediate action loses work.

Source: [single-commit handlers](../../packages/dsh-next-git/src/client/GitPanel.tsx#L1797-L1803), [host mutation methods](../../packages/dsh-next-git/src/host/git-service.ts#L1071-L1197). Make a host operation module own capability checks, preview, state revalidation, execution and fresh results. Include staged-only dirt and external-writer races; a plugin queue cannot serialize arbitrary agent shell commands.

### P1 — The conflict UI is not a resolution workflow

**Browser-reproduced.** A conflicted row opens “No changes on this side.” Continue is enabled before resolution. The row has Discard but no Stage/Mark resolved, editor or side selection. External file editing plus `git add` made Continue work, proving the recovery buttons are useful but not sufficient.

Source: [combined-diff parsing](../../packages/dsh-next-git/src/core/diff.ts#L58-L76), [conflict rows](../../packages/dsh-next-git/src/client/GitPanel.tsx#L1017-L1099), [operation controls](../../packages/dsh-next-git/src/client/GitPanel.tsx#L762-L785). Offer a proper base/current/incoming/result workflow; do not describe the current surface as interactive conflict resolution.

### P1 — Sessions in a nested folder use the wrong pathspec base

**Real-Git host reproduction.** A session in the `src` subdirectory receives `src/a.txt` from status. Diff returns empty and Stage looks for a doubled `src/src` path, failing exit 128.

Source: [diff execution](../../packages/dsh-next-git/src/host/git-service.ts#L304-L317), [staging](../../packages/dsh-next-git/src/host/git-service.ts#L409-L417). [Evidence](git-ux-audit-2026-09-19/host-evidence.json#L7-L60). Run root-relative operations from the active checkout toplevel, not the session cwd or primary checkout root.

### P2 — AI context is incomplete without telling the user

**Real-Git host reproduction.** Forty-one small changed files become forty, with `dropped=[]` and `truncated=false`. A partially staged file contributes only its staged diff; its unstaged edit is missing. This undermines “Review changes” before model quality even matters.

Source: [host collection](../../packages/dsh-next-git/src/host/git-service.ts#L1256-L1273), [client omission accounting](../../packages/dsh-next-git/src/core/agent-verbs.ts#L100-L104). [Evidence](git-ux-audit-2026-09-19/host-evidence.json#L61-L86). Define scope first, include both relevant sides, prioritize conflicts, and return explicit counts/omissions from the host.

### P2 — Visible state can be stale

**Browser-reproduced.** An open diff kept version one after the file changed to version two and the toolbar Refresh ran. External commits and local branch switches left History displaying an old hash until its separate Refresh. **Own commits do refresh History**; the finding is not “history never refreshes.” The agent-turn refresh method also lacks a production caller.

Source: [state-only refresh](../../packages/dsh-next-git/src/client/controller.ts#L189-L233), [first-expansion history loading](../../packages/dsh-next-git/src/client/GitPanel.tsx#L1719-L1728). [Browser evidence](git-ux-audit-2026-09-19/results-edges.json). Invalidate the visible diff/history after repository, operation and turn changes, with request ordering guards and an observable refresh state.

### P2 — Keyboard actions and draft persistence need repair

**Browser-reproduced.** Focusing Stage and pressing Enter opened the parent row diff; no staging occurred. The parent row handles bubbled key events and prevents the child button’s native action. Entered commit text and section expansion also vanished after switching to Start and back.

Source: [row key handler](../../packages/dsh-next-git/src/client/GitPanel.tsx#L1164-L1177), [store release](../../packages/dsh-next-git/src/client/GitPanel.tsx#L573-L581). [Evidence](git-ux-audit-2026-09-19/results-ux.json). Restrict row keyboard handling to the row target, preserve session/worktree-scoped drafts and preferences, and restore focus after dialogs.

### P2 — History and branch capability gaps

- **Browser:** Load more stops at 500 rows but remains available indefinitely. Implement stable cursor pagination, not an ever-increasing capped limit.
- **Browser:** Picking a remote branch produces “a branch is expected, got remote branch”; the menu does not supply the host’s supported remote-checkout arguments.
- **Browser/source:** No commit selection, details, changed-file list, search/ref picker, squash or reorder. A graph made of isolated lane dots does not communicate topology well enough for rewriting.
- **Source:** Amend shares staged-file eligibility, so message-only amend is unavailable and there is no published-history warning.
- **Source:** Branch create/rename/delete labels and host methods do not make those operations reachable from the rendered branch menu.

[History/remote browser evidence](git-ux-audit-2026-09-19/results-worktrees.json), [pagination evidence](git-ux-audit-2026-09-19/results-edges.json), [history controls](../../packages/dsh-next-git/src/client/GitPanel.tsx#L1759-L1817).

### P2 — AI affordances are inconsistent

All four menu entries immediately queued into the current chat; no chooser appeared. Resolve remained offered without any conflict and sent an instruction to resolve ordinary changes. There was no successful-handoff notice. The composer sparkle filled a deterministic filename-based subject, whereas the menu’s Draft sent a prompt to chat and did not populate the commit box.

[AI browser evidence](git-ux-audit-2026-09-19/results-safety.json), [heuristic draft evidence](git-ux-audit-2026-09-19/results-basic-retest.json), [prompt routing](../../packages/dsh-next-git/src/client/index.ts#L188-L201), [handoff result](../../packages/dsh-next-git/src/client/controller.ts#L613-L631). Use the shared destination chooser; rename the heuristic action or replace it with genuine AI drafting and an explicit “Use message” result action. Disable Resolve with a reason when nothing is conflicted.

### P2 — An empty repository is presented as a history error

**Browser-reproduced.** A true non-repository correctly displayed setup guidance. After initializing an empty repository, the header correctly said “No commits yet,” but expanding History displayed a generic Git failure. This should be a calm empty state, not an instruction to diagnose Git in a terminal. [State evidence](git-ux-audit-2026-09-19/results-states-retest.json).

### Source-only risks requiring targeted follow-up

- The operation detector treats `rebase-apply` as rebase without distinguishing patch application (`git am`); sequence/Skip/empty-pick recovery is incomplete. Re-read operation state on failure as well as success.
- File pathspec magic and unusual ref names need adversarial tests and literal/validated addressing. No exploit was attempted.
- Worktree setup runs repository-supplied shell commands. Show trust, exact commands, working directory and skip choice before execution; do not imply that opening a repository authorizes arbitrary setup.
- Repository text and diffs are untrusted model input and can contain secrets. Preview scope and exclusions; never turn a diff instruction into action authority.
- State reads enrich every worktree with multiple Git commands. Measure large-repository latency and payload budgets before adding background AI analysis. No performance benchmark was run.

## Visual and interaction assessment

The native shell tokens and compact accordions are a good baseline in both themes. Keep that visual language. The main problems are workflow clarity rather than a need to restyle everything:

1. Put active conflicts and the next recovery step above folded sections. Keep sections folded by default as requested, but make “Resolve N files” reveal the relevant work.
2. Show active checkout and operation target explicitly. A branch name alone is insufficient when several sessions share repository history.
3. Replace generic “Delete anyway” with action-specific Discard/Delete/Abort labels and actual affected paths.
4. Use one clear AI grammar with scope, destination and result state. Two visually identical sparkles should not mean unrelated capabilities.
5. Keep quick status in the sidebar; open history planning and multi-pane conflict editing in a wider workspace. Do not compress a three-way editor into a 400px pane.
6. Explain disabled actions and empty states, retain drafts/selection, provide keyboard alternatives to drag, and distinguish a real progress indicator from a static refresh icon.

## Evidence index

- [Everyday workflows](git-ux-audit-2026-09-19/results-basic-retest.json), [hooks/merge](git-ux-audit-2026-09-19/results-advanced.json), [AI and bulk-conflict reproduction](git-ux-audit-2026-09-19/results-safety.json).
- [Wrong-worktree reproduction](git-ux-audit-2026-09-19/results-linked-confirmed.json), [worktree maintenance](git-ux-audit-2026-09-19/results-worktrees.json), [edge cases](git-ux-audit-2026-09-19/results-edges.json), [keyboard/drafts/viewer](git-ux-audit-2026-09-19/results-ux.json).
- [Host reproduction harness](../../tmp/git-ux-audit/host-probes/probe.mjs) and [host results](git-ux-audit-2026-09-19/host-evidence.json).
- [Conflict shown as empty](git-ux-audit-2026-09-19/screenshots/09-conflict-diff.png), [wrong-checkout content](git-ux-audit-2026-09-19/screenshots/12-linked-wrong-diff.png), [wrong-checkout deletion aftermath](git-ux-audit-2026-09-19/screenshots/13-linked-wrong-discard.png), [dark AI menu](git-ux-audit-2026-09-19/screenshots/21-dark-menu.png).

Selected JSON observations and screenshots are preserved beside this report. Temporary browser/host harnesses and disposable fixtures remain in the ignored audit directory, not permanent CI fixtures. Private runtime token URLs, browser storage and scratch homes are not deliverables. Promote each reproduced defect into a permanent regression test when fixing it.
