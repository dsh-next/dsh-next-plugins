# cc-plugins: explicit inherit marker fixes Models tab revert

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-cc-plugins

Live use found a revert bug: choosing "Inherit session model" on an alias
the composition config maps (the user's `cordis.patch.yml` baseline maps
haiku/sonnet/opus) saved nothing for that alias, so the baseline
re-asserted itself and the picker snapped back to the previous model.

Fix: overrides are now `Record<string, string | null>` where `null` is the
explicit inherit marker that suppresses a config-baseline value for the
alias. `sanitizeModelMap` accepts nulls (blank strings still drop); the
service's effective-map merge deletes baseline entries under null markers
(`configModelMap` strips null config values — an empty yaml value means "no
mapping"); `CcState` gained `agentModelOverrides` (the saved file verbatim)
so the panel renders markers correctly and never loses them on later
saves. The panel's save is now a delta over the saved overrides — only
drafted aliases change, other entries persist verbatim — and choosing
inherit on an alias without a baseline simply drops the entry (inherit is
already the default). The baseline chip hides while a marker suppresses
it, and the hint states that inherit overrides a config mapping.

## Verification

237 tests across 14 suites (was 235): a panel regression test proving the
exact revert scenario (select inherit on a config-mapped alias saves
`{ alias: null }`, and a round-tripped marker renders inherit with the
baseline chip hidden), service tests for marker suppression (effective map
empties, agent rows re-resolve to inheritance, managed rows rewrite) and
null passthrough in payload sanitization, plus the RPC envelope pinning
`agentModelOverrides`.
