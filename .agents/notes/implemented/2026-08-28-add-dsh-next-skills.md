# Add dsh-next-skills: manage agent skills (browse, install, enable/disable)

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-skills

## What

New plugin `@dsh-next/dsh-next-skills` adds a "DSH Next Skills" card under
Settings → Plugins with two tabs:

- **Installed** — enumerates skills from the DSH skill roots, each with an
  enable toggle and remove action, badged `global` or `workspace`.
- **Market** — searches a skills.sh-compatible registry, installs a skill
  globally or into a workspace, and manages manual repositories (`owner/repo`
  or GitHub URLs).

## Key decisions

- **Enable/disable is filesystem-authoritative.** Toggling writes the native
  `disable-model-invocation` SKILL.md frontmatter flag, which the DSH
  filesystem skill provider parses into `modelInvocable`. Disabling a global
  skill in one workspace drops a workspace shadow skill (the workspace root,
  rank 200, shadows the user root, rank 500); re-enabling removes the shadow.
  No `ctx.skills` runtime coupling; the host manages the roots directly.
- **Roots** mirror the DSH filesystem provider: workspace
  `<workspace>/.agents/skills` (+ `.dsh/skills`), global `~/.agents/skills`
  (+ `$DSH_HOME/skills`). See `src/core/scope.ts`.
- **Registry** is a skills.sh-compatible client behind a configurable
  `registryBaseUrl` (skills.sh itself is a Next.js SPA with no stable public
  REST endpoint; production points at a self-hosted `@mastra/skills-api`).
  Manual repos merge via `/skills/by-source/:owner/:repo`. Registry file paths
  are validated against traversal (`isSafeRelativePath`).

## Structure

`src/core/` (pure): `types`, `path`, `name`, `frontmatter` (parse + surgical
toggle + shadow), `config`, `scope`, `skill-list`, `registry`, `schema`,
`namespace`. `src/host/`: `fs-adapter`, `registry-client`, `skills-service`,
`rpc`. `src/client/`: `index`, `SkillsCard`, `workspaces`, `card.module.css`.

## Tests

113 vitest cases across 12 suites (pure core exhaustively; `skills-service`
behavior via an in-memory fs double; RPC envelope contract; registry-client
normalization; jsdom card render). Added a `dsh-next-skills` DOM marker to
`tests/e2e/mount.e2e.ts` (opens the card and asserts the Installed/Market tab
bar renders), and generalized the duplicate card-open helpers into
`openPluginCard`.

Gate: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm runtime-deps:check`,
and `pnpm docs:check` all green for the package; the real-mount smoke
(`bash scripts/e2e-mount.sh`) confirms the marker.
