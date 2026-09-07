# checkpoints Playwright e2e

- date: 2026-09-06
- status: implemented
- scope: tests/e2e/checkpoints.e2e.ts, packages/dsh-next-checkpoints

Real-mount coverage for the Changes tab:

- Family smoke (`bash scripts/e2e-mount.sh`) keeps a light marker so it does
  not create sessions or git repos that worktrees needs clean.
- Detailed lane: `E2E_SPECS=tests/e2e/checkpoints.e2e.ts bash scripts/e2e-mount.sh`
  drives a workspace-a session, host `capture` snapshots (no live model),
  asserts DiffBlock, select-does-not-restore, confirm modal (HEAD moved +
  primary checkout), two-step rewind, file restore, later checkpoint dropped,
  HEAD unchanged.

Host gained a `capture` RPC and the Changes root exposes `data-session-id`.
Playwright workers are 1 because one DSH server is shared.
