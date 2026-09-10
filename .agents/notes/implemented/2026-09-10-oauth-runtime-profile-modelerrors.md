# Supply every profile field the runtime pi-ai adapter reads

- date: 2026-09-10
- status: implemented
- scope: packages/dsh-next-oauth-providers

## Symptom

The model selector showed `Grok failed to load: Cannot read properties of
undefined (reading 'get')` (and the same for ChatGPT) next to **Retry**, and
every chat request on a subscription route failed. Non-subscription providers
were unaffected.

## Root cause

`buildProfile()` hand-builds `ResolvedPiAiProviderProfile` values, because
`dsh-llm-pi-ai` does not export its own resolver. The plugin pinned its SDK
devDependencies at `0.1.3-alpha.2`, but the running DSH ships `0.1.5-rc.1`,
whose `PiAiAdapter.modelOf()` starts with
`profile.modelErrors.get(model)`. The builder never set `modelErrors`, so the
map was `undefined` and the read threw inside the SDK.

That one miss hit both symptoms: `buildModelCatalog` resolves every advertised
model, so the whole provider group failed as one; and
`prepareCall`/`streamWithSnapshot` run the same `modelOf`, so no request to a
subscription route could be prepared.

## Fix

- `src/host/profiles.ts` sets `modelErrors: new Map()`. The older SDK ignores
  the extra field, so the profile stays valid on `>= 0.1.3-alpha.2`.
- SDK devDependencies move to `0.1.5-rc.1` (plus
  `@deepseek-ai/dsh-launch-environment` and `@deepseek-ai/dsh-timeout`), so the
  repo types and tests see the same shape the runtime reads. `tsc` now reports
  the missing field as TS2741 instead of letting it reach the adapter.
  `pnpm-workspace.yaml` gains the matching `minimumReleaseAgeExclude` entries.
- `SubscriptionsService.profiles()` no longer lets one family poison the map:
  a profile that cannot be built is dropped from the answer, the route stays
  registered, and the log carries one warning per distinct failure (plus one
  recovery line). The picker then names that one provider instead of losing all
  four routes.

## Verification

- `tests/adapter-runtime.spec.ts` runs the real `PiAiAdapter` over real
  profiles and failed 14 of 15 cases with the reported TypeError before the
  fix; all pass after. This is the regression seam: the older SDK's adapter
  does not read `modelErrors`, so a spec on the pinned types alone would have
  stayed green.
- `tests/host-profile-isolation.spec.ts` covers the skip, the once-per-failure
  warning, and recovery.
- Gate: `pnpm typecheck && pnpm test && pnpm build && pnpm runtime-deps:check &&
  pnpm docs:check && pnpm i18n:check`, plus the mount smoke.

## Why CI did not catch it

`scripts/workflow-config.json` pinned the tested DSH CLI at `0.1.3-alpha.2`,
and `.github/workflows/ci.yml` installs exactly that version, so no lane ever
executed the `0.1.5` adapter. The pin now tracks `0.1.5-rc.1`; see
[the tested-target note](2026-09-10-tested-dsh-target-0.1.5-rc.1.md).

## Live evidence

Differential run against a real `dsh 0.1.5-rc.1` with the same scratch home,
the same settings row (`openai-codex`), and the same real ChatGPT grant; only
the installed tarball differed. Reading `POST /api/session/modelCatalog`:

- Buggy tarball (the one installed in the `web` profile):
  `failures: [{ id: "openai-codex-oauth", name: "ChatGPT", message: "Cannot read
  properties of undefined (reading 'get')" }]`, ChatGPT absent from `groups`.
- Fixed tarball: `groups` carries
  `{ id: "openai-codex-oauth", name: "ChatGPT", models: 8 }` and `failures: []`.

## Seam note

The e2e mount smoke cannot cover this path. Registering a subscription route
needs a stored OAuth grant at host boot, and the scratch home is created without
one; `hydrate()` runs once and later seeding does not reconnect a family. The
host-side real-adapter contract spec is therefore the regression lock for this
bug, and the mount smoke only proves the packaged plugin still mounts.
