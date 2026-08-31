# Move dsh-next-skills into a main settings section; per-provider refresh; recoverable delete

- date: 2026-08-29
- status: implemented
- scope: packages/dsh-next-skills

## What

Three follow-ups to the GitHub-provider rewrite, per user request:

1. **The skills UI is now a main settings section.** The browser half
   registers `{ name: 'settings.section', id: 'skills', order: 16, label:
   'Skills' }` — the same seat General/Models/Plugins occupy (Plugins itself
   registers at order 15) — and the `settings.plugin.item` card registration
   is gone. The panel gets the whole settings content column instead of a
   cramped accordion card. Notably this uses the official additive slot
   (`replaceRisk: none`) rather than the sidebar DOM overlay that
   dsh-skill-explorer hand-mounts, so it cannot break with shell updates.
2. **Per-provider refresh.** New `refreshProvider` RPC + service method
   re-syncs exactly one provider; each Providers row gets its own Refresh
   button (the Refresh-all button remains).
3. **Recoverable delete.** `remove` now moves the skill into the sibling
   `.trash` directory of its root (`<root>/.trash/<timestamp>-<name>`)
   instead of hard-deleting; discovery already skips `.trash`, so the skill
   disappears from the agent but can be restored by hand. Plugin-generated
   workspace shadows are still deleted outright (they are derived artifacts).
   `FsLike` gained `rename` (nodeFs adapter + memfs double implement it).

## Fix included

Providers configured but never successfully synced (for example when the first
add hit a 404) previously had no catalog row, so they were invisible in the
Providers tab and could not be refreshed or removed from the UI. The
`marketplace()` response now merges configured-but-unsynced providers into the
provider rows with a `never synced` marker.

## Structure changes

- `src/client/SkillsCard.tsx` -> `src/client/SkillsPanel.tsx` (no accordion
  header/open state; renders immediately; `.page` wrapper).
- `src/client/index.ts` registers `settings.section` instead of
  `settings.plugin.item`.
- `tests/card.spec.tsx` -> `tests/panel.spec.tsx`.

## Tests

170 vitest cases across 14 suites: panel spec updated for the always-rendered
section (and the per-provider Refresh dispatch), service spec gains the
trash-move assertions (bundle, flat, shadow-outright, not-found) and
refreshProvider cases (single-provider success, unknown provider, broken
provider failure, never-synced marketplace rows). The e2e marker navigates
Settings -> Skills through the nav button instead of Settings -> Plugins ->
card, then drives the same toggle + two-step remove + Providers empty-state
assertions. `pnpm typecheck`, `pnpm test` (170), `pnpm build`, repo-wide
typecheck/test, and `bash scripts/e2e-mount.sh` all green; verified live on an
isolated `dsh web` (Skills section renders with all three tabs, provider flow
re-verified end-to-end).
