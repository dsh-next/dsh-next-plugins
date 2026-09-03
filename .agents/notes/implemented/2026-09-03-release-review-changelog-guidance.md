# Release-process review and CHANGELOG guidance

- date: 2026-09-03
- status: implemented
- scope: repo (release process + docs)

Reviewed the changeset-driven publishing approach against industry practice and
fixed one defect; no workflow redesign was warranted.

- Fixed `.changeset/config.json` being checked in with mode `600` (owner-only).
  A private-mode config would break `changeset` in CI and for co-located
  contributors. It is now `644`; the release skill reminds agents to keep it
  that way.
- Confirmed the pipeline already matches the standard changesets pattern
  (`changesets/action@v1`: version on push to main, open "Version Packages" PR,
  merge publishes only new-on-registry versions with per-package GitHub
  Releases), so the design is sound: manifest `"private": true` as the
  publishability source of truth, per-package independent versioning,
  `verify-changeset.mjs` gating source changes on PRs, and the post-publish
  mount smoke keyed to the action's `published` output.
- Documented CHANGELOG authoring as a first-class rule (the change-file summary
  is the only human-authored text that reaches a package `CHANGELOG.md` and its
  GitHub Release note): Keep a Changelog conventions, user-visible framing,
  `**Breaking**` for breaking changes, no PR numbers/plumbing noise, no emoji.
  Added a `.changeset/README.md` guide; updated `AGENTS.md` (Release section),
  `docs/publish-prep.md` (new "CHANGELOG best practices" section), the
  `dsh-next-release` skill (bump-kind, entry-writing, and Version-Packages-PR
  review steps), and the `dsh-next-agent-coding` skill (record a change file
  alongside the Agent Note for publishable source changes).

Potential future improvements noted but not adopted: a custom changelog
formatter with external summary links, and snapshot/canary publishing for
pre-release dist-tags. None are needed at the current pre-1.0, three-plugin
scale and no-cross-dependency state; revisit when the family grows or a
plugin ships a v1 Stable.

Git tags resolution: `changesets/action` forces `push-git-tags: true` whenever
`create-github-releases: true` (which the repo uses), and `changeset publish`
itself creates git tags by default (`--git-tag`, default true). Discovered this
latent conflict with the repo's earlier "no git tags" stance. Decision: accept
the per-package `name@version` tags (e.g. `@dsh-next/dsh-next-notifier@0.1.0`).
They are additive metadata that powers the GitHub Release compare/diff UI and
are unambiguous per package version (unlike the old repo-wide `vX.Y.Z` that was
removed with the changesets migration). The npm registry version stays the
single source of truth; tags are never edited, deleted, or used for versioning.
Made this explicit in `release.yml` (`push-git-tags: true`), `docs/publish-prep.md`
("Git tags" section), and the `dsh-next-release` skill.

Follow-up in the same session (custom formatter + canary, decided "proceed"):

- Added `.changeset/changelog.mjs` (custom changelog formatter, wired via
  `"changelog": ["./.changeset/changelog.mjs", null]`) and dropped the
  changesets default, which prefixed every entry with a truncated git hash.
  The formatter emits clean human-first bullets; the `## x.y.z` headers carry
  no compare link (per-package versioning, no repo-wide tag). Verified end to
  end in a scratch clone that `changeset version` resolves it and writes clean
  entries.
- Added `.github/workflows/canary.yml` (manual `workflow_dispatch`, default
  `canary` dist-tag) that runs `changeset version --snapshot <tag>` then
  `changeset publish --tag <tag> --no-git-tag`, publishing each pending package
  as `0.0.0-<tag>-<timestamp>` under the chosen dist-tag without consuming the
  real change files or perturbing `latest`. Verified snapshot version shape
  (`0.0.0-canary-<timestamp>`) and that `--no-git-tag` negates the default
  (cac boolean negation) in a scratch clone.
- Updated `.changeset/README.md`, `docs/publish-prep.md` ("CHANGELOG best
  practices", "Git tags", "Canary (snapshot) prereleases"), and the
  `dsh-next-release` skill (formatter + tag facts, canary flow).

Tag hardening (final): locked the tag decision so it cannot regress. Added
`"release": "changeset publish --tag latest"` and
`"release:canary": "changeset version --snapshot canary && changeset publish
--tag canary --no-git-tag"` to the root scripts, and a "Tag rules" block to
`docs/publish-prep.md` (name is exactly `<name>@<version>` with no `v` prefix
and no repo-wide tag; tags only from the pipeline — never `git tag`,
`changeset tag`, or a bare `changeset publish`; canary pushes no tags). Wove the
same prohibition through `AGENTS.md` (Release section), the release skill, and
`.changeset/README.md`.
