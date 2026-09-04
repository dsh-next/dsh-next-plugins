# Changelog author attribution

- date: 2026-09-04
- status: implemented
- scope: .changeset

The changelog formatter now appends a linked attribution to each entry:
`([@user](https://github.com/user))` for the author of the pull request that
introduced the change file, resolved through the GitHub commit-PRs endpoint
from the commit that added the change file.

User-confirmed decisions:

- Linked inline attribution only — no "thank you, community contributors"
  footer. Rejected because it duplicates the inline credit, needs a custom
  version wrapper script in CI (the changesets formatter API has no per-version
  footer hook), and reintroduces commit-subject/PR-number plumbing the
  changelog rules exclude. GitHub Release pages already render a contributors
  section from the per-package tags.
- Direct pushes to `main` land unattributed — no commit-author fallback (the
  push-email-to-login lookup adds an API call and still fails for unlinked
  emails).

Mechanics and degradation rules live in `.changeset/README.md` (CHANGELOG
formatter section). Wiring: `.changeset/config.json` passes
`{ "repo": "dsh-next/dsh-next-plugins" }` to the formatter; `GITHUB_TOKEN`
comes from the changesets step in `.github/workflows/release.yml` (already
present, no workflow change needed). Attribution never blocks versioning: no
PR, no commit stamp, no token, or an API error all degrade to a plain bullet.

Branch coverage: `scripts/changelog-formatter.test.mjs` in the
`pnpm test:scripts` lane (resolved author, guards, no-PR direct push, API
failure, malformed payloads, multi-line summaries, dependency lines). Runtime
evidence: a throwaway change file ran a real `changeset version` end to end
(clean bullet without attribution, exit 0, formatter loaded by changesets);
the bumped version and changelog were then restored.
