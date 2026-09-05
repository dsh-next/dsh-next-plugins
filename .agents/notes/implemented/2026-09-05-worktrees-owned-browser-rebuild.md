# Worktrees owned-browser rebuild

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-worktrees

The M1 implementation was deleted in full (source, client, tests) and the
plugin rebuilt from scratch against the owned-browser UX spec
(docs/ideas/dsh-next-worktrees-sidebar-ux.md, revision 2). The user
overrode the keep-the-engine recommendation for a clean agentic
development surface; the binding M1 design decisions live in the
one-pager, not in salvaged code.

## What shipped

- Derivation infrastructure: scripts/derive-workspace-browser.mjs reads
  the official `@deepseek-ai/dsh-client-ui-workspace` client from
  node_modules at build time (the DSH checkout is never touched), gates
  it on exact version plus SHA-256, applies 12 exact-once seams, and
  materializes a module that runs the official factory body against the
  loader-provided `require` (no static imports — the shared preset's
  purity gate forbids module-table value imports; rolldown binds the
  body's requires to the factory parameter, verified in the emitted
  bundle). `check:browser` re-runs the gate for CI; every build derives
  before bundling.
- Nesting projection (pure, tested): worktree workspace groups vanish,
  their sessions re-parent under the repo group with decoration metadata;
  a missing repo workspace keeps the worktree group (sessions never
  vanish); sessions never duplicate.
- Seams: session-node metadata pass-through (grouped + search), the
  branch-identity row (icon + title + status, one indent deeper),
  drag/fork suppression on re-parented rows, the repo-row create button
  beside `+` (bridge-gated per workspace), and the row-menu items plus
  dispatch (Refresh / Merge / Delete worktree).
- The window bridge (src/client/bridge.ts) is the single sanctioned
  channel between seam markup and plugin React code; the browser wrapper
  refreshes its canCreate facts after every topology pull.
- Modals (body-level React root, shell-modal chrome copied from the
  settings-general recipe — bg-layer-2, bg-mask-1, mask-blur,
  elevation-prominent, no fallbacks): create with a generated-suggestion
  Name field, merge with the full preflight grammar and the cleanup
  offer, delete with the M1 danger grammar and the armed force step.
- Host: fresh core (placement with insideWorktreesRoot so bind works from
  inside a worktree, slug/name split, registry reconcile with
  one-writer takeover, merge verdict with blocker priority) and the RPC
  set (preflight, suggestName, create+name, bind, status, remove,
  topology with per-workspace creation facts, merge/preflight,
  merge/execute).

## Facts worth keeping

- The webServer service face is `register({ kind: 'exact', path,
  handler })`; an invented `.post()` silently never registers and the
  shell answers 405. Caught live, not by types.
- The official client's `apply` needs its `inject` list re-declared by
  the registering plugin or Cordis refuses the undeclared `ctx.get`
  ("cannot get property remote without inject"). The entry unions the
  official list with its own service needs.
- One derivation needle differs from the wloops incumbent's published
  form (our deriveGroups site has no trailing comma): the hash gate is
  what makes such drift loud. Needles must be rebuilt from the pinned
  bytes, never copied from another repo.
- Stock rows hide actions on blank sessions; the e2e marker un-blanks
  the created session with one recorded (failing) send before driving
  the row menu.
- Legacy sidecar rows (the M1-era registry) degrade to slug titles: the
  loader defaults every field rather than poisoning the render.

## Evidence

117 unit tests, repo typecheck/build/docs/i18n green, mount smoke green
with the full create-nest-unblank-menu-delete loop through the real GUI
(13.2s), plus a live dev-profile probe confirming the topology RPC, the
per-row gating, and six M1-era worktree sessions rendering nested.
Screenshot: docs/screenshots/worktrees-nested-sidebar.png. The M2
fast-follow (agent-resolved update-from-main) and the folder-grammar
sub-rows remain future work per the spec.
