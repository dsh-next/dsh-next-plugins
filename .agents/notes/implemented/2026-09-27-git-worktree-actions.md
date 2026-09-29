# Compact worktree actions in the Source control sidebar

- date: 2026-09-27
- status: implemented
- scope: packages/dsh-next-git

The merge button's branch name used most of the row width, leaving linked worktree names, paths and statuses nearly unreadable. The merge action is now a 26px icon with a localized destination tooltip and accessible name. Actions share only the heading line; path and status span the full row. Hover/focus and touch visibility follow the panel's existing row-action grammar. The browser component test covers the action and tooltip; the Git E2E suite checks actual widths and captures the tooltip in a running shell.
