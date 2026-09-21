# Expand Git accordion click targets

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

Changes, Worktrees, and History now toggle from header background, spacer, and
count clicks, while the native title button retains keyboard activation and
aria-expanded. Header action buttons (including their SVG descendants) are
excluded from the header handler, preventing double toggles and keeping reload
and staging independent. Removed the title-only hover fill; preserved focus
rings, existing header surfaces, and action-button hover feedback.

Regression tests cover each accordion's background, spacer, title and count,
plus independent Stage all and History reload. Live GUI screenshots remain
outstanding; no running GUI was reinstalled or restarted.
