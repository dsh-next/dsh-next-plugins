# Skills: removed skills stayed visible in new chat sessions

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-skills

## Symptom

After removing an installed skill through the Skills panel, new chat sessions
in the same browser page still offered the removed skill in the composer's
slash menu. A full browser reload cleared it. Measured on the live smoke
server: the skill stayed listed across four "New Session" clicks spanning 40
seconds, then disappeared after a reload.

## Root cause (two independent layers, only one was broken)

- Host: the core `dsh-skill-filesystem` provider watches the skill roots
  (chokidar, depth 1) and calls `control.invalidate()` on changes; the core
  `SkillRegistry` bumps its revision and re-collects. Verified fresh within
  about 5 seconds of a removal by driving an independent browser context.
- Client: `dsh-client-ui-skill` fetches `skill.list` once per session id and
  caches the promise in a per-page Map. Its cache invalidates only on
  `agent-preset/selected` or `connection/reset`. "New Session" reuses the
  lazily created session, so every later chat in the same page hit the stale
  cached fetch. Still unfixed upstream as of `dsh-client-ui-skill`
  0.1.2-alpha.2 (no `skills/change` subscription).

## Fix

`src/client/index.ts` builds a `notifyInstalledChanged` callback that emits
`connection/reset` on the client context — the same signal the client runtime
emits on (re)connect, which every caching store already treats as "refetch
now" (skill source, commands, presets, models, settings, plugin inventory;
all background refetches, nothing destructive). `SkillsPanel.mutate` calls it
after a successful `installSkill`, `remove`, `updateSkill`, `updateAllCopies`,
or `setEnabled`; failures and provider-only mutations do not notify.

## Side fix: the "Global only" workspace option was unreachable

Exposing a workspace in the verify environment revealed a pre-existing panel
bug: `selectedWorkspace` treated `workspacePath === ''` as "unset" and fell
back to the first workspace, so selecting "Global only" kept the workspace
scope and every toggle/remove on a global skill wrote a workspace shadow
instead. `workspacePath` is now `string | null`: `null` means untouched
(default to the first workspace), `''` means explicit Global only.

## Test-environment work

- `scripts/skills-e2e-boot.sh` seeds one workspace ("Alpha") through the
  durable workspace registry JSON (`$DSH_HOME/storages/workspace.json`) so
  chat flows work on a fresh scratch. Two gotchas: the seeded `path` must be
  the canon realpath form (`/tmp` is a symlink to `/private/tmp` on macOS; a
  non-canon path silently fails session-cwd resolution), and the default
  model must resolve (`deepseek-official`), otherwise the composer stays
  disabled with "This model is unavailable".
- In the empty state the composer doubles as the workspace menu trigger;
  real clicks on the menu items do not land, keyboard ArrowDown + Enter does.
- `scripts/skills-full-verify.mjs`: the Installed remove check now opens a
  new session, types "/" and asserts the composer menu no longer lists the
  removed skill (screenshot `09b-composer-after-remove`); the Skills section
  pins "Global only" so the Installed-tab flows keep global semantics.
- `scripts/skills-remove-ab.mjs`: live A/B probe — after a removal, both a
  fresh browser context and a "New Session" click in the stale page must
  drop the skill from the "/" menu.

## Validation

- `tests/panel.spec.tsx`: notify fires once on successful remove and toggle,
  never on a failed remove, never for provider removal; "Global only" sends
  `scope: 'global'` while the untouched default still scopes to the first
  workspace.
- `scripts/skills-remove-ab.mjs`: validated twice against the smoke server —
  before the fix the new-session click kept the removed skill; after, both
  surfaces drop it immediately.
- Full `skills-full-verify.mjs` pass on a fresh boot (re-run after the
  GitHub API rate-limit window).
