# Configurable commit message writing preferences

- date: 2026-09-21
- status: implemented
- scope: packages/dsh-next-git

Added Commit message instructions below Drafting model in the plugin's bundle
configuration. It is an optional multiline field with explicit Save, capped at
4,000 characters. Clearing and saving restores default writing behavior.

The live settings field `draftingInstructions` defaults to empty, including for
existing installations. `setConfig` accepts an instructions-only patch or the
existing complete provider/model pair, or both. Changing one setting preserves
the others. Model selection retains its immediate-save behavior; selecting a
model does not discard unsaved instruction edits. Failed saves preserve the
field so the user can retry.

Commit, Reword and Squash auxiliary requests read a snapshot of these preferences
and append them as style guidance to the unchanged base system prompt. Empty
instructions produce the exact previous prompt. The built-in evidence/output
requirements, tool-free generation, cancellation and output checks remain in
force. Other agent operations do not consume this setting.

Coverage includes all three drafting kinds, blank reset, old model-pair updates,
partial-pair rejection, invalid types/control characters, length boundaries,
RPC envelope/persistence, client explicit-save/retry and unsaved-text preservation.
The real browser suite saves a preference, reopens the bundle page to verify
persistence, and captures both light and dark appearances without paid model calls.

Validation passed: 1,624 Git tests (one existing skip), Git typecheck, the full
Git browser suite in `artifacts/testing/run-3cxLaV`, docs/i18n and whitespace
checks. Both theme screenshots were inspected and the README image updated.
