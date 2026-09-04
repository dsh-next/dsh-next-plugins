# Add in-page toast channel to the notifier

- date: 2026-09-04
- status: implemented
- scope: packages/dsh-next-notifier

The notifier now routes every alert through the channel that fits the user's
situation, decided in the pure core (`src/core/decision.ts`): while the page
is focused and visible the event queues with `channel: 'toast'`, otherwise
with `channel: 'web'` (still gated on the browser notification permission).

- Client: the new `ToastLayer` (`src/client/toasts.tsx` + `toasts.module.css`)
  registers in the shell's `shell.overlay` slot (SlotMap merge declared locally
  in `src/client/index.ts`; the contract was verified against the installed
  shell 0.1.2-rc.1's `dsh-client-ui-layout`). Capsules are alert-only: click
  opens the session, close dismisses, 12s TTL, one card per session, cap of
  five. A toast-channel event that drains after the user stopped looking falls
  back to a web notification (race guard via `isLookingNow()`).
- The web drainer (`src/client/drainer.ts`) skips toast-channel events; the
  shared headline/body helpers (`eventTitle`/`eventBody`) keep both channels
  speaking the same glance language.
- Both client pollers share one Host queue, so drains are channel-scoped:
  `drainPending(channel?)` (and the RPC arg) only consumes the requested
  channel, and an unscoped read stays supported for the legacy path — without
  this, whichever poller drained first would silently drop the other
  channel's events.
- The settings card gains a "Test in-page toast" row (Show button) feeding a
  module-local test bus — the real-mount smoke drives the overlay slot through
  it in `tests/e2e/mount.e2e.ts`. The frame overlay sits under modal masks, so
  the marker closes the Settings dialog before clicking the toast's close
  button (a masked click never reaches the toast, and the 12s TTL would expire
  during a slow retry loop).
- Design deviations from the harness look, per the design skill's
  deviation-table discipline: the toast uses `border-radius: 12px` (this
  repo's chrome radius inventory) instead of the composer's 22px capsule,
  `--dsw-elevation-prominent` with `border: 0` as the elevated-surface
  treatment, and a fixed `top: 18px` frame offset — there is no shell
  precedent for a floating toast, so values were chosen within the token and
  geometry rules rather than copied from the composer.

Tests: channel routing cases in `tests/config-decision.spec.ts`, queue-channel
contract through the wired event pipeline in `tests/rpc-contract.spec.ts`,
channel filtering in `tests/drainer.spec.ts`, a new jsdom suite
`tests/toasts.spec.tsx` (render, open, close, TTL, per-session replacement,
cap, web fallback, test bus), and the Show-button case in `tests/card.spec.tsx`.

SDK-skew fix found during the live review: the installed 0.1.2 shell's
`ISessions` dropped the legacy `currentProvideInfo` channel — the current
selection rides `sessions.list.getSnapshot().current` in every supported
generation. Presence reporting previously read only the legacy channel, so the
Host always saw `sessionId: null` and "mute while viewing" never suppressed
(users got toasts for the session they were looking at). `currentSessionId()`
now reads the list snapshot first with the legacy channel as fallback, and the
presence subscription prefers `list.subscribe` (same fallback), covered by
`tests/presence.spec.ts`.
