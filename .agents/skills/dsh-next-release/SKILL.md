---
name: dsh-next-release
description: Release and publish the dsh-next monorepo — record change intents for affected packages, let the changeset-driven pipeline bump versions and open the Version Packages PR, and merge it to publish the changed packages to npm.
---

# dsh-next release

## Repository facts

- All packages publish to npm scope `@dsh-next`, registry npmjs.org.
- Per-package versioning: each plugin versions independently; the Version
  Packages PR (created by `changesets/action` on push to main) bumps only the
  packages named by pending change files.
- Publishing happens only through `.github/workflows/release.yml` using the
  repository secret `NPM_TOKEN`. The root `package.json` and `shared/` are
  private and are not published.

## Flow

1. Make the change and record a change intent for each affected publishable
   package: run `pnpm changeset` at the repo root, pick the packages and bump
   kinds (patch/minor/major), and commit the generated `.changeset/<id>.md`
   with the change. A plugin source change without a change file fails CI
   (`node scripts/verify-changeset.mjs --base origin/main`).
2. Run the pre-release gates locally (`mise run ci`, which runs typecheck +
   test + build + runtime-deps + docs) and `pnpm changeset status` to preview
   the pending bumps.
3. Merge to main. The release workflow versions the named packages, writes
   their CHANGELOG.md files, and opens/updates the "Version Packages" PR.
4. Merge the Version Packages PR. The next main push publishes exactly the
   bumped packages via `changeset publish` and creates per-package GitHub
   Releases from the change summaries.
5. Verify the npm publishes and the GitHub Releases.

Never publish a version already on the registry; bumps come from change
intents, not manual edits.
