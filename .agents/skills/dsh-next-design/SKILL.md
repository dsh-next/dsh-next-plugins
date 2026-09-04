---
name: dsh-next-design
description: Design and restyle dsh-next plugin browser UI so it reads as native to the DeepSeek Harness web client. Use when building or changing client-side UI in any packages/dsh-next-* (panels, cards, modals, tabs, buttons, forms, empty states), when reviewing a UI change for visual consistency, or when extracting a new shared chrome pattern.
---

# dsh-next design

Approach this as the design lead for work that lives inside someone else's
house: every dsh-next plugin renders inside the DeepSeek Harness web client's
settings shell, next to pages DSH designed with the same discipline an
outside studio would. The client has already rejected everything that reads
as bolted-on next to the harness's own pages. Your job is not to be
distinctive — it is to be indistinguishable from the platform while being
unmistakably deliberate: every token, spacing value, and button state a
choice, never a default inherited from the last panel that shipped.

## Ground every design in the harness shell

Identify the DSH-owned page your UI will sit beside before drawing anything,
and treat that page's DOM and CSS as the brief. Settings sections answer to
the shell's own Plugins settings page (`PluginsSettingsSection` in
`@deepseek-ai/dsh-client-ui-settings-plugins`): a title, a one-line intro,
and an underline tab strip inside a 760px reading column. Plugin cards answer
to its PluginCard. When the shell has a precedent for the element you are
drawing, copy its structure and tokens — the harness page IS the spec. Where
it has none, derive from the rules below, never from taste alone.

Authoritative references (in precedence order):

1. The shell's own rendered pages and bundled CSS modules (read them in the
   installed checkout under `node_modules/@deepseek-ai/dsh/node_modules/`).
2. Upstream `docs/web-styling.md` — the style reference; component rules,
   elevation model, border weights, dark-mode ownership.
3. Upstream `packages/client/ui-theme` — the `--dsw-*` token sheets, the sole
   color authority; values absent from the system are deliberately not
   appended, so the nearest semantic token wins.
4. Upstream `packages/client/AGENTS.md` and `packages/client/ui-primitives` —
   the stack rules and the shared atom library.

