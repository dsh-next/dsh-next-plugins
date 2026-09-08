# Worktrees bug diagnosis — 2026-09-08

## Scope

Audit of the current, already-modified `packages/dsh-next-worktrees` working
tree, not just committed `HEAD`. Diagnosis only: no production source fixes,
existing-test edits, commits, live DSH mutations, or real repository worktree
operations were performed. All Git reproductions use disposable repositories;
client reproductions use jsdom and in-memory services.

No particular symptom was supplied, so the README and current cluster design
provided the behavioral contracts. Each finding below has an executed failing
check and targeted controls. The six findings were fixed in the follow-up
change; their reproductions now live as normal regression tests.

## Run the evidence

From `packages/dsh-next-worktrees`:

```sh
# Full package regression suite:
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit

# Former diagnostics promoted to normal regression tests:
./node_modules/.bin/vitest run tests/host-include-safety.spec.ts tests/host-registry-race.spec.ts tests/host-branch-lifecycle.spec.ts tests/client-sweeper-shared-worktree.spec.ts tests/client-create-reopen.spec.ts
```

The previously opt-in tests were promoted into the package's normal `tests/`
suite once fixed. They now assert the correct behavior and run with every
package test invocation.

### Diagnosis results before the fix

| Check | Result |
| --- | --- |
| Normal package Vitest suite | 23 files, 380 tests passed; exit 0 |
| Package `tsc --noEmit` | Passed; exit 0 |
| Opt-in diagnostics | 8 expected failures, 22 passing controls/probes; exit 1 |
| `node scripts/verify-docs.mjs` from the repository root | Passed |
| `node scripts/i18n-check.mjs` from the repository root | Passed |
| `git diff --check` | Passed |

The final diagnostic invocation above ran in 6.89 seconds while the normal
suite ran independently. Its exact summary was:

```text
Test Files  5 failed (5)
     Tests  8 failed | 22 passed (30)
```

Those eight failing assertions demonstrate six causes (branch switching and
registry overwrites each have two failing behavioral cases). The normal suite
was rerun after moving the diagnostics out of `tests/` and stayed green. Existing
React `act` warnings and a Vite tsconfig-paths deprecation warning remain;
neither caused a test failure. No temporary `[DEBUG-...]` logging remains.

## Confirmed findings

### 1. P1 — Include copying can overwrite the primary checkout

**Location:** [`src/index.ts`](../../packages/dsh-next-worktrees/src/index.ts),
lines 70–76; [`src/host/service.ts`](../../packages/dsh-next-worktrees/src/host/service.ts),
lines 459–463 and 1017–1020.

**Reproduce:** Commit an included path as a symlink pointing to a file in the
primary checkout. Replace the primary copy of that symlink with a regular local
file, without committing the replacement. Create a worktree. The new checkout
contains the committed symlink, and copying the local file follows it and
replaces the target in the primary checkout. The test uses only dummy strings.

**Observed:** Expected `keep this primary file`; received `fixture configuration`.

**Cause:** The include validator rejects lexical absolute/parent paths but does
not inspect filesystem links. Production `mkdir`/`copyFile` follows destination
symlinks, so a lexically contained destination can write outside the new tree.
This is a real write through production `apply` wiring, not just a parser test.

**Controls:** The same fixture with a regular destination passes. Removing only
the include entry also passes while Git still checks out the symlink. No setup
configuration is present, ruling out checkout/setup as the writer.

**Fix direction:** Enforce destination containment against filesystem reality,
including parent components and the leaf. Reject escaping symlinks or copy into
a verified safe destination without following the leaf; avoid introducing a
check-then-follow race. Decide and test source-symlink handling as well.

**Regression:** `tests/host-include-safety.spec.ts`, test containing
`does not overwrite ... symlink`.

### 2. P1 — Automatic cleanup can remove a checkout used by another workspace

