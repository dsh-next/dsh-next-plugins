# Session navigation on DSH 0.1.6: two removed APIs, one plugin restored

- date: 2026-09-18
- status: implemented
- scope: packages/dsh-next-reset, packages/dsh-next-checkpoints

Both browser halves switched the GUI with APIs the live client no longer has.
The reset handoff and the checkpoints rewind fork were built against
`@deepseek-ai/dsh-client-runtime` 0.1.1-rc.2; DSH 0.1.6-alpha.2 removed that
package and moved navigation to `@deepseek-ai/dsh-client-ui-workspace`.

## What the live client actually offers

- `ctx.sessions` (`@deepseek-ai/dsh-api-session-controller/client`) has
  `retain`, `using`, `create`, `fork`, `scope`, `sessionOf`, `binding`, `list`,
  `search` and `retainInfo` — **no `open`**, in the contract types and in the
  compiled class alike.
- `ctx.sessions.list.getSnapshot()` is `SessionListState`
  (`ids`, `byId`, `phase`, `subagentsByParent`, `jobsBySession`) — **no
  `current`**. The contract says it plainly: "navigation belongs to view
  owners".
- `ctx.uiWorkspace.openSession(target)` is the navigation call. Its type also
  documents that `openSession` is a UI navigation action.
- `ctx.uiSession` keeps its `current` binding source private; the public
  `bindingSource(reference)` needs a reference only a view owner holds.

## What was wrong, and what is fixed

`dsh-next-checkpoints` called `sessions.open(id)` after a rewind produced a
forked session, so that path would throw as soon as the host's `forkSession`
port yields a child. It now resolves `uiWorkspace.openSession`, falls back to
the legacy `sessions.open` for older hosts, and omits the action when the host
can navigate through neither.

`dsh-next-reset` had the same call plus a second, earlier failure: its watcher
reads the current session from `sessions.list…current`, which is always
undefined on 0.1.6, so the handoff watcher never subscribed to anything. The
navigation lookup is now resolved per handoff rather than at mount (`uiWorkspace`
is not registered when the plugin applies — measured, not assumed), and the
open-then-archive contract stops before archiving when the host cannot
navigate, so a session is never archived out from under the user.

## Evidence

- Red baseline: with the old code, the isolated `dsh-next-reset` mount marker
  failed right after `/reset` — the previous transcript was still on screen (3
  matches where 0 were expected) while the host had reported "Reset to a new
  session."
- Instrumentation (`[DEBUG-nav]`, removed) showed `apply` running with
  `sessions: true, workspaces: true, uiWorkspace: false`, and no handoff
  delivery at all.
- The checkpoints e2e lane passes before and after (it exercises in-place
  rewind, which never forks).

## Remaining, deliberately out of scope

Reset still does not switch on 0.1.6: its handoff *trigger* needs a live seam
for "the session the user is looking at", and the client deliberately keeps
that in the view owners. That needs a design decision (a session-scoped
contribution through `uiSession.provide`, a host-to-client signal, or a
supported navigation event) rather than another renamed call. The plugin's
host half is fine: `/reset` creates the next session and appends the handoff.

The same API drift should be audited in any other plugin that still imports
`@deepseek-ai/dsh-client-runtime`: the workspace-controller client, for
example, is only reached through `uiWorkspace` now.
