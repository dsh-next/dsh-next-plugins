# cc-plugins test failure: dsh-llm runtime import of dev-only dep

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-cc-plugins

`@deepseek-ai/dsh-llm@0.1.1-rc.2` ships a compiled `lib/index.js` that imports
`MAX_TIMER_DELAY_MS` from `@deepseek-ai/dsh-timeout`, but lists
`@deepseek-ai/dsh-timeout` only in its `devDependencies`, not `dependencies` —
an upstream packaging bug. pnpm therefore does not install it, and vitest (which
resolves the real ESM import graph strictly) fails `cc-plugins` tests with
`Failed to resolve import "@deepseek-ai/dsh-timeout"`.

Only `cc-plugins` was affected because it is the only package depending on
`dsh-llm`; `notifier` and `skills` do not. Three spec files
(`runtime.spec.ts`, `hooks.spec.ts`, `plugin.spec.ts`) reported `0 test` — the
import failure aborted them before collection, so the real signal was the
"Failed to resolve import" error, not empty suites.

Fix (workaround, since upstream cannot be edited here): added
`@deepseek-ai/dsh-timeout: ^0.1.1-rc.2` to `cc-plugins` `devDependencies` and
regenerated `pnpm-lock.yaml`. This installs the package so the transitive import
resolves. The lockfile diff realigns every `@deepseek-ai/*` peer suffix to
include `dsh-timeout` (correct new resolution) but changes no version (still
`0.1.1-rc.2` / `4.0.1` / `3.18.1`). Verified: `pnpm install --frozen-lockfile`
is clean and all 19 cc-plugins test files (380 tests) pass.

Note for the future: if `dsh-llm` is republished with a correct `dependencies`
entry, the explicit `dsh-timeout` devDependency can be removed.