**Location:** [`src/client/sweeper.ts`](../../packages/dsh-next-worktrees/src/client/sweeper.ts),
lines 124–135; host removal in
[`src/host/service.ts`](../../packages/dsh-next-worktrees/src/host/service.ts), lines 681–705.

**Reproduce:** Register one workspace at a managed checkout root with only a
blank session, and another at a subdirectory of the same checkout with the
currently open, started session. Mount the real browser wrapper.

**Observed:** The sweeper calls `removeWorktree` for the shared checkout even
though the second workspace is active. The client test intercepts that
prohibited destructive request before performing any removal.

**Cause:** Eligibility is computed per workspace, but deletion operates on the
whole checkout. The current/started-session checks consider only the first
workspace's `sessionIds`. Host removal guards setup/dirty state, not other
workspace/session usage, so a clean checkout has no corresponding host backstop.

**Controls:** Both sessions in one workspace prevent removal. Root/subdirectory
paths resolve to the same checkout identity, and the wrapper receives the
current started session. This is not a path-parser or unloaded-store issue.

**Fix direction:** Group all workspaces by canonical checkout identity and union
their sessions before deciding eligibility. Revalidate destructive cleanup at
the host boundary; retain the existing dirty/setup protection.

**Regression:** `tests/client-sweeper-shared-worktree.spec.ts`, test containing
`does not sweep a checkout ... current started session`.

### 3. P1 — Delete loses concurrent registry changes

**Location:** [`src/host/service.ts`](../../packages/dsh-next-worktrees/src/host/service.ts),
lines 692–705; [`src/host/registry-store.ts`](../../packages/dsh-next-worktrees/src/host/registry-store.ts),
lines 124–131.

**Reproduce:** Create A. Start deleting A, pause at the public Git-removal port,
create B, then release deletion. All Git and registry writes are real.

**Observed:** Registry `[A, B]` becomes `[]`, although B's folder and live Git
worktree entry survive. A fresh service cannot recover B into topology, and its
Remove action returns `unknown-slug`. A second variant reverts a completed
session binding on B back to an empty owner.

**Cause:** `remove` captures bindings before awaiting Git, then `replaceAll`
writes that stale snapshot. The store serializes individual writes, not the
service's entire read/Git/write operation.

**Controls:** Creating B entirely before or after deleting A passes. Concurrent
`store.mutate` calls preserve both updates. Git still lists B; restart does not
repair the lost plugin metadata.

**Fix direction:** Filter the current rows inside `store.mutate` after removal,
or serialize the complete per-repository lifecycle operation. Review other
snapshot-based `replaceAll` callers for the same pattern.

**Regression:** `tests/host-registry-race.spec.ts`, two concurrent-delete tests.

### 4. P2 — Same-name worktrees share setup results across repositories

**Location:** [`src/host/service.ts`](../../packages/dsh-next-worktrees/src/host/service.ts),
lines 232–235, 416–421, and 429–433.

**Reproduce:** One service creates `same-name` in repositories A and B. Hold both
setup commands at the executor port. Fail A and succeed B, then await setup for A.

**Observed:** A's setup call resolves successfully instead of reporting
`setup-failed` with A's output.

**Cause:** `setupJobs` is keyed by slug, which is unique only within a repository.
B's creation replaces A's job entry; `setup({cwd: A, slug})` validates A's row but
then awaits the globally keyed B job. `setupInFlight` uses the same insufficient
identity and should be corrected with the job map.

**Controls:** Different names in the same service pass; identical names in
separate service instances pass. Sequential real setup commands run in both
repositories. The deferred executor observes both canonical repository roots,
ruling out general error swallowing and incorrect cwd routing.

**Fix direction:** Key setup state by canonical checkout path or
`(primary, slug)` everywhere, including removal and completion cleanup.

**Regression:** `tests/host-include-safety.spec.ts`, test containing
`concurrent setups: same-name`.

### 5. P2 — Switching branches makes Merge report success without landing the work

