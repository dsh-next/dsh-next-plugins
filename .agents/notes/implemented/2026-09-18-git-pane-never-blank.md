# The Source control pane never goes blank

- date: 2026-09-18
- status: implemented
- scope: packages/dsh-next-git, tests/e2e

Report: sometimes opening Source control shows the tab chip but an empty pane.
The chip fix earlier in this package (see `2026-09-18-git-tab-chip-and-new-tab.md`)
left the same failure class one level deeper, in the body seat.

## Two ways the pane ends up empty

Both were confirmed against the slot runtime shipped in DSH 0.1.6-alpha.2.

1. The body seat returned `null` whenever the share had no `sessionId` or no
   `useTabInfo` hook. A registered seat that renders nothing is an empty pane;
   the platform's captured-title fallback only covers the chip, not the body.
   The chip's old blank title already proved the seat can hand a partial share.
2. A render error that escapes a registration is fatal to it. `SlotCore`
   retires the entry one-shot (`abdicated`, a WeakSet keyed by the
   registration record), `entriesOfSlot` then skips it, and the keyed outlet
   renders `<div data-slot-error="sidebar.right.pane.tab">` - an empty cell.
   Nothing re-creates the registration while the page lives, so the pane stays
   blank across tab switches until a reload, while the chip (a separate
   registration) keeps working. The nearest candidate throw sits in the
   platform's own `tabInfoFactory`: its hook raises
   `sidebarRight: tab "..." is not committed in session "..."` whenever the
   tab record is not in the session layout yet - a transient state during
   session switches and layout restores.

## The fix

- The body seat never returns null: without a session it renders a named
  no-session state (`state.noSession`).
- `GitPanel` mounts an internal error boundary (`PanelBoundary`) around the
  body, so a crash is caught inside the plugin and can never retire the
  registration. The fallback (`PanelCrashed`) names the failure, shows the
  error message, and offers Retry, which remounts the guard.
- The one read of the platform tab hook moved out of the panel body into the
  diff header's open-file button, behind a null-fallback boundary with a
  reset key. A transient throw there costs one button, and the panel no
  longer calls a hook that can throw at all when the seat hands none.
- A read that never settled now shows the read-in-flight hint instead of an
  empty body (`state.loading`).
- The chip picked up a related staleness on the way: the strip usually paints
  before the body, so the chip kept the type label until something else
  re-rendered it. The body now announces store membership
  (`storesVersion` / `subscribeStores`) and the chip re-reads the registry.

## Evidence

- Unit: seat contract (never null, forwards the hook only when handed one),
  panel without the hook, throwing hook costs only the open-file button,
  boundary containment and retry, late-store chip pickup.
- Live: a temporary Playwright probe against a real dev runtime (git plugin,
  scratch home) forced a crash in the panel body and in the entry component
  itself via a sessionStorage switch. Contained, the pane showed the named
  failure with Retry and recovered to the full panel; escaping, the pane went
  and stayed blank (`data-slot-error` cell) across further remounts with the
  cause removed - a pixel match for the report. The probe code was removed
  before commit.
- The mount marker now also pins the contract: the body's text is never
  empty and the seat is never left as a dead cell.
