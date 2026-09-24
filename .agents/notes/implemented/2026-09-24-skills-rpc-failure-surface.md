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

The 405 itself came from the deployment, not the source. Until 19:41 on
2026-09-24 the running `web` profile pinned `@dsh-next/dsh-next-skills` to
`file:.../artifacts/packages/...0.3.0-0001aa50....tgz` (the plugin manager's own
operation log records that specifier); at 19:31 the copy installed from it was
hashed against the tarball's `lib/index.js` and both were `8373239a…`. That
build's `apply()` calls the retired `settings.register()` namespace API, finds no
settings scope, warns, and returns before `registerRpc`; DSH `0.1.7-rc.1`'s
settings service no longer offers a namespace `register` at all. The ported
source in this repository already works on that runtime; the stale build simply
outlived the port. The profile has since been relinked to this repository, so the
hash comparison is only reproducible from the tarball now, not from the profile.

Two local-testing facts follow from that, both observed on the `web` profile:
the browser half is re-read from `lib/client.js` on page load, so a rebuild
changes what the panel shows without a restart; the host half is imported once
at boot, so a port that changed `src/index.ts` needs the profile pointed at a
current build **and** the DSH process restarted before the route answers again.

## Fix

[index.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/client/index.ts)
reads the body once as text and parses it defensively: a non-empty JSON
`{ error }` string still surfaces the server's message, any other failure
surfaces the localized `rpc.failed` with its status, a success body that is not
JSON surfaces the localized `rpc.invalid`, and a transport failure keeps its own
error. Both strings exist in the `en`/`zh` dictionaries.

[SkillsPanel.tsx](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/client/SkillsPanel.tsx)
adds `isSkillsState`: the state envelope's three collections are read during
render, so a `200` whose body parses but is not a state used to crash the panel
before it could show anything. It now reports `rpc.malformed` instead. The host
half is unchanged; its deliberate inert-with-a-warning behavior without a config
editor is documented and covered by `tests/index.spec.ts`.

Deliberately unchanged: a non-JSON error body is discarded (`no such method: X`,
`invalid json` and an HTML error page are not rendered into the banner), and a
failed `response.text()` collapses into the same readable message rather than
propagating the stream error.

## Verification

- `tests/client-entry.spec.ts` drives real `Response` objects (the previous
  doubles handed back a ready-made `json()`, which is why the gap survived).
  Against the pre-fix implementation, 4 of its guard cases fail: `405` with an
  empty body, `502` with an HTML body, a `200` with an empty body, and the
  banner-render assertion — the others already fell back to the localized
  message because the old `.catch` handled non-parser failures. The jsdom
  failure text is the reported string's tail (`Unexpected end of JSON input`);
  the `Failed to execute 'json' on 'Response':` prefix is Chrome's own wording.
- `tests/panel.spec.tsx` covers `isSkillsState` and the null/wrong-shape render
  path; an independent probe confirmed the unguarded panel throws
  `Cannot read properties of null (reading 'providers')` with no banner.
- A throwaway harness booted DSH `0.1.7-rc.1` in a private scratch home and
  probed `POST /dsh-next-skills/rpc`: the pre-port tarball answers `405` with an
  empty body (the reported failure), the current build answers `200`
  `{"installed":[],"providers":[],"catalog":[]}` for an explicit config row, for
  the config-less row shape the shipped bundle patch inserts, and for a `link:`
  install onto the repository package.
- `pnpm --filter @dsh-next/dsh-next-skills test` is green (337 tests), the repo
  gate (`typecheck`, `test`, `i18n:check`, `docs:check`) exits 0, and the
  real-browser `skills` e2e suite passes 4/4.
