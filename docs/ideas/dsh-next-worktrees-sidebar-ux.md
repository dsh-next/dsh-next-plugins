# dsh-next-worktrees — owned-browser sidebar UX (design spec)

- date: 2026-09-05
- status: implemented through revision 3; commits to strategy B (full nesting).
  Agent-resolved landing is 0.1.0 — see
  [dsh-next-worktrees-0.1.md](dsh-next-worktrees-0.1.md). Foreground/Return
  stays parked.
- supersedes: the M1 composer Isolated toggle and session-header chip (both
  removed), and revision 1's sidebar-foot popover (dropped — the owned
  browser makes it redundant)
- companion doc: [dsh-next-worktrees.md](dsh-next-worktrees.md) (product
  one-pager). Next milestone:
  [dsh-next-worktrees-0.1.md](dsh-next-worktrees-0.1.md).
- decisions locked with the user 2026-09-05: full nesting (B); create modal
  prompts for a worktree name; "you are here" is a persistent selected tint;
  git-branch glyph; nested worktree rows indent one step deeper than the
  repo's own sessions; repo-row worktree button is a quiet icon (no count
  badge); disabled-plugin fallback title is `<repo> / <slug>`; conflict
  handling is abort-to-manual now, with agent-resolved "update from
  main" as the 0.1.0 milestone (not fast-follow — see
  [dsh-next-worktrees-0.1.md](dsh-next-worktrees-0.1.md)); **one session per worktree — every worktree-icon click
  creates a new worktree session; folder-grammar sub-rows and "new
  session here" dropped permanently**; **full rebuild from scratch — M1
  code and tests deleted** (user decision, superseding the
  keep-the-engine recommendation, to keep the agentic development
  surface clean); **rev 3 (2026-09-05): the Name modal is gone — one
  click auto-names; the worktree ICON is the status surface (green
  merged / amber dirty / blue ahead / neutral clean, red reserved for
  conflicts); the "merged" text badge and the row's worktree title are
  removed; hover-card facts extend the stock session tooltip; Refresh
  carries IconRefreshOutline**

## Verified platform facts (DSH 0.1.2-rc.1)

Everything below was checked in the installed checkout
(`node_modules/@deepseek-ai/dsh/node_modules/`), not assumed:

1. **The stock sidebar tree is flat and closed.** `dsh-client-ui-workspace`
   derives the browser from the Host's flat workspace list
   (`deriveGroups`, `lib/types/client/tree.d.ts`): one top-level group per
   workspace, sessions under it. The browser's only slot is
   `sidebar.workspaces.directoryFlow`. No plugin can nest rows or inject
   rows through slots.
2. **Row controls are hardcoded.** The chevron, the `...` row menu, and the
   per-row `+` are composed inside the WorkspaceBrowser renderer from fixed
   owner actions. There is no per-row action slot.
3. **The sidebar foot is open but no longer needed.** `sidebar.footer.action`
   is a real list slot (beside Settings), and third-party slot registration
   is proven by this plugin's M1 entries — revision 1 built on it; the
   owned browser obsoletes that plan.
4. **Ordering and titles are scriptable.** The workspace client service
   exposes `rename`, `delete`, `insertBefore`, `create`, `list`.

## Incumbent study: wloops/dsh-git-worktree (inspected 2026-09-05)

Facts below come from reading its source, not its README:

1. **It replaces the stock workspace browser.** Its `cordis.patch.yml`
   sets `disabled: true` on the `ui-workspace` loader row and registers
   itself in the same slot set. A build script
   (`scripts/workspace-sidebar-upstream.mjs`) reads the installed
   `@deepseek-ai/dsh-client-ui-workspace/client` source, gates it on exact
   version and SHA-256, and applies about twenty exact-string seams to
   derive a decorated copy (locale rows, group/session metadata
   pass-through, row decoration components, drag and menu suppression).
   Derivation fails closed on any drift; a CI script re-checks the gate.
2. **The official Browser is wrapped, not rewritten.** The decorated
   module's `apply` runs under a context proxy that intercepts the
   `sidebar.workspaces` registration and wraps the official component.
   The wrapper feeds it a **projected view**: managed sessions carry
   `__dshGitWorktree` metadata rendered as a branch icon plus a state
   badge inline on the session row; managed workspace rows are flagged
   protected, which hides the stock `...` menu, the `+` button, and drag;
   fork disappears from managed session menus; hover cards gain a
   worktree status line.
3. **It does not nest** — managed worktrees register one Host workspace
   each, exactly like our M1; the sidebar stays flat and it brands rows
   instead. The projection wrapper is nevertheless the complete recipe
   for nesting: whoever controls the projection controls membership.
4. **Creation has no name prompt.** The create request carries only the
   source session id; the pre-session entry intercepts the send of a
   non-empty draft and moves the typed text and attachments into the new
   worktree session.
