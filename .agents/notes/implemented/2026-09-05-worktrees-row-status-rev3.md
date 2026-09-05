# Worktrees row status at a glance (rev 3)

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-worktrees

Revision 3 of the sidebar UX spec
(docs/ideas/dsh-next-worktrees-sidebar-ux.md): the worktree icon becomes
the status surface, text leaves the row, and the create modal is removed.
Driven by the user's live examination of the dev server (screenshot showed
"merged" on a worktree that was never merged).

## What shipped

- **Merged discriminator fix.** `worktreeStatus` now takes `tipEqualsBase`;
  merged requires `mergedIntoTarget && !tipEqualsBase`. A zero-commit
  branch is trivially an ancestor of the base, which is why every fresh
  worktree read as merged. The same fix guards the merge preflight's
  `already-merged` blocker (fresh worktrees stay mergeable).
- **New git port method** `revParse(cwd, ref)` over
  `rev-parse --verify --quiet <ref>^{commit}`.
- **Icon colors** via `data-dshx-state` on the identity span: green merged,
  amber dirty, blue ahead, neutral clean (tokens `state-success-primary`,
  `state-warn-primary`, `state-business-primary`). Red is reserved for the
  future conflict state. The ahead count is the only text left on the row.
- **Create modal removed.** `runCreateFlow` takes the repo cwd and sends
  no `name` (the host suggests); a `creating` store flag guards re-entry
  and the guard releases with a rethrow on failure. `ModalKind` dropped
  `'create'`; the create-modal store slice, `CreateModal`, and the
  `create.nameLabel`/`nameHint`/`confirm` keys are gone.
- **Hover facts.** New bridge method `worktreeFacts(decoration)` returns
  three localized lines (title, branch, status); a new seam injects them
  into the official `SessionHoverContent`, and the identity span's native
  `title` carries the same facts. `IconRefreshOutline` (from
  `ui-primitives`, already an external) decorates the Refresh menu item.

## Seam count and mechanics

Seam set grew 11 -> 12: the identity-helper seam was rewritten (icon +
ahead count only, `dshNextWorktreesState` priority helper,
`dshNextWorktreesHoverRows`) and a new "session hover worktree facts"
seam appends the fact rows inside the official hover card. All needles
verified against the pinned bytes; the hash gate still fails closed.
Editable-menu icons ride the same `Icon*16` primitives the official rows
import, so no new externals were needed.

## Platform facts worth keeping

- `@deepseek-ai/dsh-client-ui-primitives` exports the full icon set
  (~60 glyphs); the 14 icons in the derived workspace bundle are only
  what the official client itself uses. Our own seams and modal code can
  import any primitives icon directly.
- Alias tokens include `state-success-primary` and `state-warn-primary`
  (plus `-warning-` spelling) — enough for status colors without
  inventing hex.
- The official `SessionHoverContent` is a stable seam site: its
  `!node.blank && hoverTime` block is unique in the gated source.

## Follow-up: removal leaves host-truth orphans (same day)

Live testing found two consequences of the host registry holding a real
workspace per worktree:

1. **Delete left the workspace behind.** After `remove`, the topology
   stopped listing the worktree, the projection un-hid its workspace,
   and it rendered as a regular workspace folder. Fix: the delete modal
   and the merge-done cleanup now archive the worktree's sessions and
   delete its workspace through the stock service face
   (`workspaces.archiveSession` / `workspaces.delete` — the exact calls
   the official browser's own delete drives) after the git removal
   succeeds. Note the method is `delete`, not `remove`; a first pass
   using `remove` failed silently at runtime.
2. **Create could flash a separate folder.** Hiding depended on the
   topology pull listing the new worktree; on a miss the worktree
   workspace stayed visible. Fix: the projection now hides by the
   `/.dsh/worktrees/` path marker alone (structural rule) and uses the
   topology only to enrich rows with the identity decoration.

The decorations now carry `workspaceId` + `sessionIds` for the cleanup;
the e2e marker asserts the sidebar treeitem count drops by exactly the
worktree row across delete (no lingering folder).

## Validation

`mise run ci` green (117 worktrees tests; new cases: fresh-worktree status
and preflight, create re-entry guard, worktreeFacts forwarding). E2E
marker rewritten for the modal-free flow and asserts
`data-dshx-state="clean"` on the fresh row. Screenshot refreshed.
