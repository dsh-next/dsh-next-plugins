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
3. Every package keeps the bilingual README triplet from `docs/i18n.md`:
   `README.md`, `README.zh.md`, and the `README.i18n.yaml` pairing record,
   covering purpose, install, and development commands. When you edit either
   side of a pair, mirror the edit into the other language in the same change
   (same headings, code blocks, tables, and lists), then re-record with
   `pnpm docs:write-pair <slug>`. On-screen UI strings quoted in a README stay
   in their shipped (English) form inside inline code.
4. Run `pnpm docs:check` before merging.