5. **The delivery state machine drives the badges.** States ride a
   host-side projection (`sidebarTopology`), a read-only aggregation RPC
   consumed by the sidebar wrapper.

## Recommended direction: own the browser, project the tree

Disable the stock `ui-workspace` loader row in our `cordis.patch.yml` and
ship a build-time derived, version-and-hash-gated decorated copy of the
official client (the incumbent's mechanism, independently derived against
our own seam set). The derived module registers the full official stack
(locale, stores, picker, directory-flow) and wraps only the Browser
component with a projection. What the user sees:

```
v repo/                    [...] [+] [⑂]        <- workspace row: stock controls + worktree button
    fix login race                              <- repo's own session rows (stock)
      ⑂ login-race fix   (dirty, +2)            <- worktree session row: branch identity,
      ⑂ docs sweep       (clean)                   one indent deeper, own "..." menu
ungrouped / other repos                     <- untouched stock behavior
```

- Worktree workspace groups vanish; each worktree session renders as a
  **session row under its repo's group** with a branch-icon identity
  (title, dirty/ahead/merged status), one indent deeper than the repo's
  own sessions. This IS the shipped grammar.
- **One session per worktree (decided 2026-09-05, superseding the folder
  grammar): every click of the repo-row worktree icon creates a NEW
  worktree session** — new slug, new branch, new checkout, one bound
  session. Folder-grammar sub-rows (chevron, own `+`/`...`, nested
  sessions) and "new session here" are dropped permanently: a fresh
  context means a new worktree, so the rare multi-session cluster the
  folders would have organized is never created. The registry's
  tolerance for multiple rows per slug stays as data-model robustness,
  not a UX offer.
- The repo row keeps its stock controls and gains our quiet worktree
  button beside `+` (seam-injected, same geometry, no count badge),
  opening the create modal.
- The worktree session row's `...` menu is the management surface
  (facts/Refresh/Merge/Delete below). Fork and drag are suppressed on
  these rows — reordering or forking a re-parented session would address
  the wrong workspace account.
- Hover cards show worktree facts (branch, base, dirty/ahead).
- Flat-list mode, search results, and the Ungrouped bucket consume the
  same projection, so worktree sessions appear correctly everywhere the
  stock browser lists sessions.
- The "you are here" signal is the persistent selected tint on the open
  worktree session's row; no in-conversation worktree UI exists at all.

### Worktree session row `...` menu (decided 2026-09-05)

```
swift-01 — login race fix
Branch   dsh-worktrees/swift-01          <- facts block: 12/18 caption,
Base     origin/main                        label-secondary, non-interactive
Path     <repo>/.dsh/worktrees/swift-01
Status   dirty, 2 ahead
────────────────────────────────────────
Refresh                                  <- re-run git facts + reconcile
Update from <branch>…                    <- 0.1.0: merge primary into worktree
Merge…                                   <- guarded one-click landing (below)
────────────────────────────────────────
Delete worktree…                         <- danger modal: states what survives,
                                            dirty needs "Remove anyway"
```

Decisions: facts block stays in the menu (hover card keeps glance duty);
the copy items are gone —
Merge performs the landing for real, and the copyable-command recipe
retires to the README as the manual fallback. Reserved between Refresh
and Merge: **Update from `<branch>`…** (0.1.0 agent-resolved landing).
Foreground/Return is parked.

#### The Merge action (guarded one-click landing)

Decided 2026-09-05; supersedes the one-pager's "landing stays manual git".
The plugin gains exactly one new write to the user's branch: a
preflighted `git merge --no-edit` of `dsh-worktrees/<slug>` into the
primary checkout's current branch. Yes, it needs a modal — it is the most
dangerous operation in the plugin — but a preflight-confirmation modal,
not a form:

- Target and source named (branch names), commits-ahead count, and
  whether the merge will fast-forward or create a merge commit.
- Preflight gates, all of which block with copy naming the fix (the M1
  blocker grammar; the Merge button stays disabled until green):
  - primary checkout clean (uncommitted changes → commit or stash first);
  - worktree branch fully committed (dirty worktree → commit in the
    worktree session first — uncommitted work would not be merged);
  - no session running in the worktree (one-writer invariant; stop or
    wait);
  - conflict dry-run via `git merge-tree --write-tree` (git >= 2.38):
    conflicts → the modal states it, offers the manual command to copy,
    and (fast-follow, below) the agent-resolved path. The plugin never
    resolves conflicts in this milestone and never leaves a mid-merge
    state.
#### Conflict resolution strategy (decided 2026-09-05)

