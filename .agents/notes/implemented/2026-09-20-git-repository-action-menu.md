# Git repository action menu

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

The header's three dots now open the native SDK Menu: Fetch and Push directly,
Branches → Create/Rename/Delete, and Stash → Save/Apply. Selecting a leaf opens
one 440px action dialog; the former tab strip and combined branch form are gone.
The existing repository-workspace DOM marker remains, with data-action identifying
the selected command. No additional Git operations or host behavior were introduced.

Action changes remount the form, preventing old inputs, confirmations, results,
or pending preview replies from leaking into another action. Request/checkout
mismatches are rejected before displaying approval. Existing host version checks,
non-force push semantics, busy guards and unmerged-branch acknowledgement remain.
All copy reuses existing English/Chinese dictionary keys. The repository name is
shown compactly, with its full path available as a tooltip.

## Design and verification

The SDK supplies menu typography, tokens, elevation, keyboard navigation and
pointer behavior. Its nested cards always open rightward, which clipped this
right-sidebar menu in the first browser screenshot. Scoped CSS opens only these
submenus leftward and preserves the SDK's 10px pointer bridge; at phone widths
they overlay the parent card. This placement adjustment is the only shell-pattern
deviation. There are no new colors or dependencies.

- Native menu and action-dialog unit coverage includes every leaf, independent
  forms, remount/reset, stale replies, keyboard selection, Escape, outside click,
  disabled behavior and the existing mutation safety tests.
- Git typecheck and build pass. `pnpm test` passes across all packages and
  repository scripts; Git reports 1,225 passing tests and one existing skip.
  The menu/dialog suites contain 44 passing cases.
- Git real-runtime E2E passes, including nested command selection, dialog fields,
  absence of tabs, viewport containment and all preexisting Git interactions.
- Light/dark screenshots were inspected under artifacts/testing/run-Z0OzgX.
  The cropped dark menu is documented in the bilingual package README pair.
- Documentation, locale and runtime-dependency checks pass.
- The full static gate and family mount smoke cannot complete: the unchanged
  cc-plugins host runtime has incompatible MessageId brands from dsh-llm
  0.1.2-rc.1 and 0.1.6-alpha.2. No unrelated dependency changes were attempted.

The existing GUI on port 3080 was not restarted or reinstalled. Runtime evidence
comes from the workflow-owned scratch Git runtime, not the user's current profile.
