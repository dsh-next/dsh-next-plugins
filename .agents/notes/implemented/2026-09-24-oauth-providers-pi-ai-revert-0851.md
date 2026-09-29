# Reverted pi-ai to 0.85.1: ChatGPT turns ran without tools

- date: 2026-09-24
- status: implemented
- scope: packages/dsh-next-oauth-providers

## Symptom

Every turn on a subscription route answered as if it had no tools at all —
"I don't have a file-reading or skill-loading tool available in this session" —
while DeepSeek turns in a separate mixed-provider session used tools normally.
The regression correlates with the change to pi-ai 0.87.1. Restoration of live
tool calls after the downgrade has not yet been verified.

## Evidence

The failing session (`session-bf4e4a45`, worktree `new-connectors-plugin`)
recorded both sides of the request:

```
request/header  -> provider openai-codex-oauth, model gpt-6-sol, tools: 35
assistant/message -> reasoning "Requesting workspace files" ... text "no file-reading tool"
tool/call events  -> 0
```

Inside another session (`session-15e8c97a`) the codex steps produced **0**
tool calls while its DeepSeek steps produced **281 / 181 / 122 / 55**. These
counts cover separate requests with different tool counts, not a controlled
same-prompt comparison. Earlier codex sessions contain tool calls, but some
also switched providers, so session totals alone cannot establish which
version last worked.

## Diagnosis and limitation

`dsh-llm-pi-ai@0.1.7-rc.1` declares `@earendil-works/pi-ai: ^0.85.1`;
the forced 0.87.1 installation is outside that supported range. A direct
pi-ai API probe with an unnormalized legacy context dropped tools, but the
adapter calls pi-ai's `Models.streamSimple`, which itself calls
`normalizeContext()` before dispatch. That probe therefore does **not** prove
the live request lost its tool definitions. The recorded `request/header`
shows tools in DSH's request, not the HTTP/WebSocket payload. Root cause on
the wire remains unconfirmed; returning to the declared version is the safe
rollback, subject to a live tool-call test.

## Fix

Pin `@earendil-works/pi-ai` back to `0.85.1` and undo everything that only made
sense on the 0.87.1 catalog:

- `CHATGPT_OAUTH_CAPACITIES` back to the 0.85.1 ids — `gpt-5.4` and
  `gpt-5.4-mini` return, `gpt-6-luna` / `gpt-6-sol` leave. The two sync guards
  added with the upgrade keep enforcing that the map matches the pinned catalog.
- The nominal-type cast in `profiles.ts` goes away: the adapter's declared range
  and the pinned version agree again.
- Tests and the README pair restored to the 0.85.1 ids, pairing re-recorded.
- The upgrade's changeset is deleted so the release notes never promise
  `gpt-6-luna` / `gpt-6-sol`.
- The image-contract work stays: aligning the plugin SDK to the runtime
  (`dsh-llm-pi-ai@0.1.7-rc.1`) is orthogonal to the pi-ai version and is what
  makes image turns work.

`gpt-6-luna` and `gpt-6-sol` remain **configurable** as customized rows —
`input` / `reasoningEfforts` attach image and effort metadata. Actual server
acceptance of those IDs with pi-ai 0.85.1 has not been verified.

## Verification

- Resolution probe from the package root: pi-ai `0.85.1`, catalog
  `gpt-5.3-codex-spark, gpt-5.4, gpt-5.4-mini, gpt-5.5, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-6-astra`;
  every one of those but `gpt-5.3-codex-spark` declares `input: [text, image]`,
  so image turns keep working.
- `pnpm --filter @dsh-next/dsh-next-oauth-providers typecheck` clean,
  282 tests in 29 files green.

## Follow-up

- Confirm that pi-ai 0.85.1 accepts hand-mapped `gpt-6-luna` / `gpt-6-sol`
  against the live provider and that image and effort requests succeed.
- The global DSH install still carries `@earendil-works/pi-ai@0.87.1` after
  the workspace revert; `~/.dsh/profiles/node_modules` links to that same
  global copy. An out-of-workspace downgrade requires approval and live
  verification. Do not claim tools have returned until a real turn calls one.
