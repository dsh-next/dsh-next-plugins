---
name: dsh-next-release
description: Release and publish the dsh-next monorepo — record change intents for affected packages, let the changeset-driven pipeline bump versions and open the Version Packages PR, and merge it to publish the changed packages to npm.
---

# dsh-next release

See `docs/release-model.md` for the rationale (why changesets + the Version
Packages PR, the trigger, one-PR-covers-all-packages); this skill is the
step-by-step procedure.

## Repository facts

- All packages publish to npm scope `@dsh-next`, registry npmjs.org.
- Per-package versioning: each plugin versions independently; the Version
  Packages PR (created by `changesets/action` on push to main) bumps only the
  packages named by pending change files.
- Publishing happens only through `.github/workflows/release.yml` using the
  repository secret `NPM_TOKEN`. The root `package.json` and `shared/` are
  private and are not published.
- Packages marked `"private": true` in their own manifest (currently
  `@dsh-next/dsh-next-cc-plugins`, under active development) are never
  published: npm refuses a private publish and changesets skips them. Their
  changes need no change file, and they must never appear in one (a mixed
  changeset breaks `changeset version`; the CI gate rejects it). Remove
  `"private": true` to release a package.
- The `.changeset/config.json` file must stay world-readable (mode `644`) so
  CI runners and co-located contributors can read it; `chmod 644
  .changeset/config.json` if it ever regresses to `600`.
- `.changeset/changelog.mjs` is the custom changelog formatter (wired via
  `"changelog": ["./changelog.mjs", { "repo": "dsh-next/dsh-next-plugins" }]`);
  it emits clean human-first bullets with no git hashes and appends a linked
  author attribution for the author of the PR that introduced each change file.
  Attribution is best-effort: direct-to-main pushes (no PR) and local runs
  without `GITHUB_TOKEN` land unattributed, and API failures never block
  versioning. The `## x.y.z` headers carry no compare link (per-package
  versioning, no repo-wide tag).
- Each release pushes a per-package git tag (`name@version`, e.g.
  `@dsh-next/dsh-next-notifier@0.1.0`) because `changesets/action` forces
  `push-git-tags` on when `create-github-releases` is true. These tags are
  additive metadata for the GitHub Release diff UI, not the release source of
  truth (that is the npm registry version); never edit or delete them. Tags
  are created only by the pipeline — never run `git tag`, `changeset tag`, or a
  bare `changeset publish` by hand.

## Flow

1. Make the change and record a change intent for each affected RELEASABLE
   package: run `pnpm changeset` at the repo root, pick the packages and bump
   kinds (patch/minor/major), and commit the generated `.changeset/<id>.md`
   with the change. Never select a private package — the interactive picker
   lists it, but it must stay out of change files. A releaseable plugin source
   change without a change file fails CI
   (`node scripts/verify-changeset.mjs --base origin/main`).
2. Write the change entry following the CHANGELOG best practices below and in
   `.changeset/README.md`; the entry text is pasted verbatim into the package
   `CHANGELOG.md` by `changeset version` and into the GitHub Release notes.
3. Run the pre-release gates locally (`mise run ci`, which runs typecheck +
   test + build + runtime-deps + docs) and `pnpm changeset status` to preview
   the pending bumps.
4. Merge to main. The release workflow versions the named packages, writes
   their CHANGELOG.md files, and opens/updates the "Version Packages" PR.
5. Review the Version Packages PR: the diff should contain only version and
   CHANGELOG changes, and each entry should read correctly, before merging.
6. Merge the Version Packages PR. The next main push publishes exactly the
   bumped packages via `changeset publish`, creates per-package GitHub
   Releases from the change summaries, and pushes a per-package git tag.
7. Verify the npm publishes, the GitHub Releases, and the per-package tags.

Never publish a version already on the registry; bumps come from change
intents, not manual edits.

## Choosing the bump kind

- **major**: a breaking change — a public API, defaults, settings schema, or
  CLI surface that existing consumers must migrate for.
- **minor**: a new backward-compatible feature.
- **patch**: a bug fix or non-behavioral change (documentation-only changes
  need no change file at all — the gate exempts READMEs and manifests).

A change file can name several packages at once when one PR touches all of
them; otherwise write one change file per package so each can version on its
own schedule. Never put a private package in a change file.

## Writing a good change entry

The change entry is the only human-authored text that becomes the
`CHANGELOG.md` and the GitHub Release note, so write it for the end user, not
the author:

- Summarize the user-visible effect ("Fixed notification title truncation at
  40 characters"), not the implementation ("Refactored the string-coercion
  helper").
- One entry can summarize several related changes; use a blank line and a
  draft-style `-` list only when the diff has genuinely separate user-facing
  effects.
- State breaking changes first and mark them `**Breaking**` so they surface at
  the top of the changelog section.
- Do not include PR numbers, commit hashes, or "chore" plumbing noise — the
  changelog is for users reading what changed. Keep it concise and in English,
  with no emoji (repository rule).
- Do not hand-write attribution ("by @user") — the formatter appends the
  linked author of the PR that introduced the change file automatically;
  entries without a PR land unattributed.
- Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) grouping and
  wording conventions: the changelog is generated (never hand-edited), entries
  are newest-first, and each version is a plain `## x.y.z` heading (the
  custom formatter adds no hash prefix, and no compare link is attached).

`CHANGELOG.md` files are machine-generated by `changeset version`; never edit
them by hand — correct a stale or wrong entry by fixing its change file before
the Version Packages PR merges.

## Canary (snapshot) prerelease

To hand a build to external testers without a stable release, run the
`.github/workflows/canary.yml` workflow manually (Actions tab), optionally
choosing a dist-tag (default `canary`). It runs `changeset version --snapshot
<tag>` then `changeset publish --tag <tag>`, publishing each pending package as
`0.0.0-<tag>-<timestamp>` under that dist-tag, with git tags disabled
(snapshot prereleases intentionally push no tags). This consumes nothing
permanent: the real change files stay for the next stable release, and the
snapshot mutations are never committed. Testers install with
`npm install @dsh-next/dsh-next-<slug>@canary`; a plain `npm install` keeps
resolving the stable `latest`. Locally this maps to `pnpm release:canary`
(which uses tag `canary`); the CI workflow accepts an override via its
`tag` input for other labels such as `beta` or `rc`.
