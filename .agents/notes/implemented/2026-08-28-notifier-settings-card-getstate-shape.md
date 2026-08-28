# Fix notifier settings card: getState response-shape mismatch

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier

## Bug

Clicking "DSH Next Notifier" in the Plugins settings tab did not reveal the
settings body. The card's `<li>` gained the `open` class and
`aria-expanded="true"` (the toggle worked), but no body `<div>` rendered.

Root cause: the card renders its body only when `open && config`, and `config`
came from `snap?.config`. The Host's `getState` RPC returned the raw
`NotifierConfig` (`{enabled, suppressFocused, volume, finished, approval,
question}`), but the client treated the response as its `StateSnapshot`
envelope (`{config, platform, webPermission, sounds}`). So `snap.config` was
`undefined`, `config` was null, and the body stayed hidden no matter how
`open` toggled. Same latent mismatch affected `setConfig`, which also returns
the state and whose reply the card reads as `next.config` (volume preview).

## Fix

Made the RPC contract return the envelope the card already expects:

- `notifier.state()` assembles `{ config, platform, webPermission, sounds }` —
  normalized config, a canonical platform label (`macos`/`windows`/`linux`/
  `null`) derived from the detected audio backends, the browser notification
  permission, and the `SOUNDS` catalog mapped to `{id, name, group}`.
- `getState` and `setConfig` now return `notifier.state()` instead of
  `notifier.config()`.

Verified live in the dev profile (`dsh --profile dev`, port 4480): the card
body now renders the master switch, mute-while-viewing, volume slider, browser
notification test, and all three group rows; `getState` returns the envelope.
`pnpm typecheck`, `pnpm test` (22), and `pnpm build` all green.
