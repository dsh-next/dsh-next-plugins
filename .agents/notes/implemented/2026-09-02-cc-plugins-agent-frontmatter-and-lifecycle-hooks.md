# cc-plugins: agent frontmatter translation and lifecycle hook events

- date: 2026-09-02
- status: implemented
- scope: packages/dsh-next-cc-plugins

Completed the two increments flagged in the consolidated cc-plugins note:

agent `tools:` / `model:` frontmatter now reaches the child delegation tool
natively, and four more Claude hook events have DSH event twins. Both were
designed against the deployed SDK's real surfaces, not guesses.

## Agent frontmatter (`src/core/agents.ts`, new)

- `tools:` maps through `CLAUDE_TOOL_MAP` (Bash -> bash, WebSearch ->
  web_search, Task/Agent -> subagent, MultiEdit -> edit, ExitPlanMode ->
  exit_plan_mode, ...) into `toolFilter.allow`, which `dsh-tool-subagent`
  forwards to `childCtx.tools.restrict()` — verified in the deployment
  before building. Permission patterns (`Bash(git log:*)`) reduce to the
  base tool with a note; unmapped names drop with a note; `*` and empty
  mean no filter.
- `model:` resolves through the new `runtime.agentModelMap` config
  (schemastery `Schema.dict`, case-insensitive keys) into
  `agentOptions.model`. `inherit` and unmapped values mean no override —
  DSH's parent-inheritance default — with an install note for unmapped
  names. Claude ids are never passed raw: `resolveChildAgentOptions` would
  fail every delegation on an unknown model.
- `InstalledAgentRow`/`RawAgentRow` persist the resolved values so the
  managed block re-renders from the registry without re-translation; the
  frontmatter parser gained single-line `tools`/`model` scalars.

## Lifecycle hook events (`src/core/hooks.ts`, `src/host/runtime.ts`)

Mapping (each DSH event verified against `dsh-agent`/`dsh-subagent` types):

- `UserPromptSubmit` -> `agent/pre-step` waterfall: run hooks only when the
  step claims a user-authored message; `{decision:'block'}` JSON or exit 2
  returns `{kind:'reject'}`; clean stdout is injected via `agent.inject()`
  with a `plugin`-sourced message.
- `SessionStart` -> `agent/session-start` (source enum is literally
  `startup|resume|clear|compact`, matching Claude's matchers); observe-only
  plus stdout injection.
- `Stop` -> `agent/turn-stopping`: a block steers via `agent.steer()` with
  the reason so the turn runs another step. Loop guard: one forced
  continuation per (agent, turn); the guarded pass still runs hooks with
  `stop_hook_active: true` and ignores further blocks.
- `SubagentStop` -> `subagent/end`: observe-only, child session id in the
  payload.

All six listeners stay behind `runtime.hooks` (default false) — the
lifecycle events see every prompt, so the gate now covers more surface and
the config description says so. `PreCompact`, `Notification`, `SessionEnd`
remain unsupported (no before-compact event exists in the deployment;
post-compact is a `SessionStart` with source `compact`).

Permanently lossy, documented in the README: per-agent
`description`/`when_to_use` (the tool description in `dsh-tool-subagent` is
hardcoded from provider wording — needs an upstream config key to fix),
`PreCompact` veto, and Claude model ids without a user map.

## Block-list `tools:` frontmatter

Claude agents equally validly write the list form (`tools:` followed by
`  - Name` items); the frontmatter reader only handled single-line scalars,
so the list form silently parsed as empty. `parseFrontmatter` now collects
`- item` lines under a bare `key:` into that key (joined with `, `, matching
the scalar form exactly) — any other line ends the collection, and a stray
dash before any key is ignored.

## Verification

168 tests across 12 suites (was 125/11): new `tests/agents.spec.ts`,
extended hooks/mcp-rows/service/runtime/frontmatter coverage (pre-step
reject and inject, session-start matching, steer + loop guard, subagent-end
observe, disabled gate, block-list forms), plus repo-wide typecheck, test,
build, docs:check, and the real mount smoke.

Live validation (scratch DSH home, packed tarball, profile with
dsh-base + dsh-web-app): a local marketplace plugin with block-list and
scalar `tools:` frontmatter was installed through the real GUI; the
install message carried every translation note; the managed block carried
`toolFilter.allow: ['bash', 'read']` (list form) and `['write']`
(NotebookEdit dropped); a restart loaded the rows into the real
`dsh-tool-subagent` with zero error lines; with
`runtime.agentModelMap: { sonnet: deepseek-chat }` configured, an update
through the GUI re-rendered the reviewer row with
`agentOptions.model: 'deepseek-chat'` and a final restart loaded that row
cleanly. `runtime.hooks: true` was active across those boots with no
activation failures.
