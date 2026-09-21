# Keep one Git accordion open at a time

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

Opening Changes, Worktrees, or History now closes the other two sections.
Clicking the open section closes it, so all three can remain folded. History
still loads lazily and reuses an already loaded page. No changes to the header
action buttons or native keyboard controls.

Updated controller and panel tests to exercise the exclusive transitions;
content tests explicitly open their section instead of relying on all sections
being open. The existing E2E marker now opens each section before its actions
and checks that exactly one body is visible. README instructions mirror the new
behavior in English and Chinese and remove stale checkbox/menu guidance.

Validation: 131 controller/panel/History tests passed; Git build, README pairing,
documentation check, and diff whitespace check passed. E2E runtime verification
remains outstanding. No existing GUI installation or server was changed.