Local law for this repo: the Skills and Claude Plugins panels share one
chrome block kept byte-identical between their `card.module.css` files (each
file's header comment names the mirror). A change to the chrome is a change
to both, in the same commit. The `--dsw-*` custom properties are injected by
the host document, so any CSS we ship consumes them — they are the only
colors we may name.

## Design principles

- **Tokens only.** No literal colors, no rgba scrims, no `#hex`. No
  fallback-masking either: `var(--dsw-alias-state-warning-primary, #b45309)`
  hides a typo behind a plausible color — if the fallback would render, the
  name is wrong. Verify every token name against the installed theme sheets,
  never memory.
- **Type carries hierarchy through size pairs.** Font sizes are px always
  paired with a line height: 18/24 page title, 15/1.4 card and modal titles,
  14/22 primary buttons, 13/20 body, controls, tabs, and intros, 12/18 hints
  and captions. Weights: 400, 500, 600 — nothing else.
- **Structure is information.** Badges, chips, and rails encode state the
  user can act on; the sub-row rail indents nested controls; the tab
  underline marks position. If removing one loses nothing, remove it.
- **Borders have weights that mean things.** Neutral flat borders and
  separators draw at 0.5px (`border-l2`/`border-l4`); state-colored and
  dashed borders keep 1px. Elevated surfaces (modals) take `border: 0` and
  an elevation shadow (`--dsw-elevation-prominent`), whose first layer is the
  0.5px hairline stroke — never pair an alias border with an elevation
  shadow.
- **One control grammar.** Monochrome primary (`button-primary-fill` +
  `label-primary-foreground`, hover `button-primary-hover`), quiet ghost
  (`label-secondary` on `border-l2`, hover `interactive-bg-hover`), and the
  destructive pair: a neutral ghost first step, then an outline danger
  (`label-error` stroke + text, hover `interactive-bg-hover-danger`).
  Warnings tint text (`state-warn-label`), never fill buttons. Disabled is
  opacity 0.4. Focus draws a 2px `state-business-primary` ring.
- **States ride state tokens.** `label-error`, `state-warn-primary`,
  `state-success-primary` — never raw red, orange, or green. Status colors
  apply to text and strokes; fills carry a constant near-black label
  (`--dsw-static-neutral-bluish-1000`) so they read on both themes.
- **Dark mode belongs to the token layer.** Zero theme selectors and zero
  `prefers-color-scheme` in component CSS. If dark mode looks wrong, the fix
  is a token name, not a `body[data-ds-dark-theme]` rule.
- **Motion is functional and minimal.** Transitions only on
  opacity/transform/background-color/shadow, short (0.16s); the one animated
  element is the refresh spinner. Respect reduced motion; no decorative
  animation in settings surfaces.
- **Copy the shell's geometry when copying a shell pattern.** The shell
  itself spaces on a 4px grid but keeps a few 10px grid gaps and 34px field
  heights; when you copy a shell element, copy its values exactly — do not
  "correct" them.

Avoid these tells — they read as generated, and review rejects them:

- A hardcoded hex or rgba sitting next to an existing alias.
- Two sibling panels with different button grammars or different filter-row
  behavior.
- An un-paired font size, or a radius inventory wider than the chrome's
  (4/8/10/12/999).
- Theme selectors, `prefers-color-scheme`, or inline style objects encoding
  theme or state branches (JS may only pass component-local custom
  properties).
- Dead classes surviving a refactor; a "shared" block that drifted from its
  mirror.
- A new user-facing string written in TSX while a dictionary key with the
  same meaning exists in the package namespace.

## Process: match the shell, plan, review against the tells, build, verify

1. **Match.** Open the DSH page precedent for the surface and quote its
   actual CSS values into your plan (the installed checkout's `lib/client.js`
   files inline the original CSS-module sources, unminified). The shell's
   words always win: where its page conflicts with habit or with this skill's
   defaults, copy the shell.
2. **Plan.** Write a five-line plan before CSS: surfaces, token set,
   spacing/geometry values, control grammar, dictionary keys added. Because
   the token system is inherited, this is a checklist, not a design brief.
3. **Review the plan against the tells above**; revise anything that reads as
   a default carried over from the previous panel.
4. **Build.** CSS Modules + `clsx` (no Tailwind, no component library, no
   inline style objects). Add the en key and the zh mirror in the same change
   (`src/client/dictionaries/`). Keep every `data-testid` stable — tests and
   e2e markers drive them. Shared-chrome edits land in both mirrored files at
   once.
5. **Verify.** `pnpm typecheck && pnpm test && pnpm i18n:check`, then the
   real-mount smoke (`mise run e2e`) whose DOM markers drive the actual UI,
   then look at it: `mise run dev <slug>` boots a real shell — check light
   AND dark, and confirm focus rings and hover states with the keyboard.
   Visual claims need runtime evidence (screenshots) per the repo rules.

Deviations from the harness look (a missing alias, a scrim stronger than
`bg-mask-1`) are recorded in the change's Agent Note with the reason — the
same deviation-table discipline the upstream styling system demands.

## Restraint and self-critique

The shell owns the personality; the panel owns the discipline. Brand and
accent color appear only where the tokens put them — the primary action, the
focus ring, state labels. There is no panel-level accent to invent.

- Quality floor, unannounced: keyboard focus visible everywhere, reduced
  motion respected, dark mode correct by construction (tokens), empty states
  that direct the next action instead of mourning emptiness.
- Critique against screenshots, not memory — a picture is worth 1000 tokens.
- Before finishing, remove one accessory: the badge, border, or hint that
  served nothing.

## Copy and locale

Words are design content, not decoration. Name things in user language — a
user enables skills in workspaces, they do not configure scope maps.

- Active voice; actions keep one name through the whole flow: "Add" produces
  the "Added" banner; "Remove" never turns into "deleted" halfway through.
- Errors direct, never apologize, never vague: what failed and what to do
  next, styled with the error state — a gray label-primary error line is a
  defect. Statuses that only report ("Done", "Working…") stay muted.
- Empty states are invitations: what this list is and what to do to fill it.
- Every user-visible string lives in the package dictionaries (`en.ts` key
  source, `zh.ts` mirror, `pnpm i18n:check` enforces parity). Strings that
  surface in-page but originate host-side — RPC failure messages above all —
  get keys too: a hardcoded `'request failed'` fallback is a defect, not
  pragmatism.
- Plain verbs, sentence case, no filler, no emoji in source or UI copy.

Copy-paste scaffolds for the standard page (scaffold, tab strip, buttons,
field, modal) live in `snippets.md` beside this file.
