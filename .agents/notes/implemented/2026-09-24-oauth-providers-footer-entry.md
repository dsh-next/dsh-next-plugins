# One add button in the Models footer for OAuth providers

- date: 2026-09-24
- status: implemented
- scope: packages/dsh-next-oauth-providers

## What changed

The `settings.models.footer` seat rendered an `<h3>` heading and an intro line
between the stock add button and its own dashed button, so one column showed
two add controls separated by a section header. The seat now renders no
heading and no intro: its dashed button is the whole visible content, directly
under the stock one.

- [AddSubscription.tsx](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/client/AddSubscription.tsx)
  drops the `title`/`intro` elements and the matching dictionary lookups. The
  `<section>` keeps `data-testid="dsh-next-oauth-providers"` and its
  `aria-label` from `a11y.section`, so the landmark survives for assistive
  technology.
- The dictionaries lose the now-unused `title` and `intro` keys and rename the
  button: `add` is `Add OAuth model provider` in English and
  `添加 OAuth 模型提供商` in Chinese.
- [footer.module.css](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/client/footer.module.css)
  drops the stock `title` rule this seat no longer renders; the file header
  records that deviation from the copied ModelsSection chrome.
- [client-add.spec.tsx](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/tests/client-add.spec.tsx)
  asserts the seat's text is exactly the new label and that it contains no
  heading, which is the regression guard for the removed copy.
  [client-plugin.spec.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/tests/client-plugin.spec.ts)
  now probes the locale contract through `add`, since `title` is gone.
- The README pair follows the new copy and the pairing record was re-recorded.
  The unreleased changeset entry (`quiet-pandas-clap`) described this same seat
  and was reworded in place rather than duplicated.

## Facts worth keeping

- The layer between the stock page and the seat adds no spacing of its own: the
  stock `ModelsSection` column gap of 12px is the whole distance between the
  two dashed buttons, and the stock `addButton` geometry matches the seat's
  (`flex: 1 1 0`, 44px, 16px radius), so the two read as a pair.
- Copy deviations from the request: `Oauth` is spelled `OAuth`, and Title Case
  became the shell's sentence case (`Add model provider` is the neighbouring
  stock label on DSH `0.1.7-rc.1`). The shell client bundles use no `OAuth`
  string, so the term is this plugin's own, while the removed heading's word
  ("Subscriptions") still lives in the remaining copy, the a11y label, and the
  package description.

## Evidence

- Runtime, DSH `0.1.7-rc.1`, dev profile: the seat measures 564x44 at the same
  x and width as the stock button, 12px below it, in both themes; the seat's
  own text is exactly `Add OAuth model provider` and it renders zero headings.
- `pnpm --filter @dsh-next/dsh-next-oauth-providers test`: 228 passed.
- `mise run e2e -- oauth-providers` and `mise run e2e -- smoke`: passed,
  including the `dsh-next-oauth-providers` DOM marker.
- `pnpm i18n:check`, `pnpm docs:check`, `pnpm runtime-deps:check`, `pnpm build`:
  passed. The full `pnpm test` run hit one 30s timeout in
  `packages/dsh-next-git/tests/repository-commands.spec.ts` (LFS/filter case);
  that spec passes in isolation and is unrelated to this change.

## Known gap

This package still ships no `media/` screenshots even though it is a UI
plugin ([docs/AGENTS.md](/Users/rokgrabnar/Projects/dsh-next-plugins/docs/AGENTS.md)
"Package READMEs" -> Screenshots). The verification screenshots for this change
were taken from the dev runtime and kept as local artifacts only.
