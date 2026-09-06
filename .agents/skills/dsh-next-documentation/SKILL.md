---
name: dsh-next-documentation
description: Write or update dsh-next documentation. Use when asked to document a plugin, feature, or process in this repository.
---

# dsh-next documentation

Follow `docs/AGENTS.md` and `docs/i18n.md`.

1. Write in English only, without emoji. Package READMEs are the one
   exception: they are bilingual English/Chinese pairs.
2. Keep each fact in its owning document; update docs in the same change that
   changes behavior.
3. Every package keeps the bilingual README triplet from `docs/i18n.md`.
   Content, screenshots, and install copy follow `docs/AGENTS.md` →
   "Package READMEs" (first-run guide, not a contributor handbook). Install
   copy is always `dsh plugin --profile <name> add @dsh-next/dsh-next-<slug>`
   — never `link:`, `file:`, or a checkout path. When you
   edit either side of a pair, mirror the edit into the other language in
   the same change (same headings, code blocks, tables, lists, and images),
   then re-record with `pnpm docs:write-pair <slug>`. On-screen UI strings
   quoted in a README stay in their shipped (English) form inside inline
   code.
4. Run `pnpm docs:check` before merging.
