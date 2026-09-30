# Validate PR evidence against its target branch

- date: 2026-09-30
- status: implemented
- scope: PR contribution policy, template, and regression tests

The [PR template](<../../../.github/pull_request_template.md>) now names all seven
plugins and confirms the latest target branch, not always main. The
[tested policy](<../../../scripts/github-pr-contribution.mjs>) keeps bot release
PRs exempt while requiring human PR types, the target-branch attestation, and
commands/reason plus a nonempty result summary. Untouched validation scaffolding
and blank sections no longer pass by consuming the following heading.

The privileged [workflow](<../../../.github/workflows/pr-contribution-rules.yml>)
loads only its immutable PR base SHA and an absolute trusted workspace module,
never PR-head code. Comment failures still fail validation, while synchronize
avoids repetitive comments. Template text mirrors repository language and
source-emoji rules instead of rejecting the bilingual package documentation.

[Focused regressions](<../../../scripts/github-pr-contribution.test.mjs>) cover
actual template alignment, bot/valid/draft cases, all human evidence fields,
blank/CRLF/comment parsing, and mocked comment failures. No GitHub mutation was
performed during validation.
