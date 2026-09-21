# Register discovered Git worktrees as sidebar workspaces

- date: 2026-09-20
- status: archived
- scope: packages/dsh-next-git

Reverted at the user's request. Automatic registration, its panel wiring, tests
and documentation were removed. Manual folder-icon registration is unchanged;
existing workspace records, worktrees and sessions were not deleted. The scoped
Close-selector correction in the E2E test remains independent of this feature.

Historical implementation:

Each successful Source control state read now sends its worktree inventory to a
plugin-lifetime client registrar. The existing official workspace create API is
idempotent and updates the sidebar model; the registrar does not create sessions,
navigate, change Git, or delete workspace registrations. This also covers newly
created worktrees after the normal post-create refresh, without expanding the
Worktrees accordion.

Existing registrations and pending/successful paths are deduplicated across
panels and polling. Missing/prunable entries and entries without a checkout HEAD
are skipped. Failed registrations are logged and retried on the next Git refresh;
unloading prevents queued/new requests and ignores late failure notifications.
A workspace explicitly removed after discovery is not repeatedly re-added during
the same plugin lifetime. Reloading discovers it anew if the worktree still exists.

Tests cover initial discovery, later discovery through the actual panel refresh,
concurrent duplicates, delayed registry echoes, failure isolation/retry, existing
registrations, disposal, detached and locked worktrees. The Git E2E scenario now
asserts two pre-existing worktrees and one later-created worktree appear as sidebar
rows without opening sessions in them. No DSH checkout or user registry file was
edited; the browser applies registrations through the SDK on the next panel read.

Validation: 69 focused tests and TypeScript passed. Full Git suite passed on
rerun (1,170 passed, one filesystem skip); the first concurrent run hit the
existing 150ms-timer hanging-hook cancellation test timeout, which also passed
in isolation. Build, docs parity, locale and whitespace checks passed. Real
packed-plugin Git E2E passed, including initial and later registration assertions;
the test's ambiguous global Close selector was scoped to the dialog. Runtime
screenshot: `artifacts/testing/run-ubiHfq/git-0/tests/git.e2e.ts-Git-history-cha-b9271-flect-real-repository-state/auto-worktree-workspaces.png`.
The native sidebar's grouping preference still controls flat versus nested rows.
