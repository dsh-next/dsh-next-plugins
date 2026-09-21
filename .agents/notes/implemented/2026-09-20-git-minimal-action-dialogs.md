# Minimal Git action dialogs

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

Follow-up to the repository action menu: remove the repository-name line and all
Refresh/Cancel text buttons, including the duplicate confirmation dismissal.
The native modal close icon and Escape remain available, with the existing
pending-operation close guard. Reopening reads fresh inventory. Confirmation,
force acknowledgement and version checks are unchanged.

Visual changes retain the shell Modal's 24px content padding, title and close
control, tokens and elevation. The dialog is 400px wide; labels sit above
full-width 34px fields with a 4px label gap and 16px field spacing. Primary
actions are intrinsic-width and right aligned, rather than stretched across the
form. Checkbox labels stay inline. No new dictionary keys or dependencies.

Tests cover missing chrome, close without execution, reopening inventory,
post-action refresh errors, mutation safeguards, aligned fields and Escape in
the real runtime. Dark/light rename screenshots are captured by the Git suite.
The bilingual README documents the new layout and dismissal behavior.

Verification: full `pnpm test` passes (Git: 1,225 passing, one existing skip).
Git typecheck, 44 focused menu/dialog tests, real Git browser suite,
docs/i18n checks and whitespace checks pass. Light/dark evidence was inspected in
artifacts/testing/run-8u4kat; the dark rename screenshot is included in the README.
The runtime was an isolated test profile; the user's running GUI was not restarted.
The earlier full static/family-mount gate remains blocked by the unrelated
cc-plugins mixed SDK MessageId types recorded in the menu implementation note.
