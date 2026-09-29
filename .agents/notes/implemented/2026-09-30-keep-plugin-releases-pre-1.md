# Keep plugin releases on 0.x

- date: 2026-09-30
- status: implemented
- scope: .changeset and dsh-next-release skill

The maintainer clarified that plugins must remain pre-1.0. Changed the five
pending major intents to minor intents without removing breaking-change
warnings or migration guidance. The [owning bump policy](<../../../.changeset/README.md#bump-kinds>)
and [release skill](<../../skills/dsh-next-release/SKILL.md#choosing-the-bump-kind>)
now require explicit maintainer approval before a plugin graduates to 1.0.0.

Changesets previews Notifications 0.3.0, OAuth providers 0.2.0, Skills 0.4.0,
and the unchanged Checkpoints patch 0.2.2. No package versions, generated
changelogs, runtime source, or previous plugin commits were rewritten.

Validated the pending release plan and releasable-package intent coverage.
This is a release-metadata and guidance correction; the preceding full static
and keyless browser gate remains the runtime evidence.
