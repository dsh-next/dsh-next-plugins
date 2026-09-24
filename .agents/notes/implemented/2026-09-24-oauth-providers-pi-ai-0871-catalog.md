# ChatGPT OAuth models follow the plugin's own pi-ai pin

- date: 2026-09-24
- status: implemented
- scope: packages/dsh-next-oauth-providers

## Symptom

The ChatGPT subscription row (native provider `openai-codex`, alias
`openai-codex-oauth`) did not offer `gpt-6-sol` or `gpt-6-luna`, even though the
DSH runtime's own pi-ai had moved to 0.87.1. The `dsh-next-git` config in the
`web` profile already referenced `draftingModel: gpt-6-luna`, so that row named a
model the plugin could not expose.

## Root cause

The plugin, not DSH core, owns the catalog it shows. `@earendil-works/pi-ai` is a
runtime dependency pinned exactly at `0.85.1`
([package.json:45](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/package.json));
`nativeFactory('openai-codex')` builds its provider from that copy's
`openaiCodexProvider()`, and `withChatGptOauthCapacities` maps the catalog
one-to-one, so the shipped model list *is* that version's catalog.

Nothing else on the resolution path can override it. The `web` profile mounts the
plugin as
`link:/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers`,
so Node resolves the plugin's bare imports from the checkout's realpath, where
`node_modules/@earendil-works/pi-ai` is the pnpm store copy at `0.85.1` and the
DSH plugin loader imports host bundles with a plain `import()` and no alias
layer. Core's copy (global install and `~/.dsh/profiles/node_modules`, both
`0.87.1`) never appears in that chain. The core adapter
`@deepseek-ai/dsh-llm-pi-ai` is not a catalog source either: it exports only its
own surface (`Config, PiAiAdapter, apply, inject, name, recordKeyFor,
supportedProtocols`) and imports pi-ai internally, so the plugin must import the
provider factories itself — which is also why the repo's runtime-dependency
guardrail requires pi-ai in `dependencies` rather than `peerDependencies`.

A stored `models` list was ruled out as a second gate: the profile's user-layer
config carries only `displayName`, so `applyModelCatalog` returns the live
catalog unchanged.

## Fix

- Pin bumped to `0.87.1` plus `pnpm install`. The lockfile keeps a `0.85.1`
  entry that belongs to the dev-only `@deepseek-ai/dsh-llm-pi-ai@0.1.5-rc.1`,
  whose own range is `^0.85.1`.
- `CHATGPT_OAUTH_CAPACITIES` resynced: dropped the retired `gpt-5.4` and
  `gpt-5.4-mini`, added `gpt-6-sol` and `gpt-6-luna`. Two tests now enforce the
  sync in both directions (every shipped id has an entry; no entry survives an id
  pi-ai drops), so a future bump cannot leave the map stale.
- README pair updated for the new default-size sentence, pairing record
  re-recorded with `pnpm docs:write-pair`.
- One documented boundary cast in
  [profiles.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/host/profiles.ts):
  the adapter types `piProvider` against its own `^0.85.1`, so the plugin's
  `0.87.1` `Provider` is a nominally different type. 0.87.1 only widens a model's
  optional `compat` union with `MistralConversationsCompat`, which none of the
  four wrapped providers emits, and the runtime adapter resolves 0.87.1 anyway
  (all of its `.lazy` api subpaths exist there). Deliberately not a workspace
  `pnpm.overrides` entry: forcing a vendor-unsupported range across the whole
  install to satisfy typing would hide the skew instead of stating it.

## Verification

- Resolution probe from the package root (`import.meta.resolve` plus
  `openaiCodexProvider().getModels()`): pi-ai `0.87.1`, catalog
  `gpt-5.3-codex-spark, gpt-5.5, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-6-astra, gpt-6-luna, gpt-6-sol`.
  The same probe before the fix resolved `0.85.1` and missed both `gpt-6-*` ids.
- Catalog diff 0.85.1 -> 0.87.1 for the wrapped providers: `openai-codex` swaps
  `gpt-5.4`/`gpt-5.4-mini` for `gpt-6-luna`/`gpt-6-sol`; `xai` adds `grok-4.7`;
  `anthropic` adds `claude-opus-5-5`; `kimi-coding` unchanged.
- `pnpm typecheck && pnpm test && pnpm build && pnpm docs:check && pnpm i18n:check && pnpm runtime-deps:check`
  exits 0; oauth-providers runs 241 tests in 29 files.
- `bash scripts/e2e-mount.sh`: the `oauth-providers` suite passes. The first run
  reported 6 of 7 suites green with `cc-plugins` failing on a 5s timing assertion
  while its button read `Refreshing 2/2…`; an isolated re-run of that suite
  passed in 10.4s, so it is an unrelated flake, not this change.

## Follow-up

- Three worktrees (`.worktrees/new-connectors-plugin`,
  `.worktrees/create-squads-plugin`, `.worktrees/new-squads-plugin`) still pin
  `0.85.1` and will reintroduce the stale catalog when they merge.
- The durable upstream fix is a DSH release widening the adapter's `^0.85.1`;
  until then every plugin that imports pi-ai directly owns this decision.
