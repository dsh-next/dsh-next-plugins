# Reusable e2e workspace seeding and the Workspaces radio path end to end

- date: 2026-09-03
- status: implemented
- scope: scripts, tests/e2e, .agents/skills/dsh-next-local-testing

## What

Supersedes the limitation recorded in
2026-09-03-cc-plugins-e2e-parity-coverage.md ("the workspace registry
persists in a database, not a seedable file"). The registry is
`$DSH_HOME/storages/workspace.json` — plain JSON (`unit`/`global`/
`tables.workspaces`, keyed by workspace id, records carrying
`path`/`title`/`sessionIds`).

- **`scripts/e2e-seed-workspaces.sh <DSH_HOME> <dir>...`** (new, the
  reusable process): registers directories as workspaces. Idempotent —
  merges by canonical (realpath) directory, never modifies or removes
  existing registrations, so it is safe to run on real and dev-profile
  homes too. Deterministic uuid-shaped ids (sha1 over the canonical
  path, v5-style nibbles) keep repeated runs stable. Titles default to
  the directory basename. Canonicalization matters: the workspace
  plugin stores realpaths, and on macOS a `/tmp` scratch dir is really
  `/private/tmp/...`, so callers must use the canonical path everywhere.
- **`scripts/e2e-mount.sh`** creates two scratch workspaces
  (`$SCRATCH/workspace-a`, `$SCRATCH/workspace-b`), seeds them through
  the script, and exports their canonical paths as
  `DSH_E2E_WORKSPACE_A` / `DSH_E2E_WORKSPACE_B` to every plugin marker —
  no machine-specific paths anywhere in the specs (the user's
  requirement: other developers clone the repo elsewhere).
- **cc-plugins marker**: the Workspaces radio path now runs end to end
  against the real registry — workspaces radio reveals the checklist
  with both preseeded rows, demo-tools installs into workspace-a only
  (on-disk assertion of the skill copy in the workspace's own
  `.agents/skills`, absent from the global root), Manage re-opens on
  the workspace scope, Save scope moves the copy to global
  (expect.poll on both filesystem locations), and the card badge reads
  "in workspace-a" then "in global".
- **skills marker**: adapted to the preseed — it asserted the empty
  workspaces note, which the seeding legitimately changed; it now
  asserts both preseeded workspaces render in its scope checklist
  (scoped to the checklist: the workspaces also appear in the sidebar).

## Verification

- Seed script: manual run on a temp home (2 added, ids stable, re-run
  adds 0); usage guard.
- `bash scripts/e2e-mount.sh` green (7.6s) with the full radio flow and
  the adapted skills marker.
