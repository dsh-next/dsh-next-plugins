# Worktree clusters

- date: 2026-09-07
- status: implemented — nested named cluster under the harbor, git on
  the folder menu, extra sessions, invisible skill/cc-plugin inheritance
- scope: `packages/dsh-next-worktrees`, plus harbor matching in
  `packages/dsh-next-skills` and `packages/dsh-next-cc-plugins`
- companion: [dsh-next-worktrees.md](dsh-next-worktrees.md) (product),
  [dsh-next-worktrees-sidebar-ux.md](dsh-next-worktrees-sidebar-ux.md)
  (current session-row grammar; this doc supersedes its "one session per
  worktree", "folder grammar dropped", and "name modal gone" locks),
  [dsh-next-worktrees-0.1.md](dsh-next-worktrees-0.1.md) (merge loop;
  unchanged)
- compared: [vibeinging/dsh-worktree](https://github.com/vibeinging/dsh-desktop/tree/dev/packages/dsh-worktree)
  (stock sibling workspaces, git in footer overlay; no merge, no
  inheritance). Looked at, not copied.

## Problem Statement

How might we let someone running parallel agents treat a worktree as a
named folder of chats on the same project — git on the folder, skills
inherited, extra sessions without extra isolation — without turning the
sidebar into a second product?

## Recommended Direction

Keep owning the sidebar (Strategy B). Change the grammar from "special
session row" to a **cluster** nested under the harbor workspace:

```
v dsh-next-plugins                 [+] [⑂]
    fix login race
  v ⑂ auth-refresh                 [...] [+]
      session
      another chat
```

The cluster row uses the **branch glyph**, not a folder glyph. That icon
stays the status surface (clean / dirty / ahead / merged / conflict).
Chevron expands. `+` is stock "new session in this worktree." `...` is
stock **Rename**, then Refresh / Update from `{branch}`… / Merge…, then
one danger item: **Delete worktree…**. That last item replaces stock
**Delete workspace**, which would unregister the folder, leave the git
checkout, and dump chats into Ungrouped.

Create stays the repo `⑂`. It opens a one-field modal with an available
name suggested. The validated kebab-case name becomes the initial folder
title, the slug in `.dsh/worktrees/<name>`, and the branch suffix in
`dsh-worktrees/<name>`. Create stays disabled until the name is valid.

Session rows under the cluster go back to stock `...` (Rename / Fork /
Archive). Git leaves those menus.

**Invisible inheritance:** skills and cc-plugins never list the cluster.
A skill scoped to `dsh-next-plugins` still applies in the worktree
session. Runtime maps `/.dsh/worktrees/<slug>` to the harbor basename.
No `parent--child` names, no auto-ticking copies into settings.

Extra sessions are extra **chats**, not extra isolation. Hover on the
folder: title, branch, status, `N sessions, same files`. Merge/Update
block if **any** session in that folder is running.

This is not the vibeinging plugin. They use stock sibling workspaces and
put git in a footer overlay. We nest, we merge, we inherit. We still
wrap `ui-workspace` because the official tree cannot nest a group or
inject folder-menu items.

## Key Assumptions to Validate

- [x] **The official browser can render a non-session cluster row inside
      a harbor group.** Worktree workspaces stay real groups; `deriveGroups`
      output is nested under the harbor. Nested-under-repo is the product;
      sibling folders are not a ship target.
- [x] **`workspaces.rename` is enough for the display title** after
      create and from folder Rename. The initial title matches the path
      basename; later Rename changes only the display title, not the
      checkout path, branch, or create-time sidecar `name`.
- [x] **Folder `+` (`startSession` on the worktree workspace) creates
      another session in the same cwd** without a new git worktree.
      Extra sessions get the sandbox knob without stealing the bind.
- [x] **Skills / cc-plugins matching on harbor basename is correct** for
      session cwd inside `/.dsh/worktrees/`. Hide those paths from
      checklists. Existing scopes keep working with no settings
      migration.
- [x] **A first-time user will accept one extra Enter** on the name
      modal. Suggestion prefilled; clearing it disables Create.
- [x] **Two chats in one folder will not surprise people into parallel
      writes.** Copy on hover + running-session Merge/Update blocker is
      enough; no lock glyph in MVP.

## MVP Scope

One job: a named cluster of chats on one worktree, inherited project
identity, git on the folder.

**In**

- Name modal on repo `⑂` (available suggestion filled; validated name
  sets the initial display title, checkout folder, and branch suffix).
- Nested cluster row under the harbor (branch icon + status, chevron,
  stock `+`, extended `...`).
- Git commands move from session menus to the cluster menu. Session `...`
  is stock again.
- Stock **Delete workspace** is not shown on this row. **Delete
  worktree…** is the only danger item (existing modal: what survives,
  dirty `Remove anyway`, archive sessions, drop git checkout).
- Folder `+` / `startSession` for extra sessions. Registry one-writer
  for Merge/Update: any running session in the folder blocks.
- Skills + cc-plugins: hide `/.dsh/worktrees/` workspace rows;
  `isScopeEnabled` (and cc-plugin workspace match) resolve cwd to the
  harbor.
- Existing Merge / Update / setup / include / sweeper / sandbox bind
  stay.

**Out of this slice**

- Footer overlay, `conversation.view` tab.
- Collapsing worktree workspaces into the parent
  (`sessions.create({ cwd })` probe).
- `--` naming, auto-writing worktree names into skill scopes.
- Dual delete, named git branches, base-ref picker, push/PR.
- Folder grammar for anything except plugin worktrees.

## Not Doing (and Why)

- **Footer-only / stop replacing the sidebar** — cannot nest under the
  repo or put git on the folder `...`. Their plugin's model; the wrong
  product for this user.
- **Sibling worktree workspaces as the ship target** — faster, loses
  "this is a copy of *this* repo." Fallback refused.
- **`dsh-next-plugins--willow` as identity** — collides, breaks on
  rename, clutters checklists. Path marker is the protocol; title is
  just a label.
- **Keeping git on session `...`** — two chats, two Merge buttons, one
  tree.
- **Stock Delete workspace on the cluster** — silently orphans the
  checkout.
- **One-click create with no name** — rev 3; the folder is now something
  you read for weeks, so it gets a name. Rename remains the escape hatch.
- **Plugin-authored commits, merge editor, auto-stash** — unchanged
  invariants.
- **Fixing every 3rd-party plugin** — we hide/inherit in our scope UIs.
  Others still see a workspace until they adopt the path convention or
  we collapse workspaces later.

## Open Questions

- Exact seam for the cluster row: **child groups after `deriveGroups`**.
  Worktree workspaces stay in the store; the derived browser nests those
  groups under the harbor and paints the ProjectRow as a branch-icon
  cluster.
- Fork on a session under the cluster: **restored.** Sessions stay in
  the worktree workspace, so stock Fork is another chat in the same
  folder.
- Last session archived, folder empty: **keep the cluster** (reopen via
  `+`). The sweeper still removes never-started (blank-only) trees.
- Display title vs workspace `rename`: **`workspaces.rename` after
  create, and stock folder Rename.** Sidecar `name` is the create-time
  title; it is not rewritten on later Rename.
