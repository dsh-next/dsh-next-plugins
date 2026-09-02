# Skills: visible per-provider refresh progress; boot script home guard

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-skills, scripts/skills-e2e-boot.sh

## Change

**Refresh all is now visibly sequential.** The panel no longer fires the
one-shot `refreshProviders` RPC (the host looped invisibly); it drives the
existing per-provider `refreshProvider` RPC one provider at a time and
tracks `refreshingId`. The row currently downloading swaps its Remove
button for a spinner + "Refreshing…" pill (`skills-provider-refreshing`)
until the next provider starts, so the active provider is always
identifiable; other rows keep their Remove buttons (disabled by `busy`).
The Refresh all button shows the position ("Refreshing 3/9…",
`providers.refreshProgress`). A failing provider shows its error on its own
row immediately (the host `markProviderError` writes the snapshot, the loop
pulls fresh state on failure since the error result carries none) and the
sequence continues; the summary banner at the end lists every failure
(`providers.refreshFailed`, same contract as the old host aggregate).
Spinner is hand-rolled CSS (`@keyframes spin` in the module; the theme
ships no spinner).

**Boot script home guard.** `scripts/skills-e2e-boot.sh` seeds its home
from scratch — it `cat >`-overwrites `settings.yaml` and
`storages/workspace.json`. Pointing it at a reused home therefore silently
destroyed that home's accumulated `dsh-next-skills` section (providers,
installed records, scopes) and workspace registry. The script now refuses
to boot when `$SCRATCH/home/settings.yaml` already exists unless
`SKILLS_E2E_OVERWRITE=1` is set. The persistent smoke home
(`~/.dsh-next-skills-smoke`) is recovered, not scratch: its skills section
was rebuilt from the surviving on-disk manifests (`.dsh-next-provider.json`
per installed skill), the seed records, and the recorded scope snapshot;
the `web` workspace row was re-registered in `workspace.json`. Backups:
`settings.yaml.bak-*`.

## Tests

- `tests/panel.spec.tsx` (+2): refresh-all issues one `refreshProvider` per
  provider in order; a gated RPC proves the active row shows the spinner
  pill with Remove hidden and the button shows `1/1`, then swaps back with
  the Done banner; a failing provider still completes the run and surfaces
  the failure summary.
- Package gate green (209 tests / 17 files, tsc, tsdown, i18n:check,
  docs:check pair re-recorded), mount smoke green, skills-full-verify 24/24
  on a fresh scratch. Live evidence: `test-results/skills/style-parity-live/13-refresh-in-progress.png`
  (button "Refreshing 3/9…", anthropics/skills row spinning, other rows'
  Remove disabled) and `14-refresh-done.png`.
