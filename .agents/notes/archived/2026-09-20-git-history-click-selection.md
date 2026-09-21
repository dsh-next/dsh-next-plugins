# Simplify History selection and separate row actions

- date: 2026-09-20
- status: archived
- scope: packages/dsh-next-git

Per user clarification, normal clicks independently toggle commit selection.
Removed checkboxes, range anchors, and modifier-specific mouse/keyboard handlers.
The graph and text share a native toggle button with aria-pressed; Enter and
Space use native button activation. Pagination keeps selection, checkout changes
reset it, and the existing selection toolbar retains its topology safeguards.

Details is now a separate icon that opens the existing modal without changing
selection. Check out is icon-only and preserves its confirmation callback and
busy/operation restrictions. Both use localized native tooltips and accessible
names, remain keyboard reachable, reveal on hover/focus-within, and stay visible
on no-hover/coarse-pointer devices. Existing panel icon-button styling is reused.
The action space is reserved to avoid hover-induced text shifts.

Updated English/Chinese hints, removed obsolete labels, mirrored README changes,
and replaced checkbox/range tests with toggle/action-isolation coverage. The E2E
marker now covers normal-click multi-selection, native keyboard activation,
Details modal opening, and selection preservation; trailing alignment measures
the checkout action rather than the selection button.

Validation: Git typecheck/build passed; all 44 Git suites passed (1,093 tests,
one existing skip) with two workers. Documentation pairing/check, i18n check,
and diff whitespace check passed. Runtime screenshots and E2E execution remain
outstanding; no existing GUI installation or server was changed. The package
is private and requires no release changeset.
