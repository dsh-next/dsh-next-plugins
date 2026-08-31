# cc-plugins: shareable settings mirror in the DSH user-settings document

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-cc-plugins

The user asked for marketplaces and plugin installations to be reflected
in the DSH yaml configuration file the way model providers are — so one
file carries a whole shareable setup.

- **Section.** The plugin registers a `cc-plugins` namespace on the
  settings seam (`ctx.settings.register`, from `@deepseek-ai/dsh-settings`)
  backed by `$DSH_HOME/settings.yaml` (the document the web Models page
  writes). Shape: `marketplaces` (specs), `installs`
  ({marketplace, plugin, targets} with targets encoded as `global` /
  `workspace:<abs path>`, presence only — versions follow upstream), and
  `models` (the Models-tab overrides, the null inherit marker written as
  the word `inherit`).
- **Write-through.** Every mutation (add/remove marketplace, install,
  per-target and full uninstall, model-override save) re-renders the
  section from the registry and `replace`s the user layer. Best effort: a
  failed write logs a warning and never fails the mutation. Sorted
  identities keep repeated writes minimal-diff (the provider replaces
  changed arrays wholesale but preserves comments and sibling sections).
- **Reconcile (the sharing payoff).** At boot and on hot-published
  external document edits (`scope.watch`), `reconcileFromMirror` adopts
  what the document carries that the machine lacks: missing marketplaces
  are added, missing plugins installed into their recorded targets —
  workspace targets only when the path exists locally — and model mappings
  adopted only when nothing is saved locally. Removals are never inferred
  (a hand edit never uninstalls); concurrent reconcile calls share one
  run; self-writes re-enter as no-op reconciles.
- Pure logic lives in `core/mirror.ts` (encode/decode targets,
  renderMirror, tolerant parseMirror, the `SettingsMirror` adapter
  interface); the service gained `settings`/`logger` options,
  `mirrorCurrentState`, and `reconcileFromMirror`. The host entry wires
  the registered scope and skips everything when the settings service is
  absent (minimal boots keep working, mirroring disabled). New devDep:
  `@deepseek-ai/dsh-settings` (types + the `settingsNamespace` brand).

## Verification

248 tests across 15 suites (was 237): new tests/mirror.spec.ts —
encode/decode round trips and malformed strings, renderMirror sorting and
inherit wording, tolerant parsing, write-through after every mutation
(per-target uninstall shrinking then removing the mirrored install,
models with the inherit word, write failures never failing mutations),
and reconcile (adopting marketplaces/installs/models with skills landing
in both roots, skipping missing workspace paths / unknown marketplaces /
failed adds, no-op with local models winning). Mount smoke green — the
namespace registers cleanly inside a real DSH.
