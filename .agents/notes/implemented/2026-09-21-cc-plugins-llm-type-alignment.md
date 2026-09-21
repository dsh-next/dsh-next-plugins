# Align cc-plugins message types with the active DSH runtime

- date: 2026-09-21
- status: implemented
- scope: packages/dsh-next-cc-plugins

`dsh-next-cc-plugins` now pins `@deepseek-ai/dsh-llm` to `0.1.6-alpha.2`, the
same version selected by its active `dsh-session` and `dsh-client-runtime` peer
graph. The previous direct `0.1.2-rc.1` dependency created a second copy of the
nominally branded `MessageId` type: messages built by `createUserMessage` could
not be passed to the agent methods declared through the newer copy.

The package dependency graph now contains one `dsh-llm` version. No runtime code
or message behavior changed. Package typecheck, build, all 390 package tests, the
complete monorepo test command, and the dedicated cc-plugins browser suite pass;
the repository-wide TypeScript check is green again.
