# Consolidate worktree action validation

- date: 2026-09-08
- status: implemented
- scope: packages/dsh-next-worktrees

Follow-up simplification pass, preserving the existing dirty working tree.
Seven RPC handlers now share a private `requireWorktree` validator instead
of repeating cwd/slug extraction and rejection. Each handler stays async,
keeps its exact error message, and reads optional arguments only after
validation. Update verdicts group worktree-specific blockers under one
known-slug guard, preserving blocker order and in-progress suppression of
dirty-worktree. No UI, Git operations, or lifecycle behavior changed.

Added 91 RPC characterization cases and a verdict matrix covering all 576
combinations of six boolean facts and absent/empty/named source and target
branches. These passed against the pre-refactor implementation. Existing
assertions were not changed. These behavior-preserving refactors ship alongside
`.changeset/worktrees-safety-fixes.md`, without a separate changelog bullet.

## Validation

- Baseline: 418 tests passed. After each source refactor: all 510 tests passed.
- Package browser derivation, typecheck, declaration build, and tsdown passed.
- Standalone runtime dependency, docs, i18n, and whitespace checks passed.
- Root `pnpm typecheck && pnpm test && pnpm build` did not reach the checks:
  pnpm attempted dependency installation and stopped with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Dependencies were not reset.
- Mount smoke stopped before worktrees mounted: OAuth-provider installation
  rejected ignored build scripts for `@google/genai@1.52.0` and
  `protobufjs@7.6.6` (`ERR_PNPM_IGNORED_BUILDS`). The full smoke is not green.
- Independent read-only review approved both scoped refactors without required
  changes; its focused rerun passed 122 tests across three files.
- Existing Vite tsconfig-paths and React act warnings remain.
