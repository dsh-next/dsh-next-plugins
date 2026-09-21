# Register only worktrees created through the panel

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

After successful UI worktree creation, the panel registers the host-previewed
checkout path through the official workspace create API. Both direct creation
and the setup-approval flow share this completion handler. Registration does not
create a session, navigate, scan existing worktrees, or run during refresh.
The previously reverted blanket auto-registration remains removed.

Creation failures never register a workspace. Registration failures keep the
successful Git creation and cleared form, and show a localized message explaining
that the worktree exists and its folder icon can be used to retry opening it.
Existing manual folder-icon behavior is unchanged.

The 64 panel tests cover create-only registration, no initial registration, no
session navigation, create failures, registration failures and setup approval.
Plugin build (including TypeScript), locale check, README pairing/check and
whitespace check passed. The Git E2E scenario additionally asserts the worktree
created by its Create button appears in the left sidebar and captures a screenshot.
The real packed-plugin Git E2E passed; evidence is under
`artifacts/testing/run-ImKzag/git-0/tests/git.e2e.ts-Git-history-cha-b9271-flect-real-repository-state/created-worktree-sidebar.png`.
