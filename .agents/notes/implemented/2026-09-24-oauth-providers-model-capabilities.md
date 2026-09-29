# OAuth provider rows can declare images and reasoning levels

- date: 2026-09-24
- status: implemented
- scope: packages/dsh-next-oauth-providers

## What changed

A customized model row in this plugin's settings carried only `id`, `name`,
`contextWindow`, and `maxTokens`. A row naming a model the pinned pi-ai catalog
does not ship was materialized with `input: ['text']` and `reasoning: false`, so
an image-capable or reasoning-capable hand-mapped model lost both capabilities
with no way to state them.

`ModelDraft` now carries the same two fields core's own `@deepseek-ai/dsh-llm-pi-ai`
profile accepts on a `models` entry:

```yaml
providers:
  xai:
    models:
      - id: custom-grok
        input: [text, image]
        reasoningEfforts:
          off: null
          low: low
          medium: medium
          high: high
```

- `input` — request modalities (`text`, `image`). Declared, it replaces the
  row's modalities for both a known catalog id and a hand-mapped one; omitted,
  the catalog's list stands for a known id and `['text']` for an unknown one.
- `reasoningEfforts` — level to wire spelling, or `false` for a non-reasoning
  model. Omitted keeps what the model already had (the catalog's `reasoning`
  for a known id, `false` for an unknown one).

The card's **Capacities** fold gained both controls: the stock input-type
checkboxes (the same fieldset geometry and `Checkbox` primitive the installed
Models section uses) and a reasoning picker with three modes — inherit, not a
reasoning model, or per-level editing.

## Semantics mirrored from core

`src/host/providers.ts` reimplements official `resolveModelReasoning`
(`@deepseek-ai/dsh-llm-pi-ai`, 0.1.7) rather than importing it — the module is
not exported:

- A declared dict translates to pi-ai's `thinkingLevelMap` with every level
  decided explicitly. Declared levels carry their wire value; undeclared levels
  are pinned to `null` (unsupported). Pinning matters because pi-ai's own
  defaulting is asymmetric: an absent key means supported for the five base
  levels but unsupported for `xhigh`/`max`.
- `off: null` stays **absent** from the map — pi-ai reads that as "supported,
  send nothing", which is the correct dispatch for not thinking. `off` with a
  value sends that value. A dict alone in `off` is rejected, exactly as core
  rejects it.
- Level order is `off, minimal, low, medium, high, xhigh, max`, copied from
  core's `THINKING_LEVELS` (confirmed in the core file before hardcoding) and
  exported from `src/core/settings.ts` as `THINKING_LEVELS`.
- `input: []` is read as "no answer" (core's `declaredInput`), so the empty
  array means the same as omitting the field rather than a model that accepts
  nothing.

Two deliberate divergences, both noted here because they are judgement calls:

1. **`reasoningEfforts: false` also clears the catalog's `thinkingLevelMap`** on
   the known-id path. Core spreads its patch over the base, so a `false` row
   there keeps whatever map the base had; the task's rule was explicit that
   `false` means `reasoning: false` with no map, and a stale map would keep
   naming levels the row no longer offers. The template-clone path had the same
   leak and was fixed the same way.
2. **An unknown level key is dropped by `normalizeModelDraft`** instead of
   riding into the map. The Cordis schema already refuses such a dict (its key
   union is the pi-ai ladder, which routes the whole `providers` dict to its
   empty default); normalization is the recovery path when the raw section is
   re-read, and a key the editor cannot render must not survive a round trip.

## Validation

Four new `ModelValidationKey`s report the shapes that pass the schema but cannot
resolve, in core's reporting order: `modelReasoningEmpty`, then
`modelReasoningWireEmpty` / `modelReasoningWireMissing` per declared level, then
`modelReasoningOffOnly`. The card shows them as `Model <n>: <message>` with
Apply disabled, and `applyModelCatalog` refuses the same shapes with a
`bad-request` `RpcError` naming provider and model, mirroring core's
`PiAiCatalogError`. Semantic mistakes survive `normalizeModelDraft` on purpose —
dropping them there would silently restore the catalog's capability, which is
the bug this change fixes.

## Verification

- 282 package tests in 29 files (was 245): every new branch in
  `providers.spec.ts` (both id paths, all five invalid shapes, the `off: null`
  exception, `input: []`), `chatgpt-capacity.spec.ts` (the Codex overlay id and
  fallback capacities), `core-boundaries.spec.ts` (normalization round trip,
  schema acceptance and refusal, the four validation keys), and
  `client-regressions.spec.tsx` (checkbox state from catalog defaults, the three
  reasoning modes, seeded ladder, block Apply and recovery, per-row buffers).
- `host-service.spec.ts` round-trips the declared fields through `setModels`
  into the settings scope and back out of `getState` and the resolved provider,
  which is the contract that would otherwise fail silently.
- Package `typecheck` and `build` are clean; `pnpm test` (every package plus the
  192 script tests), `docs:check`, `i18n:check`, and `runtime-deps:check` pass.
- `pnpm typecheck` and `pnpm build` fail in `dsh-next-checkpoints`,
  `dsh-next-notifier`, and `dsh-next-skills` with `TS2664 Invalid module name
  in augmentation, module '@deepseek-ai/dsh-client-ui-slots' cannot be found`.
  Those three resolve slots at `0.1.2-rc.1`; this package resolves
  `0.1.7-rc.1` and is unaffected. The failure is in packages this change does
  not touch, in a workspace whose `pnpm-lock.yaml` and `dsh-next-cc-plugins`
  manifest are being changed concurrently — reported, not fixed.
- No browser screenshot: this lane has no running shell to drive, and the
  mount smoke cannot build while those three packages are red. The new
  controls copy the installed Models section's own fieldset geometry and
  `Checkbox` primitive, and their behavior is covered under jsdom.
