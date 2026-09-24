# Report an unreachable Skills host request instead of a parser error

- date: 2026-09-24
- status: implemented
- scope: packages/dsh-next-skills

## Symptom

The Skills settings page showed `Failed to execute 'json' on 'Response':
Unexpected end of JSON input` above an empty "No providers yet" grid, while the
Providers tab and the rest of the GUI worked.

## Root cause

The panel's RPC helper read every response with `Response.json()`. A path no
plugin registered is answered by the web server with a bare `405` and an empty
body, so `json()` threw its own `TypeError`. The intended fallback to the
localized `rpc.failed` message sat in a `.catch` guarded by
`error.message !== ''` — a parse error has a non-empty message, so that branch
was unreachable and the parser text reached the banner.

The 405 itself came from the deployment, not the source: the running `web`
profile served a pre-`0.1.7` build (byte-identical to
`artifacts/packages/...0.3.0-0001aa50....tgz`), whose `apply()` calls the retired
`settings.register()` namespace API, finds no settings scope, warns, and returns
before `registerRpc`. The ported source in this repository already works on DSH
`0.1.7-rc.1`; the stale build simply outlived the port.

Two local-testing facts follow from that, both observed on the `web` profile:
the browser half is re-read from `lib/client.js` on page load, so a rebuild
changes what the panel shows without a restart; the host half is imported once
at boot, so a port that changed `src/index.ts` needs the profile re-linked to a
current build (or reinstalled from a fresh tarball) **and** the DSH process
restarted before the route answers again.

## Fix

[index.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/client/index.ts)
reads the body once as text and parses it defensively: a JSON `{ error }` body
still surfaces the server's message, any other failure surfaces the localized
`rpc.failed` with its status, a success body that is not JSON surfaces the new
localized `rpc.invalid`, and a transport failure keeps its own error. Both new
strings exist in the `en`/`zh` dictionaries. The host half is unchanged: its
deliberate inert-with-a-warning behavior without a config editor is documented
and covered by `tests/index.spec.ts`.

## Verification

- `tests/client-entry.spec.ts` drives real `Response` objects (the previous
  doubles handed back a ready-made `json()`, which is why the gap survived):
  405 with an empty body, 502 with an HTML body, 500 with a JSON error envelope
  and with `{ error: '' }` / `{ error: 7 }`, 409 with a JSON body that has no
  error, a 200 with an empty body, and a transport rejection — plus a render
  assertion that the panel banner shows
  `Skills request "getState" failed (HTTP 405)`. All eight are red before the
  fix; the 405 case reproduces the reported string verbatim.
- A throwaway harness booted DSH `0.1.7-rc.1` in a private scratch home and
  probed `POST /dsh-next-skills/rpc`: the pre-port tarball answers `405` with an
  empty body (the reported failure), the current build answers `200`
  `{"installed":[],"providers":[],"catalog":[]}` for an explicit config row, for
  the config-less row shape the shipped bundle patch inserts, and for a `link:`
  install onto the repository package.
- `pnpm --filter @dsh-next/dsh-next-skills test` is green (329 tests).
