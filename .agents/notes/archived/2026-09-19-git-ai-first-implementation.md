# Git AI-first implementation progress

- date: 2026-09-19
- status: archived
- scope: packages/dsh-next-git

Superseded by [Git panel AI-first workflows and safety](../../implemented/2026-09-20-git-ai-first-workflows.md),
which records the implementation that landed. Kept as the progress handoff it was:
it lists the worker scopes and the plan as they stood mid-implementation, and its
"outstanding work" section is no longer current. Active same-session goal: goal-c4486cd9-cf0f-4605-9bdf-37b9f2618af8.

## Landed in working tree, not committed or installed

- Host safety foundation: active checkout paths, literal pathspecs, serialized mutations, conflict rejection before bulk add, atomic commitAll with guarded index rollback, scoped cancellation IDs, unborn history. New host-safety tests.
- Client foundation: unique per-attempt commit IDs; bulk RPC instead of add then commit; persisted session/checkout drafts and folding; stale-read guards and visible read invalidation; incremental history beyond 500 with host ref anchoring. Keyboard row bubbling fixed, remote switch passes proper local/remote arguments, conflicted Continue/Commit disabled, running commit cancellation visible.
- Official alpha.2 session/workspace/store dependencies installed using pnpm --store-dir .pnpm-store. Normal pnpm add fails Unexpected store location; do not reinstall node_modules or change global config. Existing user lock changes preserved.
- Typed retry-safe session bridge + 40 tests. Lead added per-delivery stable request ID for host deduplication. Native mandatory AI destination dialog, scope preview, stale-preview recheck, both draft buttons routed through it. Entry uses fresh session create and retained turn-end refresh. Worktree opener also creates new instead of reusing blank.
- Pure conflict parser/decisions +51 tests and operation detector +26 tests, git-am marker collector wired. Host conflict module +39 tests: base/current/incoming/result, fingerprints, atomic saves, explicit staging, binary/symlink/delete guards, durable manual backups. RPC integration added. Raw byte runner added +5 tests.
- AI context host now returns omittedPaths, both sides of partially staged files, verb/side/path filtering before caps; core keeps distinct paths and accounts omissions. Obsolete direct runAgentVerb removed. Additional tests still required for newest edits.

## Active independent write scopes

- Conflict UI subagent dfdf4486-e143-452f-aa51-1aa99eada6ab: NEW client/conflicts/ConflictWorkspace.tsx + CSS, NEW tests/conflict-workspace.spec.tsx, additive conflict.* keys in dictionaries en/zh. Lead must not edit dictionaries until it finishes. API getConflict/saveConflict/chooseConflict/markConflictResolved wired by lead. Parent integrates props sessionId,initialPath,paths,t,api,onClose,onChanged,onAskAgent.
- History planner subagent 82e5f742-a400-4bf8-a11c-6add3d4ddf9e: NEW core/history-plan.ts, host/history-operations.ts and matching tests. Typed preview/execute/status/recover with journals, backup refs, safe linear squash/fixup/reorder/reword, ordered cherry-pick/revert. Lead integrates RPC/UI after stable delivery.
- Earlier host, SDK, pure conflict, conflict-host, session-bridge workers are finished. No Agent Team was created. send_message cannot reach subagent UUIDs in this runtime (returns active teammate not found); do not assume a message was delivered.

## Outstanding work

1. Complete foundation tests: new AI context/scope/omission tests, ref-anchored paging, raw UTF-8 chunk RPC tests, chooser cancel/new/retry/stale/keyboard tests, keyboard/draft UI tests. RPC body is now bounded 16 MiB to accommodate conflict text; update oversized fixture (currently 2 MiB).
2. Integrate conflict workspace into GitPanel conflict rows + banner + AI chooser. Add operation Skip and confirmation/backup for Abort. Host conflict backups currently manual-only: do not claim one-click restoration.
3. Integrate history module RPC, selection, commit detail/ref search, wide plan/recovery UI and safe confirmations. No preview bypass.
4. Complete task UX: result adoption for AI commit messages, context selections, host preflight UI wiring, hunk staging, deterministic branch/upstream/stash workflows as scoped in approved plan, worktree setup trust preview.
5. Review all diffs; add non-trivial implementation notes; update both READMEs and pairing. All source UI text bilingual.
6. Full package then monorepo static gates, isolated packaged Playwright scenarios and screenshots. Existing GUI 3080 authentication not inherited by fresh browser; do not claim existing live UI verified from scratch server. Don’t restart the GUI. Existing full smoke may fail on missing VS Code in Skills; investigate actual new results.
7. Logical commits (nothing pushed; prior user said no PR) preserving unrelated work, then pack/install Git into web only after verification.

## Validation so far

Host worker full package green at 585 tests before later AI/conflict RPC edits. Latest lead focused client suite 123/123 plus tsc green; latest integrated host runner/service/RPC/conflict suite 148/148. These are interim results, not final gates. Expected sourcemap and deliberate error-boundary stderr noise in tests. No current server started for implementation yet.

## Preservation

Before this task, the working tree contained unrelated edits and untracked audit outputs. Do not revert, stage wholesale, or claim those changes. Only Git scope owned. DSH checkout must never be modified. Audit runtime under tmp/git-ux-audit is stopped; old screenshots reproduce old defects, not fixes.
