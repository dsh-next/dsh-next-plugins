# dsh-next-skills: removal confirmation popup and colored Enable/Disable action button

- date: 2026-08-29
- status: implemented
- scope: packages/dsh-next-skills

## What the user asked

Clicking Remove should open a popup confirmation (instead of the inline
two-step button swap), and the enable/disable checkbox should become a button
that reads Disable (red) while the skill is enabled and Enable (different
color) while it is off, styled like the other ghost action buttons. A first
implementation used a slider-style switch and was replaced by the labeled
button after user feedback.

## Changes

1. **Removal confirmation popup.** Remove now opens a real modal
   (scrim + `role="dialog"`) instead of swapping the row button to
   "Confirm remove?". Skill removal explains the `.trash` recoverability;
   provider removal got the same guard (it previously removed instantly) and
   explains that only the cache is deleted while installed skills stay.
   Cancel, clicking the scrim, and Escape all close it; only the dialog's
   Remove dispatches the RPC. The scrim is an explicit `rgba(0, 0, 0, 0.5)`
   backdrop (the theme's `bg-overlay` alias renders nearly transparent, which
   the user flagged; first cut was 0.8, tuned down to 0.5), and the live
   suite asserts the scrim alpha stays around 0.5.
2. **Colored Enable/Disable button.** The per-skill checkbox (and the
   interim slider switch) became a ghost action button in the row's
   right-aligned actions area: Update, Update all copies, Enable/Disable,
   Remove. While the skill is enabled it reads `Disable` with the danger
   style (red, `--dsw-alias-label-error`); while disabled it reads `Enable`
   with a success style (green, `--dsw-alias-state-success-primary`, new
   `.ghost.success` variant). Dispatch logic (`setEnabled`, workspace shadow
   semantics) is unchanged. The Configuration master switch remains a
   checkbox on purpose: it is a settings form control, not a row action.
3. **Disabled rows dim only their text.** The `skillDisabled` opacity moved
   from the whole row to the title and description, per user feedback: the
   badges and the Enable/Remove actions stay crisp on a disabled skill.
4. **Installed row layout reworked.** Per user feedback the buttons moved
   below the description, and the row now stacks: title line (name left,
   scope chip right — `⭐ Global` for the global scope per explicit user
   request for a star emoji, otherwise the owning workspace's title, with
   `· disabled` / `· shadow` markers), a provider chip under the title (or a
   orange `custom` chip (white text, literal `#f97316` background) when the
   skill was not provider-installed),
   the description, then the actions: Enable/Disable, Remove, Update, and
   Update all copies. Update is now always visible and disabled while the
   skill is current (previously hidden). The custom chip is white text on an
   orange background (`#f97316` — the theme ships no orange token, so the
   literal is used; white is the theme white with a `#fff` fallback).
5. **Theme token fix (the "white Disable" bug).** The danger styles used
   `--dsw-alias-label-error`, which the runtime theme never defines — an
   undefined `var()` made the color invalid and the button inherited plain
   white. Danger (and the error status text) now use
   `--dsw-alias-state-error-primary` (red-600), which is defined; the green
   success and amber warn tokens resolve the same way. Lesson: theme tokens
   must be verified against the running app (they apply on the app's wrapper
   element, not `<html>`), which the live verify script now asserts through
   computed colors and painted backgrounds.

## Tests and evidence

- Panel tests updated: the Disable button dispatches `setEnabled` (global and
  workspace-shadow cases), popup title + `.trash` hint asserted, Cancel closes
  without dispatching, provider removal requires the popup, and the disabled
  dimming class sits on the text block only (never on the row or actions);
  193 vitest cases across 14 suites green, package + repo typecheck, build,
  and the mount smoke (marker drives Disable -> Enable and the popup) green.
- Full live Playwright pass (`scripts/skills-full-verify.mjs`) 30/30 with no
  page errors, including the popup flows and the Disable/Enable label flip.
  Screenshots in `test-results/skills/` (02 shows the toggled-off row,
  08-remove-popup the dialog).
- Locator note for future work: the Settings shell itself renders a
  `role="dialog"`, so tests must scope popups with
  `getByRole('dialog', { name: 'Remove skill "..."?' })` — an unscoped
  `getByRole('dialog')` is a strict-mode violation.
