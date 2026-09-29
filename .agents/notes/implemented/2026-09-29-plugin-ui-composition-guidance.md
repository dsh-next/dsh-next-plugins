# Keep plugin UI composition guidance consistent

- date: 2026-09-29
- status: implemented
- scope: .agents/skills and docs/package-structure.md

Added the canonical browser UI composition and behavior-preserving refactor guidance to [package-structure.md](../../../docs/package-structure.md#browser-ui-composition). The coding, design, and code-review skills now direct future plugin work to that owner, distinguish focused verification from the full `pnpm run ci` gate, and no longer require entrypoint edits when a change does not affect wiring. The Git panel reorganization motivated this guidance; no plugin behavior changed in this update.
