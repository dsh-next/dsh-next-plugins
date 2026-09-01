# cc-plugins e2e parity coverage: dependencies, user_config, reference rewrite

- date: 2026-09-03
- status: implemented
- scope: tests/e2e, packages/dsh-next-cc-plugins (fixture only)

## What

The mount-smoke lane now exercises the three newest cc-plugins bridges
end to end against a real DSH shell, asserted on the scratch home's real
filesystem (the Playwright process receives DSH_HOME/DSH_AGENTS_HOME
from scripts/e2e-mount.sh):

- `tests/e2e/fixtures/tiny-marketplace` gained `parity-tools` (declares
  `dependencies: ["dep-provider"]`, ships a skill referencing
  `../../references/guide.md`, an MCP server env on
  `${user_config.parity_token}`) and `dep-provider` (skill-only target).
- The cc-plugins marker seeds `cc-plugins/user-config.json` before
  install, installs parity-tools through the scope modal, then asserts:
  the dependency card flips to Manage on its own and the message reports
  `auto-installed dependency "dep-provider"`; the installed skill copy
  contains the rewritten absolute path (and no `../../references`);
  `cordis.patch.yml` carries the expanded token (and no literal
  template); both plugins uninstall independently afterwards.

## Coverage layering (why not "all edge cases" in e2e)

The completeness contract places exhaustive edge/error branches in the
pure core suites, service integration, RPC contract, and jsdom panel
specs; the e2e lane proves real-shell integration. Deliberately NOT in
e2e:

- bin/PATH for hooks — needs runtime.hooks plus a live tool call (an
  agent turn); covered by hook-runner.spec (hookEnv pure composition).
- The Workspaces radio path — the workspace registry persists in a
  domain database (not a seedable file), so the scratch home cannot
  register one without driving the workspace UI; covered by panel.spec
  (radio flows, checklist, re-scope dispatch, missing-path rows) and
  service.spec (multi-root install, re-scope moves).
- Mirror reconcile across boot, Update-in-UI — service/spec covered;
  e2e cost outweighs value for this lane.

## Verification

`bash scripts/e2e-mount.sh` green with the extended marker (8.3s).
