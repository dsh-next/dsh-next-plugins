# cc-plugins either/or install scope with radio modal

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-cc-plugins, tests/e2e/mount.e2e.ts

## What

Replaced the multi-target install model (any combination of the global
root plus workspaces in one install) with an either/or scope, per user
request:

- The Add/Manage modal is now a scope modal: a radio picks **Global**
  (the default — skills land in the shared skills root this DSH home
  scans everywhere) or **Selected workspaces** (a checklist of the
  registered workspaces appears; skills land in each checked
  workspace's own `<workspace>/.agents/skills` root). The modes are
  exclusive: one install, one scope. Confirm is disabled in workspaces
  mode until at least one workspace is checked.
- For an installed plugin the same modal manages it: Save scope
  re-scopes (`setPluginScope` RPC — skill copies move between roots:
  added roots get fresh copies from an existing install copy via a local
  recursive copy, dropped roots' copies move to `.trash`; plugin-level
  rows untouched), Update refreshes, and Uninstall is a two-step confirm
  in the footer. Per-target uninstall rows are gone.

## Model

- `core/types.ts`: `InstallScope = { kind: 'global' } | { kind:
  'workspaces'; workspacePaths: string[] }`; `InstalledPlugin` carries
  `scope` + a flat `skills: InstalledSkillRef[]` (each ref's directory
  names its root). `InstalledTarget` and `TargetLike` are gone.
- `core/scope.ts` (new): `parseScope` RPC-argument validation (non-empty,
  deduplicated paths), `sameScope` order-insensitive comparison.
- `core/records.ts` (new, replaces `core/targets.ts`): record migration
  on read. Current shape passes through; the pre-scope `targets` array
  and the legacy single-scope trio fold in — a recorded global root wins
  (global covers every workspace; workspace-target copies become
  unmanaged leftovers on disk), a workspace-only record becomes a
  workspace scope over those paths. Any recognized install form keeps a
  skill-less record alive (MCP-, agent-, commands-, and hooks-only
  plugins install with `skills: []` — dropping those would silently
  unregister their commands/hooks, caught by the runtime spec).
- `core/mirror.ts`: installs mirror `{ marketplace, plugin,
  workspaces?: [folder names] }`; absent/empty workspaces means global.
  `parseMirror` honors legacy `targets` lists (`global` wins, otherwise
  workspace names become the set, absolute paths reduced to folder
  names). `classifyMirrorWorkspace` splits hand-written names from
  absolute paths.
- Host service: `installPlugin` takes a scope (one install per plugin —
  re-installs rejected with "update or re-scope"), `setPluginScope`
  diffs roots (collision in an added root rolls back atomically),
  `uninstallPlugin` is whole-plugin only, `updatePlugin` refreshes every
  root the scope spans, and reconcile resolves mirrored workspace names
  through the workspace registry **all-or-nothing** — one unresolvable
  name skips the whole plugin with a note rather than reshaping its
  scope. `resolveWorkspace` stays wired in `src/index.ts`.
- RPC: `installPlugin`/`setPluginScope` parse the scope; stale
  target-list payloads get an explicit error instead of a silent
  global install; `uninstallPlugin` ignores the old `target` argument.

## Client

- `CcPanel`: `getWorkspaces` dep retained; the modal renders the radio
  pair (`cc-scope-global` / `cc-scope-workspaces`), the checklist
  (`cc-workspaces` rows, including recorded-but-unregistered paths
  badged "not registered" so they can be unchecked), footer Save
  scope / Update / Uninstall+confirm (`cc-uninstall`,
  `cc-uninstall-confirm`). `presenceLabel` now renders the scope:
  "in global" or "in Project One, gone".
- Dictionaries: dropped `presence.workspace`, `modal.target.global`,
  `modal.added`, `modal.confirm`, `modal.updateEverywhere`,
  `modal.addTargets`; added `modal.scope.global`,
  `modal.scope.workspaces`, `modal.workspaces.hint`,
  `modal.workspaces.empty`, `modal.workspaceMissing`, `modal.save`,
  `modal.update`, `modal.confirmUninstall` (en + zh).

## Tests and docs

- `tests/scope.spec.ts` (new) and `tests/records.spec.ts` (replaces
  `targets.spec.ts`); `mirror.spec.ts`, `service.spec.ts` (scope
  installs, re-scope move/rollback/no-op, per-root update),
  `panel.spec.tsx` (radio flows, two-step uninstall, zh), and
  `rpc-contract.spec.ts` / `runtime.spec.ts` fixtures updated.
  345 tests pass.
- `tests/e2e/mount.e2e.ts`: the cc-plugins marker now drives the real
  scope modal — Global default (checklist hidden), install, card flips
  to Manage with the installed-version chip, manage re-opens on the
  current scope, two-step uninstall — before the marketplace removal.
- Bilingual README pair updated (install model, skills table, manage,
  mirror yaml with `workspaces:`, all-or-nothing import, migration
  note, settings UI); pairing re-recorded.

## Why either/or

The user's framing: DSH profiles already separate work environments
(each with its own home and configuration files), so the global root is
the sensible default and a workspace set is the only alternative worth
offering — never a mixture. The mid-task redirection (first "remove
workspace installs entirely", then this radio design) settled on
keeping workspaces as a scope choice with Global as the default.
