# Fix dsh-next-skills: disabled skills still appear in the / menu

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-skills

## Bug

The Installed tab made disabling a skill write `disable-model-invocation: true`
only. That key gates the model-facing catalog, but the human-visible `/` command
menu is served by the `skill.list` RPC, which filters candidates by
`isUserInvocable` alone. Because the disable never touched the `user-invocable`
key, a disabled skill stayed in the `/` menu even though it vanished from the
model catalog.

Verified against the DSH source: `dsh-host-apiproxy` `skill.list` does
`list(...).filter(isUserInvocable)`, while `dsh-tool-skill`'s model catalog uses
`filter(isModelInvocable)`. The two surfaces are independent.

## Fix

The plugin's single enabled/disabled switch now drives both surfaces:

- `toggleModelInvocation` was renamed to `toggleInvocation`. Disabling sets (or
  inserts) both `disable-model-invocation: true` and `user-invocable: false`;
  enabling removes both keys. Existing keys are replaced in place; missing keys
  are appended at the END of the frontmatter (preserving the earlier
  block-scalar safety) so the order is deterministic.
- `buildShadowSkill` now also emits `user-invocable: false`, so a workspace
  shadow over a global skill hides from `/` too. Re-enabling still deletes the
  shadow to restore the global skill.
- `InstalledSkill.enabled` type comment updated to state it gates both surfaces.

## Repaired stale files

Existing disabled skills had only `disable-model-invocation: true`, so they still
leaked into `/`. Ran `toggleInvocation(file, false)` over the user's
`~/.agents/skills` and added `user-invocable: false` to:

- `clickstack-otel-collector`
- `grill-me`
- `security-review`

(`opentofu` already carried `user-invocable: false` from the earlier repair.)

## Tests

- `frontmatter.spec.ts`: the toggle suite now asserts both flags set on disable,
  both removed on enable, single replacement when values are already present,
  no duplication when already disabled, block-scalar description preserved, and
  CRLF preserved.
- `skills-service.spec.ts`: the global setEnabled round-trip now asserts
  `userInvocable` flips false/true, and the workspace shadow test asserts the
  `user-invocable: false` line.
- Suite count 115.

## Verification

- `pnpm typecheck`, `pnpm test` (115), `pnpm build`, `pnpm docs:check`,
  `pnpm runtime-deps:check`, and `bash scripts/e2e-mount.sh` all green.
- Live browser (Playwright) confirmed on a restarted dev harness: opening a
  session and typing `/` no longer lists `clickstack-otel-collector`,
  `grill-me`, `opentofu`, or `security-review`, while enabled skills
  (`create-agentsmd`, `dsh-next-agent-coding`, `dsh-next-release`) remain.
