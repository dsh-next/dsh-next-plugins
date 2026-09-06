# CI: derive workspace browser before typecheck; pin DSH 0.1.2-rc.1

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-worktrees, .github/workflows

`src/generated/` is gitignored, and CI typechecks before build with
`--ignore-scripts`, so `tsc` could not see the derived workspace browser.
`typecheck` now runs derive first. plugin-mount/release installed
`dsh@0.1.1-rc.2` while the plugin requires `>=0.1.2-rc.1`; both workflows
pin `0.1.2-rc.1`.
