# Reset handoff on the current session controller

- date: 2026-09-21
- status: implemented
- scope: packages/dsh-next-reset

The reset client now explicitly injects `uiWorkspace` and observes every live
session binding instead of reading `sessions.list.current`. DSH 0.1.6 moved the
selected session into workspace navigation and removed `current` from the session
catalog, so the previous watcher remained on an undefined selection: the host
created the blank session and logged success, but the browser never opened it or
archived the old session.

The watcher keeps legacy `current` support, uses current catalog `ids` when
present, subscribes only bindings that are actually live, and retires subscriptions
when catalog rows disappear. Unit coverage reproduces the no-selection catalog,
and the real Reset suite verifies the new transcript opens and the previous row is
archived. The package now declares the workspace-navigation client module and a
`0.1.6-alpha.2` DSH floor.
