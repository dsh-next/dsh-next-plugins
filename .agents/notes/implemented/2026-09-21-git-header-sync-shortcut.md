# Sync shortcut before the branch selector

- date: 2026-09-21
- status: implemented
- scope: packages/dsh-next-git

Added a native icon button immediately before the branch selector. It reuses the
localized Sync label and the existing repository-command dialog, including preview
and explicit execution approval. The click itself never pulls or pushes. The
existing Refresh control and Sync menu item remain unchanged. The shortcut is
disabled while the panel is busy or has no repository state.

Follow-up: Sync uses opposing up/down arrows to distinguish pull/push from the
circular Refresh glyph. The installed SDK has no matching bidirectional icon, so
this small decorative SVG uses currentColor, a 16px box and the existing button
chrome. A DOM regression check pins that Sync and Refresh have distinct paths.

Second follow-up: the change rows' `Review hunks` action was removed, because a
row click already opens the dedicated change tab with its own per-hunk staging.
Rows now carry only stage/unstage and discard. The in-panel diff remains the
documented fallback for a host whose tab action cannot claim the change address
(and while the tab record is not committed); tests drive that fallback through a
throwing `openResource` instead of the removed button. The final browser suite in
`artifacts/testing/run-8EFIQx` verified the simplified row and the new Sync glyph,
and `media/header-sync.webp` was refreshed. Git typecheck, 1,627 Git tests (one
existing skip), bilingual docs, i18n and whitespace checks passed.

Tests cover DOM ordering, accessible name, dialog routing, no implicit execution
and unavailable repositories. The full Git browser suite passed in
`artifacts/testing/run-1IZvBZ`, verifying actual icon placement and dialog opening.
The dark header screenshot was inspected and saved as `media/header-sync.webp`.
Git typecheck, bilingual documentation, i18n and whitespace checks passed.
