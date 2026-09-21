# Recover a restored Source control tab whose session is not loaded yet

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

## Symptom

With the Source control tab left open, restarting the harness showed a terminal
"This session is not in a git repository" header and banner in that tab. Opening
the session again made it load normally.

## Diagnosis

A live probe of the running host proved the mechanism:

```
POST /dsh-next-git/rpc getState {"sessionId":"does-not-exist-1234"}
-> {"ok":false,
    "failure":{"code":"not-a-repository","detail":"session has no working directory"},
    "degraded":{"code":"not-a-repository",...}}
```

`GitService.repoFor` resolves the session's cwd through `ctx.sessions.get(id)`.
The host session store holds only *live* sessions (DSH `SessionStore`), so a tab
restored after a restart asks for state before its session exists again. The
plugin reported that unresolved lookup with the same terminal `not-a-repository`
code it uses for a folder git itself rejects, and because that code is degraded
the panel latched the no-repository state until the tab was remounted.

## Fix

The two conditions are now distinct, and the transient one is retryable:

- **Host** — `repoFor` throws `session-not-ready` (detail "session has no working
  directory"); `not-a-repository` is reserved for what git actually reports. The
  new code is deliberately absent from `isDegradedCode`, so the envelope carries
  `degraded: null`. Every other resolution path is unchanged.
- **Client** — the panel keeps reading instead of latching. A `session-not-ready`
  read with no state retries every 2s for a ~60s fast window while showing
  "Reading repository…"; after that it names the state once
  (`failure.sessionNotReady` + its fix) and keeps a 15s slow retry so opening the
  session still heals the panel with no user action. Any deliberate read
  (open, Reload, focus, tab visible, agent turn) restarts the fast window, and a
  successful read clears the retry entirely. A retry that cannot resolve the
  session runs no git process.
- **Header** — with no state yet the branch label no longer claims the checkout
  is not a repository: a read in flight says so, and the unloaded-session case
  names itself. This was the second half of the screenshot.

Real `not-a-repository` (a folder git rejects) keeps its existing terminal
degraded behavior and is never retried.

## Verification

- Reproduction first: `GitService` unknown-session and client latching tests were
  red before the change, and the live RPC probe above captured the old envelope.
- Regression coverage: host code + non-degraded envelope, retry/heal, fast-then-
  slow budget, report-once, budget reset on a deliberate trigger, no retry for
  `not-a-repository`, no retry after dispose, header and banner naming.
- Full package suite 1,177 passed / one pre-existing filesystem skip; typecheck,
  build, `pnpm i18n:check`, `pnpm docs:check` (pair re-recorded) and
  `git diff --check` pass.
- The packed-plugin Git E2E lane now asserts the real runtime contract through
  the mounted RPC route: an unopened session returns `session-not-ready` with
  `degraded: null` (artifacts/testing/run-GW7GLJ).

Both halves change, so the host half needs a DSH restart; a page refresh alone
only delivers the client half.
