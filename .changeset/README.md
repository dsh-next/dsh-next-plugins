# Changesets

This directory holds change files, one per intent, in the shape the
[changesets](https://github.com/changesets/changesets) CLI writes with
`pnpm changeset`. The release pipeline consumes them: on push to `main`,
`changeset version` bumps only the named packages, writes each package's
`CHANGELOG.md`, and opens the "Version Packages" PR; merging that PR publishes
the bumped packages and creates GitHub Releases from the changelog entries.

## Writing a change file

Run `pnpm changeset`, select the packages this change affects and the bump
kind, then write the summary. The result is a Markdown file like:

```md
---
"@dsh-next/dsh-next-notifier": patch
---

Fixed notification title truncation at 40 characters.
```

The summary becomes the verbatim body of the next `CHANGELOG.md` entry and the
GitHub Release note, so write it for the end user. Authoring rules:

- **Describe the user-visible effect**, not the implementation. "Added setting
  to silence approval sounds" is good; "Introduced a settings-scoped atomic
  flag" is not.
- **Put breaking changes first and mark them `**Breaking**`**, so they surface
  at the top of the changelog section. Use the standard Keep a Changelog group
  order — Added, Changed, Deprecated, Removed, Fixed, Security — when one entry
  spans several kinds.
- **No PR numbers, commit hashes, or plumbing noise.** The changelog is for
  users reading what changed, not a commit log.
- **No emoji**, per the repository rule.
- One entry can summarize several related changes; use a blank line and a
  `-` list only when the diff has genuinely separate user-facing effects.
- Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions:
  the changelog is generated (never hand-edited), entries are newest-first,
  and each version is a plain `## x.y.z` heading (no compare link — the family
  versions independently and does not use a single repo-wide tag).

## Bump kinds

- `major` — breaking change (public API, defaults, or settings schema that
  consumers must migrate for).
- `minor` — new backward-compatible feature.
- `patch` — bug fix.

Documentation-only changes need no change file (the CI gate exempts README and
manifest churn).

## Private packages

A package marked `"private": true` (currently `@dsh-next/dsh-next-cc-plugins`)
is not published: its changes merge with no change file, and it must **never**
appear in one. A changeset mixing a private package with a released one makes
`changeset version` fail. Remove `"private": true` from its manifest when the
package is ready to release.

## CHANGELOG formatter

`.changeset/changelog.mjs` is the custom changelog formatter wired by
`.changeset/config.json` (`"changelog": ["./.changeset/changelog.mjs", null]`).
It replaces the changesets default, which prefixes every entry with a truncated
git hash. The formatter emits clean, human-first bullets — the summary the
author wrote, with no plumbing noise. Only the per-entry bullets pass through
it; the `## x.y.z` version headers are emitted by changesets itself. Do not
re-add commit hashes there.

## Canary (snapshot) prereleases

`changeset version --snapshot <tag>` and `changeset publish --tag <tag>` produce
a temporary prerelease without touching the stable `latest` dist-tag: it
rewrites each pending package to `0.0.0-<tag>-<timestamp>`, publishes it under
`<tag>` (conventionally `canary`), and never consumes the change files for the
real release. The `.github/workflows/canary.yml` workflow runs this on demand
(prereleases push no git tags).
A plain `npm install @dsh-next/dsh-next-<slug>` still resolves the stable
`latest`; testers opt in with `npm install @dsh-next/dsh-next-<slug>@canary`.
