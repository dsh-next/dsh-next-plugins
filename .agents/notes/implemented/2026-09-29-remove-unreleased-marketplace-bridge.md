# Remove unreleased marketplace bridge

- date: 2026-09-29
- status: implemented
- scope: packages, scripts, tests, documentation

Removed the private marketplace bridge and its package-specific browser suite, workflow registration, package documentation, review routing, and development notes. The Skills plugin no longer publishes its retired cross-plugin service; its generic external-skill ownership handling remains to protect any locally installed skills from accidental overwrite or deletion. Historical release records and separate worktrees remain untouched.