No hand-built merge editor, ever. Three reasons: DSH ships no editor or
diff primitives to build on (we would be authoring a text editor inside a
sidebar plugin); it duplicates mature tooling the user already owns
(`git mergetool`, VSCode, `$EDITOR`); and writing resolutions into a
mid-merge index is precisely the largest data-loss surface this product
refuses to own. The ladder instead:

1. **Now — abort to the user's own tools.** Conflict preflight blocks the
   merge, the modal shows the exact command (copyable) and confirms
   nothing was touched. After the user resolves and merges manually, the
   next refresh sees the branch merged and offers cleanup.
2. **Fast-follow — the agent resolves, in the worktree.** The direction
   flip: instead of merging the worktree branch into the primary
   (conflicts would land in the user's checkout), offer "Update from
   `<branch>`": merge the primary's branch INTO the worktree branch,
   inside the worktree — where the session, the sandbox knob, and the
   work already live. The session's agent resolves the conflicts and
   commits; after that, merging the worktree branch into the primary is
   a fast-forward by construction, so the one-click Merge turns green
   with zero conflict risk to the checkout. This is the DSH-native
   version of a merge editor: the resolver is an agent, not a three-pane
   diff widget.
3. **Never — a plugin-owned three-way merge UI.**

Degradation: git < 2.38 still explains and shows
`git merge dsh-worktrees/<slug>` for manual landing. A conflict
preflight no longer dumps a CLI recipe — the primary action is
Update from the current branch (agent-resolved landing).
- On success the modal offers cleanup ("Merged into `<branch>`. Remove
  the worktree?" — Keep it / Remove worktree), reusing the delete flow;
  this is the user-driven half of the M3 sweep idea.

### Copy and locale (en key source; zh mirror in the same change)

| Key | Copy |
| --- | --- |
| `row.facts.branch` / `.base` / `.path` / `.status` | Branch / Base / Path / Status |
| `row.refresh` | Refresh |
| `row.merge` | Merge… |
| `row.delete` | Delete worktree… |
| `row.newSession.aria` | New session in this worktree |
| `merge.title` | Merge worktree |
| `merge.summary` | Merge `dsh-worktrees/<slug>` into `<branch>` |
| `merge.ff` | Fast-forward (no merge commit) / Creates a merge commit |
| `merge.blocker.dirtyPrimary` | The main checkout has uncommitted changes. Commit or stash them first. |
| `merge.blocker.dirtyWorktree` | The worktree has uncommitted changes. Commit them in the worktree session first. |
| `merge.blocker.running` | A session is running in this worktree. Stop it or wait for it to finish. |
| `merge.blocker.conflict` | Merging would conflict. Resolve in this session first; then Merge is a fast-forward. |
| `merge.resolve` | Resolve in this session… |
| `update.resolve` | Resolve in this session |
| `merge.blocker.oldGit` | git 2.38 or newer is required for one-click merge. Run `git merge dsh-worktrees/<slug>` manually. |
| `merge.done.title` | Merged into `<branch>` |
| `merge.done.cleanup` | Remove the worktree? |
| `merge.done.keep` | Keep it |
| `merge.done.remove` | Remove worktree |
| `delete.confirm.*` | M1 danger grammar, unchanged |
| `hint.gitignore` | M1 copy, relocated under the repo row |
| `error.rpc` | M1 copy, unchanged |

### Status at a glance (rev 3, decided 2026-09-05)

The create modal is gone and the row's status moved from text to color:

- **Create has no modal.** One click on the repo-row branch button runs
  worktree -> workspace -> session -> bind -> open with the host-suggested
  name (the client sends no `name`; the host owns the suggestion). A
  `creating` flag guards re-entry. Rename-in-menu is the recorded escape
  hatch if auto-naming proves wrong (Not Doing for now).
- **The branch icon is the status.** First match wins: green
  (`success-primary`) merged, amber (`warn-primary`) dirty, blue
  (`business-primary`) ahead with the count beside it, neutral clean. Red
  (`error-primary`) is reserved for the future conflict state — never
  rendered in rev 3. Behind-base is Not Doing (needs fetch to be honest).
- **Merged discriminator (bug fix).** Ancestry alone reported fresh
  worktrees as merged (a zero-commit branch is trivially an ancestor).
  Merged now requires the branch tip to differ from the base tip; the
  same fix guards the merge preflight's `already-merged` blocker.
- **Text is gone from the row.** No worktree title, no status words, no
  "merged" badge — the ahead count is the only number. Identity and
  details live in the hover card.
- **Host-truth cleanup on remove.** Deleting a worktree also archives
  its sessions and deletes its host workspace (the stock `archiveSession`
  + `workspace.delete` service calls, the same ones the official
  browser's own delete drives). Without this, the worktree's registered
  workspace lingered as a regular sidebar folder once the topology
  stopped listing it. Applies to both the delete modal and the
  merge-done cleanup.
- **Structural hiding.** The projection hides any workspace whose path
  sits under `/.dsh/worktrees/` by path marker alone — no topology
  answer required — so a freshly created worktree never flashes as (or
  lingers as) a separate workspace folder; the topology pull only
  enriches rows with the identity decoration.
- **Hover card extension.** The stock session hover card gains three
  localized fact lines (title, branch, status) injected through the
  `worktreeFacts` bridge method; the identity span's native `title`
  attribute carries the same facts for the icon itself.

## Rebuild scope (decided 2026-09-05: from scratch)

The M1 package is deleted in full — source, client, and tests — and
rebuilt against this spec. The M1 design decisions that remain binding
are the ones recorded in the one-pager's locked list (path/slug/branch
rules, sandbox knob, registry reconcile, invariants); the M1 *code* is
not reused. Rationale recorded for honesty: the engine-keep option was
recommended and declined; a clean tree is worth more to agentic
development than salvaged plumbing.

## Hidden assumptions to validate (probe before the UI work)

- [ ] The derived module registers cleanly when the stock row is disabled
      in a real mount — the incumbent proves the shape, we must prove our
      own seam set boots without double-registration errors.
- [ ] The projection can rewrite workspace membership (`sessionIds` move
      into the repo item, worktree items dropped) without confusing
      `deriveGroups`, `deriveFlat`, or `deriveSearchResults` — pure
      function tests first, then live.
- [x] The row renderer can host a synthetic sub-group level — moot:
      the one-session-per-worktree decision (2026-09-05) dropped the
      folder grammar, so no third tree depth is built at all.
- [ ] Seam-injecting a button beside `+` and items into the session menu
      renders and behaves (the incumbent only removed/hid; adding needs
      its own seams).
- [ ] Removing a worktree archives nothing and breaks nothing: after
      `remove`, the bound session's row degrades to a normal row (its cwd
      is gone) — acceptable, documented.
- [ ] `git merge-tree --write-tree` dry-run semantics behave as expected
      on the supported git range (conflict detection without touching
      tree or index), and the version gate (git >= 2.38) degrades the
      Merge item to the manual command cleanly.
- [ ] Two DSH bumps' worth of seam drift is a tolerable maintenance
      cadence in practice (the incumbent's gate suggests yes).

## Maintenance contract (the price of B, accepted)

- The plugin pins the exact `@deepseek-ai/dsh-client-ui-workspace` version
  and SHA-256; derivation fails the build on drift, and a CI script
  re-checks it on every DSH release.
- Every DSH release that touches the workspace client requires a seam
  re-derivation release of this plugin before it works on that DSH.
- The plugin is incompatible with any other browser-owning plugin
  (including wloops/dsh-git-worktree): both disable the same loader row.
  README states this in the install section.
- There is no stock fallback at runtime: the patch disables it by
  definition. The build gate is the safety mechanism, and version
  capping keeps mismatched pairings from installing silently.

## Testing impact

- Unit: projection is a pure function over (workspaces, sessions,
  topology) — exhaustive tests for grouping, flat, search, suppression,
  badge metadata; menu item gating (idle, dirty, degraded); name
  validation and slug/title split; merge RPC — fast-forward, merge
  commit, conflict abort, dirty-primary blocker, dirty-worktree blocker,
  running-session blocker, old-git degradation.
- Mount e2e: repo row worktree button, create modal with Name, nested row
  with badge, row menu actions, merge flow (green path plus a conflict
  blocker), remove flow, reconcile after external deletion. Existing
  fixtures (seeded workspaces, dialog suppression) carry over; toggle/chip
  markers are deleted.
- Live gate: `mise run ci`, `mise run e2e`, then a `mise run dev` pass
  with screenshots in light and dark; keyboard pass for the injected
  button and menu.

## Not Doing (and Why)

- Sidebar-foot popover (revision 1) — the owned browser makes a parallel
  tree redundant; every action lives where the user already looks.
- Keeping any composer entry (toggle or send-interception) — decided
  against; creation is a sidebar action.
- Rewriting the host engine — kept deliberately; see the table above.
- Delivery-state badges, foreground/return — parked (2026-09-05). The
  reserved row-menu slot between Refresh and Merge is now
  **Update from `<branch>`…** (agent-resolved landing). Foreground stays
  off the 0.1.0 board; see
  [dsh-next-worktrees-0.1.md](dsh-next-worktrees-0.1.md).
- Settings registry card — remains later (was M3).

## Open questions

Owned-browser forks are decided (see the decisions line in the header).
Agent-resolved landing is recorded in
[dsh-next-worktrees-0.1.md](dsh-next-worktrees-0.1.md). Parked follow-ups
(Foreground/Return, setup-commands, settings card) live in the product
one-pager.
