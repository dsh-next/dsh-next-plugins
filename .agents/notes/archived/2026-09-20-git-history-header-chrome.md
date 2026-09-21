# Git History section adopts the shared section chrome and icon-only reload

- date: 2026-09-20
- status: archived
- scope: packages/dsh-next-git

The History section previously rendered its own plain header (a text
"Refresh history" ghost button beside a bare heading) while Changes and
Worktrees used the panel's shared SCM section band. History now renders
the same header markup as the other sections, reusing the classes from
`src/client/panel.module.css` (`sectionHeader`, `sectionToggle` with
chevron, `sectionTitle`, `sectionSpacer`) instead of duplicating layout
in `history-section.module.css`; the dead `.header`/`.heading` rules were
removed.

The text refresh button is replaced by an icon-only reload button in the
header's quiet grammar (`iconButton` + `IconRefreshOutline16`), matching
the panel header's refresh control: `history.refresh` now lives only in
`aria-label`/`title`, the icon spins while `historyLoading`, and the
button stays disabled while history is loading or the panel is busy.

Validation: `packages/dsh-next-git` vitest suite green (1084 tests,
including the history-section spec that pins the shared chrome classes,
icon-only content, tooltip localization and disabled states), package
`tsc` + tsdown build green, monorepo `pnpm typecheck` and
`pnpm i18n:check` green. The full `scripts/e2e-mount.sh` smoke could not
run: the workspace-wide build fails in `packages/dsh-next-cc-plugins`
`src/host/runtime.ts` on a pre-existing `@deepseek-ai/dsh-llm` version
skew (0.1.2-rc.1 vs 0.1.6-alpha.2 resolving as two copies with
incompatible branded types) introduced by unrelated lockfile edits that
predate this change. That failure is untouched by and unrelated to this
client-only Git change; rerun the smoke once the skew is resolved. The
existing e2e marker already asserts the history section-toggle and
captures a `history` screenshot when the smoke runs.

Deviations from the harness look: none; all values are existing
`--dsw-*` aliases and classes already used by the Worktrees/Changes
headers.
