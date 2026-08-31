# cc-plugins: portable workspace targets in the settings mirror

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-cc-plugins

Follow-up to the settings mirror: workspace install targets wrote absolute
paths, which do not travel between machines. The mirror now writes only the
folder name (`workspace:web`), and reconcile resolves names against the
importing machine's workspace registry.

- `encodeTarget` renders the workspace path's basename;
  `classifyMirrorTarget` replaces `decodeTarget` and classifies three
  forms — `global`, `workspace:<name>` (portable), and
  `workspace:/abs/path` (the previous form, still accepted for
  hand-written files and exactness).
- Reconcile resolves name-form targets through an injected
  `resolveWorkspace(name)` (host entry: `ctx.get('workspaceRegistry')`,
  read at call time since the registry may activate after this plugin;
  exactly one registered workspace whose folder name matches resolves,
  ambiguity or absence skips the target with a note). Path-form targets
  keep the local-existence check.
- New devDep `@deepseek-ai/dsh-workspace` (type-only import declares the
  `workspaceRegistry` service on Context).

## Verification

250 tests across 15 suites (was 249): encoding/classification unit tests,
the write-through expectations now assert folder names, and a reconcile
test resolving `workspace:web` through an injected resolver while an
unknown `workspace:ghost` skips with a note and the resolved install
lands in the registry-mapped path.
