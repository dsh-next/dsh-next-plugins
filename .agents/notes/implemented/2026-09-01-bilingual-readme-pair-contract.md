# Bilingual README pair contract with hash-pair gate

- date: 2026-09-01
- status: implemented
- scope: scripts/verify-docs.mjs, scripts/plugin-template, docs, AGENTS.md,
  docs/AGENTS.md, .agents/skills, all 11 package READMEs

## What

Every package README is now a bilingual English/Simplified-Chinese pair with
equal authority, guarded by a mechanical consistency gate:

- `README.md` (English side, gains a `English | [中文](README.zh.md)`
  switcher under the H1),
- `README.zh.md` (Chinese side, switcher `[English](README.md) | 中文`),
- `README.i18n.yaml` (pairing record: the `git hash-object` blob hash of each
  side at the last confirmed-consistent state).

`pnpm docs:check` (`scripts/verify-docs.mjs`) enforces the triplet: presence,
switcher lines, structural signature mirror (heading levels, fence
open/close with language markers, table row/column shapes, list kinds), and
that both recorded blob hashes still match current content. Editing either
side invalidates the record until the other language is brought along and
`pnpm docs:write-pair <slug>` re-records it; the yaml diff is the auditable
"both sides confirmed consistent" action. `pnpm docs:list` reports state
without failing. The contract document is `docs/i18n.md`.

## Key decisions

- **Mechanism adopted from the `zhu1090093659/dsh-web` pairing-record
  convention** (user request): content-addressed blob hashes are
  commit-independent, so any edit to either side turns the gate red. The gate
  proves "consistent at record time"; translation quality stays with review.
- **Signature compares structure, never content.** Headings compare by level
  only, fenced code content is not compared (translating comments inside
  samples is legitimate), tables compare row/column shapes, lists compare
  kind and count. Link targets are not compared because the switcher lines
  intentionally differ.
- **Scope is `packages/*` only.** `docs/`, repository files, and
  `docs/archive/` stay English only. The former "Package READMEs are English
  only" rule in `AGENTS.md` and the blanket English-only line in
  `docs/AGENTS.md` were replaced with the pair exception.
- **No `shared/` runtime code.** `shared/` is the DRY home for the build
  preset and test loader shim, not docs tooling; the gate lives in
  `scripts/verify-docs.mjs`. UI translation logic likewise stays per-plugin
  (`src/client/dictionaries.ts` + `ctx.locale.register`, with cc-plugins as
  the reference implementation) — cross-plugin consistency comes from the
  scaffold and documented pattern, not a shared runtime module.
- **`pnpm plugin:new` scaffolds bilingual from the first commit.** The
  template ships the full triplet and `scripts/dsh-plugin-new.mjs`
  auto-records the pairing hashes after copying, so a fresh scaffold passes
  `pnpm docs:check` immediately.
- **Terminology is aligned with shipped UI dictionaries**, not invented per
  README: 插件/市场/安装/更新/技能/钩子/设置/宿主/全局, the cc-plugins zh
  section label "Claude 插件", and event bridging as 挂接到 (not a literal
  rendering of "ride").

## Structure

- `scripts/verify-docs.mjs` — rewritten gate: `checkPackage` (presence,
  switchers, `signature` mirror, `readPairing`/`blobHash` comparison),
  `--write <slug>...` re-record mode that re-verifies after recording,
  `--list` report mode. `package.json` gains `docs:write-pair`.
- `scripts/plugin-template/` — `README.md` switcher, new `README.zh.md` and
  `README.i18n.yaml`; `scripts/dsh-plugin-new.mjs` copies the triplet and
  records hashes via the gate.
- `docs/i18n.md` — owning document for the pairing contract, maintenance
  flow, structural mirror rules, gate usage, and the UI-dictionary
  relationship.
- Skills updated: `dsh-next-documentation` (pair flow, quoting on-screen
  strings verbatim), `dsh-next-agent-coding` (step 7: mirror + re-record),
  `dsh-next-code-review` (check 7: README pairing).
- All 11 packages translated. The three content-heavy READMEs
  (cc-plugins 227 zh lines, skills 114, notifier 87) were translated
  against a shared glossary drawn from the cc-plugins zh UI dictionary; the
  eight scaffold READMEs use one shared zh scaffold template.

## Validation

- `pnpm docs:check` — 11/11 packages green.
- Negative path (live): injected an extra zh heading and an extra en list
  item into the cron pair; the gate reported both signature mismatches plus
  both stale-hash failures and exited 1; restore + `docs:write-pair cron`
  returned it to green.
- Scaffold smoke: `pnpm plugin:new test-slug` produced a triplet that passed
  the gate as the 12th package; removed afterwards.
- `pnpm typecheck && pnpm test` green (no package source changed);
  `.github/workflows/ci.yml` already runs `pnpm docs:check`, so the new gate
  is CI-enforced.
