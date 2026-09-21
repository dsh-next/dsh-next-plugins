# Keep Git History focused on the current checkout

- date: 2026-09-20
- status: archived
- scope: packages/dsh-next-git

Removed History's branch/tag, search, author, and date controls, query state,
query type, controller setter, RPC options, host filtering logic, filter CSS,
and English/Chinese filter strings. The existing header branch picker remains
the place to change branches. History keeps reload, graph rows, selection,
inspection/planning, and Load more; checkout changes clear selection while
pagination preserves it. The README pair now describes recent checkout history.

History reads accept only pagination limit/skip and an optional full commit-ID
anchor, not symbolic branch/tag selectors. The immutable anchor prevents new
commits from shifting subsequent pages. Tests also caught and fixed an exact
last-page boundary that incorrectly advertised more commits.

Coverage includes filter-free UI, selection reset, header branch-switch reads,
current/detached/linked checkout history, anchored pagination, invalid anchors,
RPC envelopes, and a strengthened existing E2E marker. No release changeset:
the Git package is private.

Validation: Git typecheck and build passed; all 44 Git test suites passed
(1,092 tests, one existing skip) with two workers. RPC inventory passed without
a timeout. Repository docs and i18n checks passed, and the removed query symbols
and dictionary keys have no remaining references. Diff whitespace check passed.
The repository-wide typecheck fails in the untouched cc-plugins host runtime
because installed dsh-llm versions disagree on branded MessageId types. The full
repository gate therefore remains incomplete. No running GUI was reinstalled
or restarted; E2E execution and new runtime screenshots are outstanding.
