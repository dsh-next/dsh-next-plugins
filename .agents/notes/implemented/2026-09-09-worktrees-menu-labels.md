# Show the merge destination in worktree menus

- date: 2026-09-09
- status: implemented
- scope: packages/dsh-next-worktrees

Remove trailing ellipses from the worktree context menu's Update, Merge, and
Delete labels. Merge now names the main checkout's current branch, not the
worktree source branch. Missing destination information uses a generic localized
Merge label; the existing preflight remains responsible for explaining detached
HEAD and other blockers. English and Chinese dictionaries follow the same rule.
No menu layout, styling, action, or confirmation behavior changes.

The production-bridge regression covers destination/source distinction, branch
switches, missing decoration, missing/empty destination, and both locales plus
English fallback. The real-mount marker asserts exact menu labels, switches the
primary checkout to a slash-named branch and back, and captures the menu for its
README image. Bilingual README copy and screenshot capture selectors are updated.

Validation: all seven packages pass typecheck/build and 1,636 tests, including
514 worktrees cases (29 files). The initial unbounded worktrees run hit
worker-start timeouts; the full suite passed with two workers. Documentation,
i18n, runtime-dependency, and whitespace checks pass. Runtime-dependency checking
uses a temporary Git index to accommodate the earlier unstaged sweeper deletion.

The full real-mount browser smoke passes in 39.4 seconds, including main to
release/menu and back, exact menu copy, and dark/light screenshots. The first
browser run exposed a test helper assuming the row icon remains visible during
hover; the helper now checks the usable row instead. The dark 1x crop replaces
media/menu.webp; no CSS changes were needed.

Installed the rebuilt local tarball into the existing web profile and compared
both installed bundles byte-for-byte with the tested build. Config composition
includes the worktrees plugin (and still warns about an unrelated stale
cc-plugins patch entry). The current GUI process was not restarted.
