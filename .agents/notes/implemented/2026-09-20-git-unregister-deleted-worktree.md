# Remove a deleted worktree's sidebar workspace entry

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

Confirmed worktree deletion from the Git panel now removes the workspace
registration matching that exact checkout path. The controller returns an
explicit successful-removal boolean; cancellation, a busy refusal or a failed
Git call cannot trigger workspace cleanup. The SDK workspace delete operation
retains sessions and files; no session deletion or navigation API is called.
Unrelated, parent and nested workspace registrations are left alone.

An unavailable registry or failed workspace deletion reports a localized
partial-success error rather than claiming the Git worktree still exists.
This does not scan or clean up registrations for externally deleted worktrees.

Validation: 133 controller, panel and entry tests passed; plugin build including
TypeScript, bilingual documentation, locale parity and whitespace checks passed.
The Git E2E scenario now verifies a UI-created workspace row disappears after
confirmed worktree deletion and the checkout directory is absent. The real
packed-plugin Git E2E passed (`artifacts/testing/run-MGOszp/summary.json`).
