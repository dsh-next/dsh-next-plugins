# npm publish failed: prepare ran tsdown without derive

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-worktrees, .github/workflows/release.yml

Version Packages merged, then `changeset publish` ran `prepare: tsdown` on a
CI tree installed with `--ignore-scripts`. `src/generated/` is gitignored, so
tsdown exited 1 and 0.1.0 never reached npm. `prepare` is now the full build
(derive + tsc + tsdown). release.yml builds before publish. The next main
push retries unpublished 0.1.0 (no new changeset).
