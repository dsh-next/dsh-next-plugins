# Preserve compact plugin ownership

- date: 2026-09-29
- status: implemented
- scope: packages/dsh-next-opencode-session-patch, packages/dsh-next-decisions

Audited the small OpenCode host-only patch and the Decisions plugin against the current source-zone and browser composition rules. Both already have thin entry points and feature-owned implementations; further splitting would add pass-through modules. Consolidated the repeated Request-form check in the OpenCode patch and made Decisions response guards and save validation easier to read without changing their conditions or error handling. Both packages are private and need no changeset.
