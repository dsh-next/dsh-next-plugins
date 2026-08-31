# cc-plugins: Models tab with live model discovery and session inheritance

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-cc-plugins

The user asked for dynamic model selection instead of hardcoded ids: a new
settings tab that selects from models actually available, defaulting to the
current session's model when nothing is selected.

- **Third tab: Models.** One row per Claude model alias — the classic
  families (haiku/sonnet/opus), every mapped alias, and every model name
  the installed agents' frontmatter actually references (discovered by
  parsing the persona markdown in the registry). Each row is a picker over
  the models the live `llm` service offers (`ctx.llm.listProviders()` +
  `listModels(provider)`, injected from the host entry as
  `listRuntimeModels`; best effort — a composition without the service
  degrades to inherit-only pickers). Nothing is hardcoded on either side.
- **Inheritance is the explicit default.** Every picker's first option is
  "Inherit session model": an unmapped alias leaves the child on the
  delegating parent's model, exactly DSH's default and Claude's
  `model: inherit`.
- **Layered persistence.** `runtime.agentModelMap` (composition config)
  stays the declarative baseline — the tab marks those values with a
  "config" chip. Saving writes the panel's overrides to
  `$DSH_HOME/cc-plugins/model-map.json` (sanitized wholesale replace;
  corrupt files read as empty). The effective map is the merge, and
  installs/updates resolve `model:` through it.
- **Saving re-resolves installed rows.** `setAgentModelOverrides` parses
  each installed agent row's persona frontmatter, re-resolves its model
  against the new effective map, and rewrites the managed rows (and the
  registry) — no reinstall needed; a profile reload applies the rows. The
  message lists every alias saved and every agent row change, including
  returns to inheritance.
- `CcState` grew `models`, `agentModelMap` (effective),
  `agentModelConfig` (baseline), and `agentModelAliases`; the RPC gained
  `setAgentModelOverrides`. Pure `sanitizeModelMap` lives in
  `core/agents.ts`.

## Verification

235 tests across 14 suites (was 227): Models-tab panel spec (alias rows,
config chip, baseline selection, draft-merged save dispatch), service
describe for overrides (live model discovery in state, config+override
merge, save re-resolves rows and rewrites the managed block, clear returns
to inheritance, payload sanitization, corrupt file tolerance), fresh
installs resolving through the saved overrides, and the RPC envelope
pinning the new fields. The mount smoke opens the Models tab and asserts
its rows and pickers render inside a real DSH.
