# E2E: wait for create idle before failing-setup click

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-worktrees, tests/e2e

Host create writes the registry before bind/open finishes, so the e2e
polled "one binding" and clicked again while `creating` was still true.
The second click was a no-op and the create-error modal never appeared
on CI. `html[data-dshx-creating]` now mirrors the guard; the marker waits
for idle. The failing command is `exit 1`.
