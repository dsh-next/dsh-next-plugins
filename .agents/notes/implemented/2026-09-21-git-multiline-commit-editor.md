# Single multiline commit message editor

- date: 2026-09-21
- status: implemented
- scope: packages/dsh-next-git

The Changes section's Commit dialog now uses one multiline Commit message box.
Its first line remains the required subject; optional body text follows after a
blank line. The store retains the complete message without splitting/rejoining
on every edit. Cmd/Ctrl+Enter still commits; plain Enter remains a newline.

The existing inline AI draft button sits inside the field's top-right corner,
with 44px of text padding so it cannot cover the message. Status and errors stay
below the editor rather than overlaying text. Successful AI output replaces the
whole value; failure handling is unchanged. History operation dialogs and other
commit variants are not restyled in this change.

Unit coverage checks the single textarea, multiline payload preservation, AI
replacement, empty first-line validation and keyboard submission. The browser
suite checks button containment/padding, generates a deterministic message, and
verifies the actual Git commit subject/body after submission. The first browser
attempt was interrupted before reaching Git by a late onboarding dialog; it was
retried in a fresh owned runtime rather than weakening assertions.

Validation passed: Git typecheck, 1,612 Git tests (one existing skip), the full
Git browser suite in `artifacts/testing/run-m5FJs9`, docs/i18n and whitespace
checks. The README's commit-dialog image now shows the verified editor.
