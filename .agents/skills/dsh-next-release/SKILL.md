---
name: dsh-next-release
description: Release and publish the dsh-next monorepo — bump all packages to one unified version, commit and tag, push the vX.Y.Z tag that triggers the GitHub Actions publish pipeline, and verify the npm publish and GitHub Release.
---

# dsh-next release

## Repository facts

- All packages publish to npm scope `@dsh-next`, registry npmjs.org.
- Unified versioning: the `vX.Y.Z` tag equals every package version, enforced
  by the pipeline.
- Publishing happens only through `.github/workflows/release.yml` using the
  repository secret `NPM_TOKEN`. The root `package.json` is private and is not
  published.

## Flow

1. Determine the target version (default to the next patch).
2. Run the pre-release gates locally (`mise run ci`, which runs typecheck +
   test + build + runtime-deps + docs).
3. Bump every package version to the target, commit, and tag `vX.Y.Z`.
4. Push the tag to trigger the pipeline.
5. Verify the npm publishes and the GitHub Release.

Never republish an already-published version; bump to the next version instead.
