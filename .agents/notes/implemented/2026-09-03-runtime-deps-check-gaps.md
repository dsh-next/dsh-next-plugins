# runtime-deps-check: closed two false-negative gaps

- date: 2026-09-03
- status: implemented
- scope: scripts (CI guardrail) + repo

`scripts/runtime-deps-check.mjs` — the runtime-dependency guardrail — had two
holes that let the `dsh-timeout` failure slip through to a noisy CI test error
instead of a clear guardrail failure:

1. **`@deepseek-ai/*` blind skip.** It `continue`d on every
   `@deepseek-ai/*` import assuming "provided by DSH runtime", so a missing
   transitive dep (the `dsh-llm` → `dsh-timeout` bug) was never validated. Now
   each `@deepseek-ai/*` specifier (including `/client` subpaths) is resolved
   from the package's own directory and flagged if it does not resolve.

2. **Permanent no-op.** It scanned only *committed* `lib/`, but `lib/` is
   gitignored and never committed, so it reported "0 scanned packages". It now
   scans committed `src/` (and any committed `lib/`), so it actually gates the
   import surface: 3 packages, 83 source files.

Also corrected: the allowed dependency set now includes `peerDependencies` (so
`react` is legitimate), and resolution uses `require.resolve` (not a mistaken
call of the `require` function itself). Added
`scripts/runtime-deps-check.test.mjs` (9 tests) so the previously-uncovered
exports `importSpecifiers`/`checkRuntimeImports` are gated by `test:scripts`.

Verified: `pnpm runtime-deps:check` reports 3 packages OK; an injected
non-resolving `@deepseek-ai/*` specifier is flagged; injected undeclared dep is
flagged; declared deps and peers pass.
