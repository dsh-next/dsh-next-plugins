# Package READMEs document npm install only

- date: 2026-09-06
- status: implemented
- scope: docs/AGENTS.md, scripts/verify-docs.mjs, package README pairs

Package README install copy is always
`dsh plugin --profile <name> add @dsh-next/dsh-next-<slug>`. Local
`link:` / `file:` paths stay in CONTRIBUTING.md and the local-testing
skill. `pnpm docs:check` rejects `link:` and requires the npm line.
