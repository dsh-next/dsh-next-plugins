# Harden dsh-next-skills: wire the master switch, expose config, guard install

- date: 2026-08-29
- status: implemented
- scope: packages/dsh-next-skills

## What

Follow-up hardening after the initial skills review. The review found the
`enabled` config field was dead ("Master switch" did nothing), the default
Market registry (`https://skills.sh/api`) is a Next.js SPA with no REST endpoint
(returns 404), the base URL was not editable anywhere in the GUI, registry
failures surfaced as a raw "HTTP 500" string, installs had no rollback or
`SKILL.md` validation, and Remove was a single unrecoverable click.

## Changes

- **`enabled` master switch is now real.** `SkillsService` gates discovery
  (`listInstalled` returns `[]`), `search` (empty page), and every mutation
  (`setEnabled`, `install`, `remove`, `addRepository`, `removeRepository`) on
  `config.enabled`. `setConfig` stays exempt so the switch can be toggled back
  on. The card's new Configuration block drives it.
- **Configuration block in the card.** Adds a `Manager enabled` checkbox and a
  `Registry base URL` input (save on Enter/blur) that persist via `setConfig`.
  The previous Repositories footer gains an explicit `Add` button.
- **Friendly registry errors.** `search` wraps `searchRegistry` and rethrows a
  human-readable message naming the base URL. The client `rpc()` now reads the
  server JSON `{ error }` body instead of discarding it for a generic
  "HTTP 500".
- **Install hardening.** `install` rejects any unsafe file path before touching
  disk, refuses a payload with no `SKILL.md`, and rolls back the target
  directory if a write fails midway (no half a skill left behind).
- **Two-step Remove with Cancel.** Clicking Remove turns into a `Confirm
  remove?` + `Cancel` pair; only the confirm deletes the skill.

## Visual / layout

Confirmed via Playwright on an isolated keyless `dsh web`: the settings modal
content scrolls (`VOzbGW_options`, `overflow-y:auto`), so the taller card is
reachable. The status/error footer was reordered to sit directly under the tab
content (so a Market registry error is immediately visible) with the
Configuration block at the bottom.

The default registry still returns 404 in the smoke (no public skills.sh REST
API), so the Market tab shows the friendly "Could not load skills from the
registry at ..." message — which is now actionable because the base URL is
editable in the Configuration block.

## Tests

- `skills-service.spec.ts`: manager-disabled gating (empty discovery, refused
  mutations, `setConfig` still re-enables), install refuses no-SKILL.md payloads,
  install rolls back a mid-write failure, search throws the friendly message.
- `card.spec.tsx`: Configuration block renders, manager toggle dispatches
  `setConfig`, registry URL persists on Enter, Remove requires a confirm and
  cancel is honored, Repositories Add dispatches `addRepository`.
- `tests/e2e/mount.e2e.ts`: the `dsh-next-skills` marker now clicks `Remove`
  then `Confirm remove?` before asserting the skill is gone.
- Suite count 127, all green. `pnpm typecheck`, `pnpm test`, `pnpm build` pass.
