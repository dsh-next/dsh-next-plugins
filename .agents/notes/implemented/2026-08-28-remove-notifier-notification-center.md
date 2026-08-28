# Remove the notifier notification center (redundant with shell session markers)

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier

The per-session notification center feature (a `shell.overlay` panel listing
which session had an unread notification, with per-kind icons) was removed per
user direction. The DSH session list already marks each session's state (a green
"done" reminder for one that finished while not selected, an amber dot for one
blocked on user interaction), so the extra notification center was redundant —
and it could not be placed inline as a native sidebar section without
reimplementing the whole `sidebar.workspaces` browser region (the sidebar has no
additive inline slot above the Workspaces list).

Removed cleanly: the `shell.overlay` center component, its per-kind icon set and
CSS module, the core unread derivation module, the Host per-session unread store
and its `getUnread`/`clearUnread` RPC, the clear-on-focused presence hook
(reverted to presence reporting only), the `centerEnabled` settings field and
its "Show notification center" card checkbox, and the supporting unit/RPC tests
(the notifier is back to 66 tests). The `@deepseek-ai/dsh-client-ui-layout`
devDependency (needed only for the `shell.overlay` slot type) was dropped.

The plugin still does browser web notifications and sound alerts; the session
list markers come from the shell, not from this plugin. Verified:
`pnpm typecheck` clean, notifier 66 tests green, `pnpm build` succeeds,
`bash scripts/e2e-mount.sh` 1 passed, `pnpm docs:check` 10 READMEs. Bundle has
no `shell.overlay`/`centerEnabled`/`dsh-client-ui-layout` refs.
