# cc-plugins: version display, card Update button, daily snapshot refresh

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-cc-plugins

The user asked for installed versions on cards, an Update button whenever
the marketplace carries a newer version, and a marketplace refresh policy.
Three pieces landed:

- **Version display and update flag (Host-computed).** `state()`'s plugin
  views gained `installedVersion` (the installed record's version) and
  `updateAvailable` (true when the snapshot's catalog version is newer).
  Computing these Host-side keeps the panel dumb and pins the shape in the
  RPC contract test. Comparison lives in the new pure
  `core/versions.ts`: `hasNewerVersion` prefers numeric dotted segments
  (`v`-prefix, pre-release below release, build metadata ignored,
  `0.9 < 0.10` numerically) and falls back to string inequality for
  non-semver tags — safe because updating just re-installs the latest
  snapshot. An empty catalog version never triggers; any version is newer
  than an unversioned install.
- **Card affordances.** Installed cards carry an "installed x.y.z" chip
  under the presence badge, and when `updateAvailable` is set, an Update
  button next to Add/Manage that dispatches `updatePlugin {key}` directly
  (`updatePlugin` re-syncs that marketplace first, so the button always
  pulls the true latest even from a nearly-stale snapshot). The modal title
  now shows "name (installed a.b.c) — x.y.z available" and keeps Update
  everywhere.
- **Marketplace freshness: daily TTL plus manual refresh.** Policy answer:
  snapshots re-sync automatically when the panel opens if older than 24
  hours (`MARKETPLACE_TTL_MS` in `core/versions.ts`, `isSnapshotStale`);
  Refresh all remains for forcing it now; every update re-syncs its own
  marketplace regardless. The RPC `getState` handler now calls the new
  `CcMarketplaceService.getState()` — stale marketplaces re-sync in
  parallel, best-effort (failures keep the cached catalog; only manual
  Refresh all reports errors), then the pure `state()` view answers. The
  Marketplaces tab shows each source's relative last-synced age
  (`formatLastSync`: just now / Nm / Nh / Nd ago, ISO date beyond a week)
  and a hint stating the 24-hour policy.

## Verification

215 tests across 14 suites (was 195): new tests/versions.spec.ts (TTL,
staleness, semver/pre-release/unparseable matrix), service tests for the
update-flag lifecycle (flag appears when the catalog moves ahead, clears
after update), `getState` auto-refresh (fresh snapshots answer from cache,
stale ones re-sync, failed refreshes keep cached data), the RPC contract
pins `installedVersion`/`updateAvailable`, and the panel spec covers the
installed-version chip, the card Update button dispatch, its absence when
current, last-synced text, and `formatLastSync` bands. The e2e marker
asserts the freshness hint in the Marketplaces tab.
