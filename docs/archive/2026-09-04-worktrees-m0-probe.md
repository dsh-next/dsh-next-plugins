# dsh-next-worktrees M0 probe results

- date: 2026-09-04
- status: validation snapshot
- scope: docs/ideas/dsh-next-worktrees.md

First-round M0 validation for the worktrees idea. Three probes: the
permission-preset seam, the client session-focus seam, and the worktree
sandbox geometry under a live `workspace-write` executor.

## Static: permission preset seam (installed 0.1.2-rc.1)

The installed line ships `@deepseek-ai/dsh-permission-presets`:

- Public per-session write path: `ctx.permissionPresets.set(session, name)`.
  It appends a durable `permission/preset` event, then writes changed knobs
  through the canonical setters (`setSandboxMode` from `dsh-sandbox-policy`,
  `setApprovalPolicy` from `dsh-user-approval`).
- The preset table is plugin config: `presets: Record<string, PresetSpec>`
  with `PresetSpec { sandbox, approval, name?, description? }`.
- Stock table: `workspace-write` = workspace-write + ask;
  `danger-full-access` = danger-full-access + **never**. The stock
  full-access row disables approval prompts — the plugin's worktree preset
  must be its own row with approval `ask` (clutch's `worktree-full-access`
  shape).
- Contribution mechanism (clutch precedent, approved design): restate the
  upstream `dsh-permission-presets` row by id in our `cordis.patch.yml`
  with the extended table. Caveat: a config restatement replaces the table —
  restate both stock presets and re-verify on SDK bumps.
- Client surfaces exist: `permissions` session projection, `/permission`
  command, and the native selector from `dsh-client-ui-permission-presets`.

## Static: client session-focus seam

The wloops incumbent (same client line) ships the exact call chain the
attention shuttle needs:

- `services.workspaces.create({ path })` — register the worktree root as a
  workspace.
- `services.sessions.create({ workspaceId, sessionId })` — create the
  session bound to it.
- `services.sessions.open(sessionId)` — focus another session.
- `services.sessions.list` projection carries per-session `cwd` and is
  subscribable.

This also statically corroborates session-cwd-from-workspace-path (M0
assumption 1). Open caveat: client `sessions.create` binds the session to
the workspace root; whether the session cwd can be a sub-path of the
registered workspace (the relative-path-preservation rule) must be verified
at implementation start.

## Dynamic: worktree geometry under workspace-write

Geometry: main repo outside the sandbox root, linked worktree inside it —
what an isolated session will see (session cwd is the worktree; the common
`.git` lives with the main repo). Run under this session's real
`workspace-write` executor on macOS.

1. Setup outside the root: denied (`mkdir: Operation not permitted`,
   `[sandbox: file access denied under workspace-write mode]`); succeeded
   once escalated to `danger-full-access`.
2. From inside the worktree, unconfined attempt: writing a file inside the
   worktree succeeded; `git add` failed with
   `fatal: Unable to create '<repo>/.git/worktrees/wt1/index.lock':
   Operation not permitted` and the same sandbox marker.
   `git rev-parse --git-common-dir` confirmed the common dir outside the
   root.
3. The same add + commit with `danger-full-access`: succeeded; commit, log,
   and status all clean. Scratch repo and worktree removed afterwards.

Conclusion: a session whose cwd is a linked worktree cannot stage or commit
under `workspace-write` — every landing action dies on the shared
index/objects outside the root. The clutch-shaped preset
(`danger-full-access` + `ask`, worktree session only) is required, not
optional. Remaining live check: apply the preset to a real scratch-profile
session end to end, then run the assumption-1 cwd probe in that session.

## Live end-to-end (scratch profile, same day)

A throwaway host plugin (mounted by absolute path) ran inside a real
scratch `dsh --profile m0` boot (`dsh-base` + `dsh-web-app`, `DSH_HOME`
under the workspace). It created a repo with a linked worktree at
`.dsh/worktrees/t1`, created a session with `meta.cwd` at the worktree, ran
commands through `ctx.shell` with `ctx.sandboxPolicy.resolve({ session })`
stamped on the request (the bash tool's own path), switched the session's
sandbox knob, and re-ran. All green:

- Session: `ctx.sessions.create(id, { meta: { cwd: worktree } })` works;
  `session.header.cwd` is the worktree, and the resolved policy's
  `workspaceRoot` is the same path (canonicalized).
- Pre-switch run under `workspace-write`: `pwd` lands in the worktree,
  `git rev-parse --git-common-dir` points at the repo's `.git`, and
  `git add` fails with `enforcement: "full"`, `denied: true` on
  `index.lock: Operation not permitted`.
- Knob write: the public `setSandboxMode(session, 'danger-full-access')`
  export from `dsh-sandbox-policy` (the same canonical setter the preset
  service drives). Approval knob untouched (stays `ask`);
  `permissionPresets.current(session)` reads `custom` afterwards because
  dfa+ask matches no stock row — display-only, as documented.
- Post-switch run under `danger-full-access`: `denied: false`, add +
  commit + log succeed (`COMMIT_OK`).

Two corrections discovered on the way:

1. **A profile patch cannot restate an existing row by id.** Duplicating
   the base `permission` row to add a custom preset fails the whole boot
   with `duplicate loader entry id: permission`. The clutch-style
   "restate the upstream row" design does not work on `0.1.2-rc.1`; the
   plan now switches the sandbox knob directly and skips named preset
   rows entirely (also avoiding the stock `danger-full-access` row, which
   bundles approval `never`).
2. **Nested sandbox-exec fails closed.** A dsh booted inside an
   already-Seatbelt-confined process cannot apply its own profiles
   (`sandbox-exec: sandbox_apply: Operation not permitted` → structured
   `SANDBOX_UNAVAILABLE`, nothing runs unconfined). Production is
   unaffected (dsh boots unconfined), but any probe or e2e lane that
   exercises confined modes must boot its scratch dsh unconfined.

