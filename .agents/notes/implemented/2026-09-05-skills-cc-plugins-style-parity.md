# Skills: styling and interface naming aligned to the Claude Plugins page

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-skills

## Change

The Skills settings page had drifted from the Claude Plugins page it was
modeled on: underline tabs instead of pill tabs, compact 32px inputs on
`bg-layer-3` instead of cc-plugins' padded inputs on `bg-layer-2`, a red
danger/notice vocabulary where cc-plugins uses a neutral strong-danger one,
and a panel written in `React.createElement` while its sibling is TSX-JSX.
This change re-anchors every shared piece of the page on cc-plugins and
adopts its interface naming conventions.

## What changed

**CSS (`src/client/card.module.css`).** The shared-chrome block is now
byte-identical to `dsh-next-cc-plugins/src/client/card.module.css` on every
class the two pages share (page, tabs, inputs, selects, buttons, notices,
cards, filter row, toggle, grid, modal, option rows) and carries a header
comment requiring changes to land in both files together. Skills-specific
extensions (provider/project/custom chips, `updateChip`, show-more row,
wide modal + markdown body) live in a marked section. ~20 dead classes from
the old accordion design were deleted (`header`, `chevron`, `skill*`,
`titleRow`, `metaRow`, `status*`, `ghost.danger/.success`, ...). Notable
semantic shifts that follow cc-plugins: `danger` is the neutral
strong-emphasis button (not red), `noticeErr`/`errText` use
`label-primary` (not the error token), the modal is 440px, and the card no
longer hovers. The orange custom marker is one class (`customBadge`, was
`installedChip` — a name cc-plugins uses for a green pill).

**Panel (`src/client/SkillsPanel.tsx`).** Rewritten as TSX-JSX mirroring
`CcPanel` (the old `React.createElement` shape predated a TSX parser issue
that JSX never had). Card anatomy now matches cc-plugins exactly: name
button alone on the title line, badges column top-right (presence, project,
custom, and a new `update available` pill for workspace-scoped skills whose
Update button cannot show), provider spec chip bottom-left (cc's
marketplace chip slot), single `Add`/`Manage` button. Mutations now surface
the success banner (`result.warning ?? t('status.done')`) like cc-plugins.

**Interface naming (cc-plugins conventions).**

- RPC + service methods: `setScope` -> `setSkillScope` (mirrors
  `setPluginScope`), `remove` -> `uninstallSkill` (mirrors
  `uninstallPlugin`); `installSkill`/`updateSkill`/`addProvider`/
  `removeProvider`/`refreshProviders` already matched.
- Dictionary keys: `providers.sync*` -> the `sync.*` family with cc-plugins'
  compact values (`never`, `just now`, `{count}m ago`), new
  `providers.lastSynced` wrapper (mirrors `marketplaces.lastSynced`),
  `modal.remove/confirmRemove` -> `modal.uninstall/confirmUninstall`,
  `section.title` -> `nav`, `modal.save` -> "Save scope", scope radio
  labels adopted from cc-plugins ("Global (every workspace)" / "Selected
  workspaces"), dead keys dropped (`list.showing`, `error.loadDetail`,
  `detail.version/from/notInstalled`, `card.installed`), new keys
  `card.updateAvailable` and `status.done`. zh mirror keeps the established
  glossary (提供方/自建/卸载).
- Testids: `skills-scope-modal` -> `skills-modal`, `skills-remove(-confirm)`
  -> `skills-uninstall(-confirm)`, `skills-detail-open` -> `skills-detail`
  with the detail modal now `skills-skill-detail` (cc: `cc-detail` /
  `cc-plugin-detail`), `skills-manage` collapsed into a single
  `skills-add` (cc uses one testid for Add/Manage),
  `skills-provider-input` -> `skills-add-input`. Tab, grid, card, filter,
  and provider-row testids keep their names (no cc-plugins analog uses the
  same nouns).

**Prebuilt-element answer (for the record).** The harness exposes exactly
two reusable styling surfaces: the 13 `--dsw-alias-*` theme tokens (queried
via the client Theme inspect provider) and the declarative
`@deepseek-ai/dsh-client-ui-settings-plugins` kit (`PluginCard`/`CardForm`,
for namespace config cards in the built-in Plugins tab). There is no shared
tabs/buttons/dialogs component library for custom sections — cc-plugins
itself hand-rolls its CSS module on the tokens, which is why byte-mirroring
that module is the styling guide.

## Tests

- `tests/panel.spec.tsx` updated to the new testids/keys; the add-flow test
  now targets the deploy-helper card explicitly (the merged `skills-add`
  testid no longer discriminates catalog-only cards).
- Full package gate green: 207 tests / 17 files, `tsc`, `tsdown`,
  `pnpm i18n:check`, `pnpm docs:check` (pair re-recorded), and the
  real-mount smoke with the updated `dsh-next-skills` marker.
- `scripts/skills-full-verify.mjs`: 24/24 on a fresh boot (locator updates:
  `customBadge` chip class, `skills-modal`/`skills-uninstall*` testids,
  "No skills match the current filters.", `setSkillScope` RPC). The probe
  scripts (`skills-remove-repro.mjs`, `skills-remove-ab.mjs`,
  `skills-providers-verify.mjs`, `skills-screenshots.mjs`) were renamed
  alongside and re-run green. Screenshots: `test-results/skills/style-parity/`
  and `style-parity-live/`.
