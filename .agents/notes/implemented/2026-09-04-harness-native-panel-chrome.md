# Harness-native panel chrome and the dsh-next-design skill

- date: 2026-09-04
- status: implemented
- scope: packages/dsh-next-skills, packages/dsh-next-cc-plugins, packages/dsh-next-notifier, .agents/skills/dsh-next-design

## What changed

All three plugins' browser UI now follows the DeepSeek Harness design system
deliberately instead of incidentally, and the knowledge is codified in a new
repo skill, `dsh-next-design` (`.agents/skills/dsh-next-design/SKILL.md` +
`snippets.md`), modeled structurally on anthropics' frontend-design skill.

- **Page scaffold.** The Skills and Claude Plugins settings sections draw the
  shell's Plugins-page pattern: an 18px/600 title, a 13px tertiary intro, and
  the underline tab strip (13px labels on a 0.5px rule, 2px active underline,
  `role=tablist` with roving tabindex and Arrow/Home/End keyboard support),
  all inside the shell's 760px reading column. Both panels previously
  rendered bordered pill tabs with no heading.
- **Buttons.** One grammar across panels, all tokens: monochrome primary
  (`button-primary-fill`), quiet ghost with `interactive-bg-hover`, the
  destructive pair (ghost step, then `label-error` outline with
  `interactive-bg-hover-danger`), warn-tinted update actions
  (`state-warn-label` text, never a fill). Replaced the hardcoded
  `#f97316`/`#dc2626` fills and the rgba modal scrim (`bg-mask-1`) and
  hardcoded modal shadow (`elevation-prominent`).
- **Consistency fixes from the audit.** Error text now uses
  `label-error` everywhere (was label-primary on the pages); cc's
  `state-warning-primary` token typo (masked by a fallback) corrected to
  `state-warn-primary`; six dead cc CSS classes removed; the filter-row
  wrap divergence resolved in favor of wrapping (now in the shared block);
  checkbox/disabled values unified (16px, opacity 0.4 — the shell's value);
  fields aligned to the shell recipe (0.5px `border-l4` on `bg-layer-3`,
  34px, brand focus border) across all three plugins; the notifier swaps its
  `▾` text glyph for the shell's `IconChevronDownOutline14` (first use of the
  `dsh-client-ui-primitives` module-table entry in this repo, already listed
  in `shared/tsdown.client.ts` `PLATFORM_MODULES`).
- **Localization.** The last bypassing strings now ride the dictionaries:
  cc's `'request failed'`/`'done'`/`'refresh failed'` fallbacks, skills'
  `'refresh failed'`, and transport errors in the cc and notifier client
  entries (`rpc.failed` key, matching skills' existing pattern).
- **Skill.** `dsh-next-design` distills the harness's own guidance
  (upstream `docs/web-styling.md`, the `ui-theme` token sheets, the shell's
  actual page CSS) into the repo's working rulebook: grounding in the shell
  page precedent, token/typography/border/state principles, an "avoid these
  tells" list drawn from this repo's real drift, a match-plan-review-build-
  verify process, restraint rules, and copy/locale rules, with copy-paste
  scaffolds in `snippets.md`. `docs/plugins.md` links it under "Client UI
  conventions".

## Decisions

- Tab taxonomies were kept (Skills: Skills/Providers; Claude Plugins:
  Plugins/Marketplaces/Models) — they already split configuration from
  inventory with accurate names; the work was the chrome, not renames.
- The notifier stays an accordion card (it lives in `settings.plugin.item`,
  not a section slot), so it gets the header pattern's values (15px title +
  tagline it already had) and the shared field/button discipline, not a
  page-level scaffold.
- The shell's own values win over the 4px grid ideal where the shell itself
  uses 10px gaps; the skill says so to prevent churn.
- The shared chrome stays copy-paste with byte-identical blocks (comments
  name the mirror); promoting it to a shared module is a deliberate future
  step, not this change.

## Verification

`pnpm typecheck` (4 projects), `pnpm test` (702 tests: skills 246, cc 383,
notifier 73 — 8 new: scaffold, roving tablist, localized fallbacks x2, and
the notifier card header), `pnpm i18n:check`, `pnpm docs:check`,
`pnpm runtime-deps:check`, `pnpm build`, and `mise run e2e` (mount smoke with
new heading assertions) all green.
