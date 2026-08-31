# Skills: Add modal replaces the Install-into dropdown on Search

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-skills

## Change

The Search tab's toolbar no longer carries an "Install into: <target>"
dropdown, and row buttons read "Add" instead of "Install". Clicking Add opens
a modal that lists every install target as a checkbox row: "⭐ Global" plus
one row per known workspace. Targets that already hold the skill render
checked, disabled, and tagged with a green "added" badge; the confirm button
is disabled until at least one unlocked target is checked and reads
"Add to N targets" for N > 1. Confirming installs sequentially into every
checked target through the existing `installSkill` RPC (one call per target,
no host contract change) and emits the installed-catalog notification
(see 2026-08-31-skills-remove-chat-cache-invalidation).

Rationale: destination selection moved into the moment of action, multi-target
installs (global + several workspaces) need one flow instead of repeated
installs, and the modal shows where the skill already lives.

## Files

- `src/client/SkillsPanel.tsx`: removed `installTarget`/`targetHas`; added
  `addTarget`/`addSelection` state, `addSkillDialog`, `confirmAddSkill`
  (per-target installs, partial-failure warning, all-failed error).
- `src/client/card.module.css`: `.optionList`, `.optionRow`, `.optionLabel`,
  `.optionLocked`, `.addedBadge`.
- `tests/panel.spec.tsx`: Add modal opens with global + workspace checkboxes;
  confirm dispatches one `installSkill` per checked target; locked targets
  are pre-checked and disabled; the old dropdown is gone.
- `scripts/skills-full-verify.mjs`: Search render check asserts the dropdown
  is absent and Add buttons exist; the install checks drive the modal
  (screenshot `06a-add-modal`).

## Validation

- Package: 182 tests pass (13 files), `tsc --noEmit` clean, tsdown build ok.
- Full `skills-full-verify.mjs` on a fresh boot: 30/30 checks, no page errors.
