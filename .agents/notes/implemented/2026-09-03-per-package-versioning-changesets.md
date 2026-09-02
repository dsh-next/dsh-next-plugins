# Per-package versioning with changesets

- date: 2026-09-03
- status: implemented
- scope: repo (release process)

Replaced the unified single-version release model (one `vX.Y.Z` tag equal to
every package version, verified by `scripts/verify-version.mjs`) with
changeset-driven per-package versioning:

- `.changeset/config.json` pins Changesets v3 defaults: no fixed/linked
  groups, `access: public`, `privatePackages.version: false` (shared/ is
  never versioned).
- Every PR touching a publishable plugin's source adds a `.changeset/<id>.md`
  change file; `node scripts/verify-changeset.mjs --base origin/main` is
  enforced in CI on pull requests (checked in `scripts/verify-changeset.test.mjs`,
  run by `pnpm test:scripts`).
- `.github/workflows/release.yml` now runs `changesets/action@v1` on push to
  main: it versions only named packages and opens/updates the "Version
  Packages" PR; merging that PR triggers `changeset publish` for the bumped
  packages plus per-package GitHub Releases from CHANGELOG entries. The
  post-publish mount smoke gates on the action's `published` output.
- Dropped `private: true` from all publishable packages (and the plugin
  template); `shared/` and the root stay private. Registry state confirmed
  empty, so the first release publishes each package at its manifest
  version, later ones only the bumped set.
- Removed `scripts/verify-version.mjs` and `scripts/release-notes.mjs` (and
  the placeholder `docs/release-notes/`); release notes now come from
  per-package CHANGELOGs. Updated `docs/publish-prep.md`, `AGENTS.md`, and
  `.agents/skills/dsh-next-release/SKILL.md`.

No cross-package dependencies exist, so no version-range coordination was
needed. Verified end to end: a scratch changeset bumped only the named
packages (skills 0.1.0 -> 0.1.1 patch, notifier 0.1.0 -> 0.2.0 minor) with
cron untouched, and wrote their CHANGELOGs.

Later in the same day the eight scaffold-only plugin packages were removed
(cron, files, git, org, previews, slack, telegram, workflows): pure
TODO-skeletons with no real behavior, referenced only by README/PR/issue
templates, review routes, and the lockfile. The family is now three real
plugins (cc-plugins, notifier, skills) plus `shared/`; the changeset gate
ignores deleted packages.
