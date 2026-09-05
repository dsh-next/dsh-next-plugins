# Worktrees real-git fixtures and fuller e2e coverage

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-worktrees, tests/e2e

Host-side real-git fixtures (`tests/git-fixture.ts` +
`tests/host-service-git.spec.ts`) cover every merge/update execute path
and the blocker set FakeGit cannot prove: fast-forward, merge commit,
conflict abort-to-primary, dirty primary/worktree, already-merged,
already-updated, in-worktree conflict + abort, running/unbound session.

The Playwright marker now drives the same states through the GUI
(`tests/e2e/worktrees-helpers.ts`): hover facts, already-merged,
already-updated, dirty-primary, dirty-worktree on Merge and Update,
merge-commit + Remove, plus the previously covered FF merge, row-menu
Update, conflict CTA, Continue, and Abort. Still not in Playwright:
live-agent conflict resolution (keyless smoke), old-git, zh locale.