**Location:** [`src/core/registry.ts`](../../packages/dsh-next-worktrees/src/core/registry.ts),
lines 98–105; [`src/host/service.ts`](../../packages/dsh-next-worktrees/src/host/service.ts),
lines 674, 793–825, and 855.

**Reproduce:** Create a managed checkout, switch it to another branch with Git,
commit `feature.txt` there, then use Merge.

**Observed:** Refresh still reports the original `dsh-worktrees/...` branch and
zero commits ahead. Merge resolves with target `main`, but the primary still
contains only `seed.txt`. The feature commit remains on the other branch; it is
not destroyed.

**Cause:** Reconciliation validates path existence but retains the creation-time
branch. Status and merge preflight consume that stale ref, and execute merges
it instead of the branch currently checked out in the worktree.

**Controls:** Direct Git branch/list queries see the new branch. Placement is
correct. Topology and a new service/store remain stale. Switching back restores
correct status. Ordinary, non-ASCII, and quote-containing repository paths all
pass the normal create/status/merge/delete lifecycle.

**Fix direction:** Reconcile or explicitly validate the live checkout branch
before status and merge. If branch switches are unsupported, block the action
with a clear explanation rather than reporting a successful unrelated merge.

**Regression:** `tests/host-branch-lifecycle.spec.ts`, Refresh and Merge tests.

### 6. P2 — Reopening Create lets an old suggestion overwrite user input

**Location:** [`src/client/create-store.ts`](../../packages/dsh-next-worktrees/src/client/create-store.ts),
lines 356–367.

**Reproduce:** Open Create and hold its name-suggestion request. Close with
Escape, reopen Create for the same repository, receive the new suggestion, and
type a name. Resolve the original request last.

**Observed:** The actual modal input changes from `my-intended-name` to
`obsolete-suggestion`.

**Cause:** The completion guard checks modal kind and cwd, not the identity of
the request/modal instance. The old response matches the reopened modal and
unconditionally replaces its `name`.

**Controls:** Reopening for another cwd is safe; typing without an outstanding
older request is stable; closing without reopening does not resurrect the
modal. The test exercises bridge invocation, Escape, and the real React input.

**Fix direction:** Give each Create opening/request a unique generation token
and invalidate it on close. Guard both success and failure callbacks; do not
replace a user-edited name with an obsolete suggestion.

**Regression:** `tests/client-create-reopen.spec.ts`.

## Fix status

All six findings were fixed in the follow-up. Final review also added coverage
for detached worktrees and concurrent reconciliation persistence. The contracts
now run as normal tests: `host-include-safety.spec.ts` (include safety and setup
isolation), `client-sweeper-shared-worktree.spec.ts`,
`host-registry-race.spec.ts`, `host-branch-lifecycle.spec.ts`, and
`client-create-reopen.spec.ts`.

## Coverage and limitations

The existing 380-test package suite passed before the new diagnostics. Its
missed cases were filesystem-real include links, multiple workspace identities
for one checkout, overlapping lifecycle RPCs, setup in multiple repositories,
external branch changes, and closing/reopening an async Create modal.

This is not an exhaustive proof that no other bugs exist. Include copying now
rejects static leaf and parent symlinks and uses exclusive no-follow creation.
Node has no portable descriptor-relative no-follow API for every parent path,
so this relies on the normal lifecycle guarantee that no concurrent local
process replaces a destination directory before the new session starts.

The package mount smoke was attempted but stopped before worktrees mounted:
the unrelated OAuth-providers tarball install was blocked by pnpm ignored build
scripts. No live GUI or Windows executor was run. A preliminary stale Rename
observation was narrowed to decoration metadata and is not counted among the
six findings.

The test runner was initially absent. Frozen-lockfile dependency setup was
needed; pnpm's subsequent automatic dependency check unexpectedly ran package
prepare builds. Later commands used direct local binaries to avoid that side
effect. No existing tracked source was edited by this audit; generated build
artifacts and dependency installation state may have been refreshed.
