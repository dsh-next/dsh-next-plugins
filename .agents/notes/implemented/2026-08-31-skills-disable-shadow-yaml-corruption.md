# Skills: Disable corrupted SKILL.md for descriptions with newlines or ": "

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-skills

## Symptom

Clicking Disable on a custom skill appeared to do nothing: no error, the row
stayed enabled, and the workspace-scoped state never changed.

## Root cause

`buildShadowSkill` interpolated the raw description into the generated shadow
SKILL.md. Any description containing a newline or a `": "` sequence produced
invalid YAML ("a multiline key may not be an implicit key" / "bad indentation
of a mapping entry"). `parseSkillFile` then rejected the shadow, so:

- the scanner dropped it, `mergeInstalled` fell through to the enabled global
  copy, and the UI showed Disable again — the disable "did nothing";
- DSH core's filesystem provider dropped it too, so the skill was not even
  disabled for the model;
- `findSkill` could not see the broken shadow, so re-disabling wrote another
  broken file and Enable returned "skill not found".

Four shadows in the user's workspace were corrupted this way (two from
multi-line descriptions, two from descriptions containing ": ").

## Fix

`buildShadowSkill` serializes the description through `js-yaml` `dump`
(`lineWidth: 0`), which quotes/escapes whatever it is given. Because the
broken shadow is invisible to `findSkill`, re-issuing the disable overwrites
it with a valid one — the same RPC is the repair path.

## Tests

- `tests/frontmatter.spec.ts`: shadow round-trips a multi-line description and
  a `": "`-containing description (parse back equal input, flags intact).
- `tests/skills-service.spec.ts`: disable with a multi-line description yields
  a listed `enabled: false, shadow: true` row; a pre-corrupted shadow written
  in the old format is repaired by issuing the disable again.

## Live repair

The four corrupted shadows in `/Users/rokgrabnar/Projects/web/.agents/skills`
(e2e-test-skill, opentofu, code-review, advanced-evaluation) were rewritten by
re-issuing `setEnabled` against the fixed build; all four now parse and list
as disabled workspace shadows, and the Disable/Enable toggle round-trips in
the UI.
