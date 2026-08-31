# Skills: skill detail modal renders markdown

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-skills

## Change

The skill detail modal (Installed and Search tabs) now renders the SKILL.md
body as markdown instead of dumping raw text into a `<pre>`. The renderer
(`src/client/markdown.tsx`) is a small dependency-free block/inline parser
that builds React elements directly — no HTML string is ever assembled or
injected, so remote skill content cannot smuggle markup (`<script>` in a body
renders as escaped text). Link hrefs are restricted to http(s)/mailto;
anything else degrades to plain text. Unknown markdown constructs degrade to
plain text rather than erroring.

Supported blocks: fenced code fences, ATX headings, blockquotes, unordered and
ordered lists (one nesting level), pipe tables, horizontal rules, paragraphs.
Inline: code spans, bold, italic, strikethrough, links.

`card.module.css` adds `.md` typography (headings, lists, code chips, code
fences, tables, blockquotes, rules, links) layered over the existing
`.modalBody` scroll container.

## Tests

- `tests/markdown.spec.tsx` (new, 10 cases): headings, fences without inline
  parsing, lists, tables, blockquotes/rules, paragraph joining, inline styles,
  safe-link rendering with `rel="noreferrer noopener"`, raw-HTML escaping, and
  javascript:/data: href stripping.
- `tests/panel.spec.tsx`: the two detail-modal checks assert rendered output
  (h1 from a `#` heading, paragraph from plain text) instead of a `<pre>`.
- `scripts/skills-full-verify.mjs`: the modal check asserts rendered body
  elements exist and is renamed to "...rendered markdown body".

## Validation

- Package: 196 tests pass (14 files), `tsc --noEmit` clean, tsdown build ok.
- Full `skills-full-verify.mjs` on a fresh boot: 30/30 checks, no page errors.
- Live screenshot of the find-skills preview: `test-results/skills/05-skill-detail-md.png`.
