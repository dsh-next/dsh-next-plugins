# cc-plugins: seed the official marketplace and support git-subdir sources

- date: 2026-09-01
- status: implemented
- scope: packages/dsh-next-cc-plugins

The panel started empty on a fresh install: users had to know a marketplace
spec before they could see anything. Two changes fix that, shaped by an
audit of anthropics/claude-plugins-official's live index (291 plugins):

- Seeding: `DEFAULT_MARKETPLACE_SPECS = ['anthropics/claude-plugins-official']`
  (core/source.ts) is applied by `Store.seedDefaultMarketplaces` only when
  the marketplaces registry file has never been written. Once the file
  exists — including emptied by deliberate removals — the seed never
  applies again, keeping removals final. The host entry fires it at apply;
  the first panel open then syncs the seeded marketplace best effort (an
  offline machine still renders the row from the registry alone).
- git-subdir sources: `{ source: "git-subdir", url, path, ref?, sha? }`
  normalizes to the github source kind with a `subdir`, and
  `resolvePluginFiles` slices that subdirectory out of the repository
  tarball (the same slicing relative marketplace plugins use). The official
  index uses this form for 85 of its 291 plugins; 53 are relative and 153
  are GitHub `url` sources.
- sha/ref pinning: external sources carrying `sha` (an exact commit) or
  `ref` install that exact ref — every external entry in the official index
  carries a pin. An exact `sha` beats a movable `ref`, matching Claude.

Also new: `command` plugin sources (which execute a local command) are
reported as unsupported with the reason saying so.

The e2e mount marker now proves the seed on its fresh scratch home: the
official row renders (assertions never depend on its GitHub sync reaching
the network), the fixture flow locates its card by name, and removing the
fixture leaves the seeded marketplace in place.

Evidence: 326 tests across 15 suites, typecheck/build/docs:check and the
mount smoke green; live verification added the official marketplace to the
real preview and exercised a git-subdir install end to end.
