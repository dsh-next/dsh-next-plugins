# cc-plugins: sequential Refresh all with per-marketplace progress

Date: 2026-09-03
Package: `@dsh-next/dsh-next-cc-plugins`
Kind: feature (UI parity with `dsh-next-skills`)

## What changed

Replicates the skills panel's Refresh-all interaction: the panel now knows
which marketplace is downloading at any moment instead of one opaque
batch RPC.

- Host `refreshMarketplace(id)` (`src/host/service.ts`): re-syncs one
  marketplace; every outcome except "not configured" answers with fresh
  `state` (a failed download keeps the cached snapshot answering, matching
  the batch loop's tolerance). Error strings reuse the
  `refreshing "<spec>" failed:` prefix `updatePlugin` already uses.
  Registered as the `refreshMarketplace` RPC (`src/host/rpc.ts`).
  `refreshMarketplaces` (batch) stays for API parity and tests.
- Client (`src/client/CcPanel.tsx`): `refreshAllSequential` drives the rows
  one RPC at a time; the active row's Remove swaps for a spinner +
  "Refreshing…" (`cc-marketplace-refreshing`), the button counts
  `Refreshing {done}/{total}…` (`cc-marketplace-refresh-all`), and each
  finished row's lastSync lands before the next starts. Failures collect
  into one summary (`marketplaces.refreshFailed`); full success summarizes
  `Refreshed {count} marketplace(s)`. Same structure as the skills panel's
  `refreshAllSequential`.
- CSS: `.refreshing`/`.spinner`/`@keyframes spin` copied from the skills
  stylesheet (same design tokens).
- Dictionaries: `marketplaces.refreshing`, `refreshProgress`,
  `refreshedAll`, `refreshFailed` (en + zh).

## Tests

- `tests/service.spec.ts`: `refreshMarketplace` success, unknown id,
  failed download (error prefix + state over cache), unparseable stored
  spec (hand-edited registry injection).
- `tests/rpc-contract.spec.ts`: single-refresh mutation envelope.
- `tests/panel.spec.tsx`: sequential jsdom coverage — in-flight spinner
  swap (active row loses Remove, sibling keeps it), progress label
  1/2 then 2/2, failure summary naming the marketplace, success summary;
  the generic message-path test moved from Refresh all to Remove.
- `tests/e2e/mount.e2e.ts`: the cc-plugins marker drives the real
  Refresh all and waits for the label to revert plus the summary message.

## Side fix (pre-existing, external commit 5710391)

Root `pnpm typecheck` and `pnpm build` were red on `dsh-next-skills` at
clean HEAD before this change:

- `src/core/schema.ts`: declaration emit tripped TS2742 (the exported
  schema's array/dict members inferred types referencing
  `@deepseek-ai/cosmokit` transitively). Fixed with the repo's
  established member casts to `Schemastery<...>` (same pattern as
  cc-plugins' Config).
- `tests/panel.spec.tsx` / `tests/skills-service.spec.ts`: a `: RpcFn`
  annotation that erased the `vi.fn` Mock type, and `.warning` access on
  the un-narrowed `MutationResult` union. Fixed test-side only.

These skills files also carry the user's concurrent in-flight "Update
all" WIP (SkillsPanel, dictionaries, new tests) — that work is the
user's own and was left untouched; the fixes above ride in the same
working tree until their commit.

## Validation

- `pnpm typecheck`, `pnpm test` (all packages; cc-plugins 380, skills
  216), `pnpm build`, `pnpm docs:check`, `pnpm i18n:check`,
  `bash scripts/e2e-mount.sh`.
