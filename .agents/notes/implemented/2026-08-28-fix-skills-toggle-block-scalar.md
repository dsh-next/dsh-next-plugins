# Fix dsh-next-skills: toggle corrupted block-scalar descriptions

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-skills

## Bug

Unchecking (disabling) a skill whose SKILL.md frontmatter uses a YAML block
scalar for `description` (`description: |`) corrupted the file: the toggle
inserted `disable-model-invocation: true` immediately after the `description:`
line, breaking the block scalar. The provider then failed to parse the file and
the skill silently disappeared from the Installed list. Reproduced on the user's
`opentofu` skill (multi-line description), which vanished after a disable.

## Fix

`toggleModelInvocation` now appends `disable-model-invocation: true` at the END
of the frontmatter instead of inserting after `description`, which is always
valid YAML regardless of the description's scalar style. Repaired the corrupted
`opentofu` file (restored the block scalar, kept the disable flag in a valid
position).

## Tests

- Added a frontmatter regression test for a block-scalar description (suite now
  24 cases; 114 total).
- Strengthened the `dsh-next-skills` DOM marker to drive a real toggle + delete
  round-trip, and changed the seeded `e2e-test-skill` to use a block-scalar
  description so the smoke exercises this exact regression.
- Fixed smoke isolation: `scripts/e2e-mount.sh` now sets `DSH_AGENTS_HOME` to
  the scratch home so the smoke never reads (or mutates) the developer's real
  `~/.agents/skills`.

Verified: `pnpm typecheck`, `pnpm test` (114), and `bash scripts/e2e-mount.sh`
all green.
