---
name: dsh-next-documentation
description: Write or update dsh-next documentation. Use when asked to document a plugin, feature, or process in this repository.
---

# dsh-next documentation

Read the [documentation rules](<../../../docs/AGENTS.md>) and
[bilingual contract](<../../../docs/i18n.md>) first. For README work, also read
[the research and examples](<references/readme-writing.md>). The documentation
rules own the format; this skill owns the writing and review procedure.

## 1. Establish the reader's task

- Identify the intended reader and one useful first result. Default to a
  Harness user with no knowledge of the plugin's implementation.
- Read the current English and Chinese pages before editing. Check the package
  manifest for minimum DSH version and private/unreleased status; verify UI
  labels against the current dictionaries and, when necessary, E2E tests.
- Inventory prerequisites, destructive operations, costs, data sharing, scope,
  and surprising defaults. Keep these visible when simplifying.
- Classify other content: keep for first use, move to an existing owning guide,
  or remove because it is duplicated or demonstrably obsolete. Do not discard
  useful recovery/configuration instructions just to shorten the README.

## 2. Draft for scanning

Follow the canonical README shape in the documentation rules: benefit, install,
quick start, short feature bullets, essential cautions and links. Lead with
what the reader does and the result they should see. Use short sentences,
concrete verbs, and one idea per bullet. Explain a technical term before using
it; do not describe a UI by its implementation.

Choose a single first-run path rather than listing every alternative. Keep
advanced options in task-focused guides under `docs/`, in English only.
Use existing accurate screenshots, with alt text; do not invent images or
claim an old screenshot verifies current behavior. If a UI plugin lacks a
suitable screenshot, capture one through the local-testing procedure.

## 3. Mirror and check facts

- Rewrite both languages together, preserving heading order, list structure,
  fenced code, link targets, and images. Keep shipped English UI labels in
  inline code on both sides. The exact language switchers remain unchanged.
- Keep the official npm installation form and explain the profile placeholder.
  For private packages, clearly mark it as the future command, not an available
  release. Use GitHub blob links for documents outside the package.
- Check that every removed substantive fact still has a home or a reason to
  disappear. Keep each detailed fact in one owning guide rather than copying
  the reference back into the README.
- Check linked documents, screenshot paths, and relevant source facts. Do not
  use a character/word count as proof that a translation is accurate or clear.

## 4. Test the reading experience

Read just the README, without implementation context. Can a newcomer explain
its purpose, installability, first task, expected result, risks, and next help
link? Use the reader questions in the research reference; a fresh read-only
subagent review is useful for a batch rewrite. Address uncertainty instead of
letting a reviewer infer missing instructions. Read the Chinese side as a
standalone first-run guide, not a word-for-word translation exercise.

Only after confirming the pair, run `pnpm docs:write-pair <slug>` for each
changed package and `pnpm docs:check`. Do not weaken the checker to accept
mismatched translations. Record non-trivial changes in an Agent Note following
[the note lifecycle](<../../notes/README.md>).
