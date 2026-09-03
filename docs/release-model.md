# Release model

This document explains *why* the repository releases the way it does and *how*
the pipeline behaves end to end. It is the rationale layer; the step-by-step
commands live in `dsh-next-release` and `docs/publish-prep.md`.

## Why changesets, and the Version Packages PR

The repository releases with [changesets](https://github.com/changesets/changesets),
the dominant tool for team-based open-source monorepos (used by Vite, Wagmi,
shadcn/ui, and the Backstage ecosystem). It is chosen over the two common
alternatives:

- **semantic-release** derives version bumps from Conventional Commit *messages*
  (`feat:`/`fix:`/`BREAKING CHANGE:`) and publishes hands-off with **no** PR. It
  trades the human-reviewed changelog for zero interaction, and it is a poor fit
  for per-package monorepos where several packages logical version independently.
- **release-it** is an interactive CLI that bumps `package.json`, writes the
  changelog, tags, and publishes in one manual step. It puts version and
  changelog editing back in human hands, which is the error-prone part changesets
  was built to remove.

Changesets instead makes the version bump a **reviewable artifact**: a developer
writes a prose change file describing what changed, and a bot turns those files
into a single commit that a human blesses before anything ships. The "Version
Packages" PR *is* that blessing step — it is the mechanism, not incidental
overhead. Removing it and releasing directly on a `package.json` version bump
would reintroduce hand-edited changelogs while also deleting the only place a
human reviews what goes to the public `@dsh-next` scope.

## The trigger

The release workflow (`.github/workflows/release.yml`) runs **only on a push to
`main`**. Its behavior on each push depends on whether pending change files
exist:

| State on the `main` push               | What the action does                                            |
| --------------------------------------- | -------------------------------------------------------------- |
| Pending `.changeset/*.md` files exist   | `changeset version` bumps + writes CHANGELOGs, opens/updates the "Version Packages" PR |
| No pending change files, versions new to registry | `changeset publish` publishes + creates GitHub Releases + per-package tags |
| No pending change files, nothing to publish | No-op                                                       |

`pull_request` events do **not** trigger the release workflow (only the CI
gate). Merging a feature PR into `main` is the trigger; opening it is not.

## One PR covers every pending package

The Version Packages PR is **repo-wide, not per-package**. When it opens, it
contains the version + CHANGELOG changes for *every* package named by *any*
pending change file at that moment — e.g. `notifier 0.1.0→0.1.1` and
`skills 0.1.0→0.2.0` in a single diff. A later feature merge with more change
files **updates the existing PR** rather than opening a second one. Packages
with no pending change file (including `"private": true` packages) are not
touched.

## The end-to-end sequence

```
feature PR carrying .changeset/xyz.md merges to main
   │
   ▼
push to main fires release.yml
   │
   ▼
changesets/action sees pending change files ──▶ changeset version
   │                                              (bump + write CHANGELOGs)
   ▼
opens/updates the "Version Packages" PR   ◀── bot (github-actions)
   │
   ▼
a human reviews and merges the PR
   │   (version/CHANGELOG commits now on main; change files consumed)
   ▼
push to main fires release.yml again (no pending change files)
   │
   ▼
changeset publish ──▶ npm (new-on-registry versions) + GitHub Releases + per-package git tags
```

The PR is authored by the `github-actions` bot, which is why the repository
needs "Allow GitHub Actions to create and approve pull requests" enabled.

## Git tags

Releases push a per-package git tag (`<npm-name>@<version>`, e.g.
`@dsh-next/dsh-next-notifier@0.1.0`). These are additive metadata for the
GitHub Release diff UI, not the release source of truth (that is the npm
registry version). Tags are created only by the pipeline; see
`docs/publish-prep.md` → "Git tags" and "Tag rules" for the naming and usage
constraints.

## Canary / prerelease channel

Snapshot prereleases publish under a dist-tag (default `canary`) without
touching the stable `latest` tag; see `docs/publish-prep.md` → "Canary
(snapshot) prereleases" and `.github/workflows/canary.yml`.
